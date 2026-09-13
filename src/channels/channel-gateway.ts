import type { CommandRegistry } from "../commands/command-registry";
import type { SessionInteractionResult } from "../conversation";
import type { RuntimeSource } from "../events";
import { createLogger } from "../utils/logger";
import type { ChannelAdapter, ChannelEvent, ChannelSource } from "./channel";
import { toChannelTarget } from "./channel";
import type { ChannelApprovalBroker } from "./channel-approval-broker";
import type { ChannelDelivery } from "./channel-delivery";
import { createChannelSessionKey } from "./channel-session-binding-store";
import type {
	ChannelConversationSession,
	ChannelSessionDirectory,
} from "./channel-session-directory";

const logger = createLogger("channels.gateway");
const failureMessage = "Sorry, I could not handle that message.";
const resetFailureMessage =
	"Sorry, I could not start a new session. The previous session remains available.";
const resetCancellationReason =
	"Tool approval was cancelled because a new session started.";

export type ChannelAccessCheck = (source: ChannelSource) => boolean;

export interface ChannelGatewayOptions {
	readonly adapters: readonly ChannelAdapter[];
	readonly delivery: ChannelDelivery;
	readonly sessions: ChannelSessionDirectory;
	readonly approvals: ChannelApprovalBroker;
	readonly commands: CommandRegistry;
	readonly isAllowed: ChannelAccessCheck;
}

interface ConversationGeneration {
	readonly abort: AbortController;
	active: number;
	discarded: number;
}

interface ConversationState {
	tail: Promise<void>;
	generation: ConversationGeneration;
}

export class ChannelGateway {
	private readonly handlers = new Set<Promise<void>>();
	private accepting = false;
	private readonly conversations = new Map<string, ConversationState>();

	constructor(private readonly options: ChannelGatewayOptions) {}

	async run(signal: AbortSignal): Promise<void> {
		const lifecycle = new AbortController();
		let transportFailure: unknown;
		const stop = () => {
			this.accepting = false;
			lifecycle.abort();
			this.options.approvals.cancelAll("Gateway stopped.");
		};
		this.accepting = !signal.aborted;

		if (signal.aborted) {
			lifecycle.abort();
		} else {
			signal.addEventListener("abort", stop, { once: true });
		}

		const fail = (error: unknown) => {
			transportFailure ??= error;
			stop();
		};
		const runs = this.options.adapters.map((adapter) =>
			Promise.resolve().then(() =>
				adapter.run(
					(event) => {
						if (!this.accepting) {
							return Promise.resolve();
						}

						const handler = this.handleEvent(
							adapter.name,
							event,
							lifecycle.signal,
						);
						this.handlers.add(handler);
						void handler.then(
							() => this.handlers.delete(handler),
							() => this.handlers.delete(handler),
						);
						return handler;
					},
					lifecycle.signal,
					fail,
				),
			),
		);

		let runFailure: unknown;
		try {
			await Promise.all(runs);
		} catch (error) {
			runFailure = error;
		} finally {
			stop();
			await Promise.allSettled(runs);
			while (this.handlers.size > 0) {
				await Promise.allSettled([...this.handlers]);
			}
			await this.options.approvals.drain();
			signal.removeEventListener("abort", stop);
		}

		if (transportFailure !== undefined) {
			throw transportFailure;
		}

		if (runFailure !== undefined) {
			throw runFailure;
		}
	}

	private async handleEvent(
		adapterName: string,
		event: ChannelEvent,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) {
			return;
		}
		if (event.source.channel !== adapterName) {
			throw new Error(
				`Adapter ${adapterName} emitted an event for another channel.`,
			);
		}

		if (!this.options.isAllowed(event.source)) {
			logger.debug("channel.source.rejected", {
				channel: event.source.channel,
				conversationKind: event.source.conversationKind,
			});
			return;
		}

		if (event.type === "action") {
			if (!this.options.approvals.resolve(event)) {
				logger.debug("channel.action.unhandled", {
					channel: event.source.channel,
					conversationKind: event.source.conversationKind,
				});
			}

			return;
		}

		const control = this.options.commands.matchChannelControl(event.text);

		if (control?.intent === "new-session") {
			await this.enqueueReset(event, signal);
			return;
		}

		await this.enqueueMessage(event, signal);
	}

	private getConversation(key: string): ConversationState {
		const existing = this.conversations.get(key);

		if (existing !== undefined) {
			return existing;
		}

		const created: ConversationState = {
			tail: Promise.resolve(),
			generation: {
				abort: new AbortController(),
				active: 0,
				discarded: 0,
			},
		};
		this.conversations.set(key, created);
		return created;
	}

	private enqueueMessage(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
	): Promise<void> {
		const key = createChannelSessionKey(event.source);
		const conversation = this.getConversation(key);
		const generation = conversation.generation;
		const operationSignal = AbortSignal.any([signal, generation.abort.signal]);
		const operation = conversation.tail
			.catch(() => undefined)
			.then(async () => {
				if (operationSignal.aborted || conversation.generation !== generation) {
					generation.discarded += 1;
					return;
				}

				generation.active += 1;
				try {
					await this.handleMessage(event, operationSignal);
				} finally {
					generation.active -= 1;
				}
			});

		return this.ownConversationOperation(key, conversation, operation);
	}

	private enqueueReset(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
	): Promise<void> {
		const key = createChannelSessionKey(event.source);
		const conversation = this.getConversation(key);
		const retired = conversation.generation;
		const interrupted = retired.active > 0;
		retired.abort.abort();
		this.options.approvals.cancelConversation(key, resetCancellationReason);
		conversation.generation = {
			abort: new AbortController(),
			active: 0,
			discarded: 0,
		};

		const operation = conversation.tail
			.catch(() => undefined)
			.then(() => this.handleReset(event, signal, key, retired, interrupted));
		return this.ownConversationOperation(key, conversation, operation);
	}

	private ownConversationOperation(
		key: string,
		conversation: ConversationState,
		operation: Promise<void>,
	): Promise<void> {
		conversation.tail = operation;
		return operation.finally(() => {
			if (
				this.conversations.get(key) === conversation &&
				conversation.tail === operation
			) {
				this.conversations.delete(key);
			}
		});
	}

	private async handleReset(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
		key: string,
		retired: ConversationGeneration,
		interrupted: boolean,
	): Promise<void> {
		const target = toChannelTarget(event.source);
		let committed = false;

		try {
			await this.options.approvals.drainConversation(key);
			if (signal.aborted) {
				return;
			}

			await this.options.sessions.replace(event.source, signal);
			committed = true;
			if (signal.aborted) {
				return;
			}

			const details: string[] = [];
			if (interrupted) {
				details.push("Interrupted active work.");
			}
			if (retired.discarded > 0) {
				details.push(
					`Discarded ${retired.discarded} queued ${retired.discarded === 1 ? "message" : "messages"}.`,
				);
			}
			const confirmation = [
				"Started a new session. Previous history is preserved.",
				...details,
			].join(" ");

			await this.options.delivery.send(
				{
					target,
					text: confirmation,
					replyToMessageId: event.source.messageId,
				},
				signal,
			);
		} catch (error) {
			if (signal.aborted) {
				return;
			}

			logger.error("channel.session.reset_failed", {
				channel: event.source.channel,
				error: error instanceof Error ? error.message : String(error),
			});
			if (committed) {
				throw error;
			}

			await this.options.delivery.send(
				{
					target,
					text: resetFailureMessage,
					replyToMessageId: event.source.messageId,
				},
				signal,
			);
		}
	}

	private async handleMessage(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) {
			return;
		}

		const target = toChannelTarget(event.source);
		let interaction: ChannelConversationSession;
		let result: SessionInteractionResult;

		try {
			interaction = await this.options.sessions.getOrCreate(event.source);
			if (signal.aborted) {
				return;
			}
			const source: RuntimeSource = {
				kind: "channel",
				channel: event.source.channel,
				conversationId: event.source.conversationId,
				conversationKind: event.source.conversationKind,
				threadId: event.source.threadId,
				userId: event.source.userId,
			};
			result = await interaction.interactor.handle({
				content: event.text,
				source,
				signal,
			});
		} catch (error) {
			if (signal.aborted) {
				return;
			}
			logger.error("channel.interaction.failed", {
				channel: event.source.channel,
				error: error instanceof Error ? error.message : String(error),
			});
			await this.options.delivery.send(
				{
					target,
					text: failureMessage,
					replyToMessageId: event.source.messageId,
				},
				signal,
			);
			return;
		}

		if (result.exitRequested) {
			this.options.sessions.evict(interaction.sessionId);
		}

		for (const message of result.messages) {
			if (signal.aborted) {
				return;
			}
			await this.options.delivery.send(
				{
					target,
					text: message.content,
					replyToMessageId: event.source.messageId,
				},
				signal,
			);
		}
	}
}
