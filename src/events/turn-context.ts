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
	/**
	 * Aborted when the caller gives up on this turn. Everything the turn does
	 * downstream is expected to stop at its next checkpoint rather than run to
	 * completion for nobody.
	 */
	readonly signal?: AbortSignal;
}
