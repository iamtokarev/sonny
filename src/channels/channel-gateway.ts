import type { SessionInteractionResult } from "../conversation";
import type { RuntimeSource } from "../events";
import { createLogger } from "../utils/logger";
import type { ChannelAdapter, ChannelEvent, ChannelSource } from "./channel";
import { toChannelTarget } from "./channel";
import type { ChannelApprovalBroker } from "./channel-approval-broker";
import type { ChannelDelivery } from "./channel-delivery";
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
	constructor(private readonly options: ChannelGatewayOptions) {}

	async run(signal: AbortSignal): Promise<void> {
		const lifecycle = new AbortController();
		const stop = () => lifecycle.abort();

		if (signal.aborted) {
			lifecycle.abort();
		} else {
			signal.addEventListener("abort", stop, { once: true });
		}

		const runs = this.options.adapters.map((adapter) =>
			Promise.resolve().then(() =>
				adapter.run(
					(event) => this.handleEvent(adapter.name, event, lifecycle.signal),
					lifecycle.signal,
				),
			),
		);

		try {
			await Promise.all(runs);
		} finally {
			lifecycle.abort();
			this.options.approvals.cancelAll("Gateway stopped.");
			await Promise.allSettled(runs);
			signal.removeEventListener("abort", stop);
		}
	}

	private async handleEvent(
		adapterName: string,
		event: ChannelEvent,
		signal: AbortSignal,
	): Promise<void> {
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

		await this.handleMessage(event, signal);
	}

	private async handleMessage(
		event: Extract<ChannelEvent, { type: "message" }>,
		signal: AbortSignal,
	): Promise<void> {
		const target = toChannelTarget(event.source);
		let interaction: ChannelConversationSession;
		let result: SessionInteractionResult;

		try {
			interaction = await this.options.sessions.getOrCreate(event.source);
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
			await this.options.delivery.send({
				target,
				text: message.content,
				replyToMessageId: event.source.messageId,
			});
		}
	}
}
