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

export type ChannelAccessCheck = (source: ChannelSource) => boolean;

export interface ChannelGatewayOptions {
	readonly adapters: readonly ChannelAdapter[];
	readonly delivery: ChannelDelivery;
	readonly sessions: ChannelSessionDirectory;
	readonly approvals: ChannelApprovalBroker;
	readonly isAllowed: ChannelAccessCheck;
}

export class ChannelGateway {
	private readonly handlers = new Set<Promise<void>>();
	private accepting = false;
	private readonly conversationTails = new Map<string, Promise<void>>();

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

		await this.enqueueMessage(event, signal);
	}

	private enqueueMessage(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
	): Promise<void> {
		const key = createChannelSessionKey(event.source);
		const previous = this.conversationTails.get(key) ?? Promise.resolve();
		const operation = previous
			.catch(() => undefined)
			.then(() => this.handleMessage(event, signal));

		this.conversationTails.set(key, operation);

		return operation.finally(() => {
			if (this.conversationTails.get(key) === operation) {
				this.conversationTails.delete(key);
			}
		});
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
			await this.options.delivery.send({
				target,
				text: failureMessage,
				replyToMessageId: event.source.messageId,
			});
			return;
		}

		if (result.exitRequested) {
			this.options.sessions.evict(interaction.sessionId);
		}

		for (const message of result.messages) {
			if (signal.aborted) {
				return;
			}
			await this.options.delivery.send({
				target,
				text: message.content,
				replyToMessageId: event.source.messageId,
			});
		}
	}
}
