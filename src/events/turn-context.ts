import type { RuntimeEventPublisher } from "./event-bus";

export type RuntimeSource =
	| {
			readonly kind: "cli";
	  }
	| {
			readonly kind: "channel";
			readonly channel: string;
			readonly conversationId: string;
			readonly threadId?: string;
			readonly userId?: string;
	  }
	| {
			readonly kind: "system";
			readonly name: string;
	  };

export interface TurnContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly source: RuntimeSource;
	readonly events: RuntimeEventPublisher;
}
