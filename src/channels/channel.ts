export type ChannelConversationKind = "direct" | "group" | "channel";

export interface ChannelSource {
	readonly channel: string;
	readonly conversationId: string;
	readonly conversationKind: ChannelConversationKind;
	readonly userId: string;
	readonly messageId: string;
	readonly threadId?: string;
}

export interface ChannelTarget {
	readonly channel: string;
	readonly conversationId: string;
	readonly threadId?: string;
}

export type ChannelTargetSource = Pick<
	ChannelSource,
	"channel" | "conversationId" | "threadId"
>;

export type ChannelEvent =
	| {
			readonly type: "message";
			readonly source: ChannelSource;
			readonly text: string;
	  }
	| {
			readonly type: "action";
			readonly source: ChannelSource;
			readonly value: string;
	  };

export interface ChannelAction {
	readonly label: string;
	readonly value: string;
}

export interface ChannelOutput {
	readonly target: ChannelTarget;
	readonly text: string;
	readonly replyToMessageId?: string;
	readonly actions?: readonly ChannelAction[];
}

export type ChannelEventHandler = (event: ChannelEvent) => Promise<void>;
export type ChannelAdapterFailureHandler = (error: unknown) => void;

export interface ChannelAdapter {
	readonly name: string;
	/**
	 * A fatal transport failure must call onFailure before waiting for owned
	 * handlers to drain. This lets the gateway cancel model and approval waits;
	 * run still rejects with the transport failure after cleanup completes.
	 */
	run(
		handler: ChannelEventHandler,
		signal: AbortSignal,
		onFailure?: ChannelAdapterFailureHandler,
	): Promise<void>;
	send(output: ChannelOutput): Promise<void>;
}

export function toChannelTarget(source: ChannelTargetSource): ChannelTarget {
	return {
		channel: source.channel,
		conversationId: source.conversationId,
		threadId: source.threadId,
	};
}
