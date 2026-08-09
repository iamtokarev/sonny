import { randomUUIDv7 } from "bun";
import type { ToolCompletionStatus } from "../domain";
import type { RuntimeSource, TurnContext } from "./turn-context";

interface RuntimeEventBase {
	readonly eventId: string;
	readonly sessionId: string;
	readonly turnId: string;
	readonly source: RuntimeSource;
	readonly occurredAt: string;
}

export interface TurnStartedEvent extends RuntimeEventBase {
	readonly type: "turn.started";
	readonly inputLength: number;
}

export interface TurnCompletedEvent extends RuntimeEventBase {
	readonly type: "turn.completed";
	readonly responseLength: number;
	readonly durationMs: number;
}

export interface TurnFailedEvent extends RuntimeEventBase {
	readonly type: "turn.failed";
	readonly durationMs: number;
	readonly error: {
		readonly name: string;
		readonly message: string;
	};
}

/** The caller gave up on the turn; it stopped rather than broke. */
export interface TurnCancelledEvent extends RuntimeEventBase {
	readonly type: "turn.cancelled";
	readonly durationMs: number;
}

export interface ToolStartedEvent extends RuntimeEventBase {
	readonly type: "tool.started";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly parameters: unknown;
	readonly preview: string;
}

export interface ToolCompletedEvent extends RuntimeEventBase {
	readonly type: "tool.completed";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly parameters: unknown;
	readonly status: ToolCompletionStatus;
	readonly content: string;
	readonly durationMs: number;
}

/**
 * Compaction takes seconds — summarising calls the model — and it changes what
 * the agent remembers. Both facts are worth reporting, so it announces itself
 * before the expensive part rather than only describing the outcome.
 */
export interface ContextCompactionStartedEvent extends RuntimeEventBase {
	readonly type: "context.compaction.started";
	readonly tokenCount: number;
	readonly thresholdTokens: number;
	/** True for `/compact`, false when the threshold triggered it. */
	readonly forced: boolean;
}

export interface ContextCompactionCompletedEvent extends RuntimeEventBase {
	readonly type: "context.compaction.completed";
	readonly tokenCountBefore: number;
	readonly tokenCountAfter: number;
	readonly compactedToolResultCount: number;
	readonly summaryCompactedMessageCount: number;
	readonly changed: boolean;
	readonly durationMs: number;
}

export type RuntimeEvent =
	| TurnStartedEvent
	| TurnCompletedEvent
	| TurnFailedEvent
	| TurnCancelledEvent
	| ToolStartedEvent
	| ToolCompletedEvent
	| ContextCompactionStartedEvent
	| ContextCompactionCompletedEvent;

export function createEventMetadata(
	context: TurnContext,
): Pick<
	RuntimeEventBase,
	"eventId" | "sessionId" | "turnId" | "source" | "occurredAt"
> {
	return {
		eventId: randomUUIDv7(),
		sessionId: context.sessionId,
		turnId: context.turnId,
		source: context.source,
		occurredAt: new Date().toISOString(),
	};
}
