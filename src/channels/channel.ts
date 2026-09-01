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

export interface ChannelAdapter {
	readonly name: string;
	run(handler: ChannelEventHandler, signal: AbortSignal): Promise<void>;
	send(output: ChannelOutput): Promise<void>;
}

export function toChannelTarget(source: ChannelSource): ChannelTarget {
	return {
		channel: source.channel,
		conversationId: source.conversationId,
		threadId: source.threadId,
	};
}
