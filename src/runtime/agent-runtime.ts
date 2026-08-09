import { randomUUIDv7 } from "bun";
import type { ContextUsage, PreparedContext } from "../context";
import {
	createEventMetadata,
	publishRuntimeEvent,
	type RuntimeEventPublisher,
	type RuntimeSource,
	type TurnContext,
} from "../events";

export interface AgentTurnSession {
	chat(message: string, turnContext: TurnContext): Promise<string>;
}

export interface AgentRuntimeSession extends AgentTurnSession {
	getMessageCount(): number;
	getContextUsage(): ContextUsage;
	compactContext(): Promise<PreparedContext>;
}

export interface AgentTurnInput {
	readonly content: string;
	readonly source: RuntimeSource;
}

export interface AgentTurnResult {
	readonly turnId: string;
	readonly content: string;
}

export interface AgentRuntimeOptions {
	readonly sessionId: string;
	readonly session: AgentRuntimeSession;
	readonly events: RuntimeEventPublisher;
}

export class AgentRuntime {
	private tail: Promise<void> = Promise.resolve();

	constructor(private readonly options: AgentRuntimeOptions) {}

	runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
		return this.enqueue(() => this.executeTurn(input));
	}

	getMessageCount(): number {
		return this.options.session.getMessageCount();
	}

	getContextUsage(): ContextUsage {
		return this.options.session.getContextUsage();
	}

	compactContext(): Promise<PreparedContext> {
		return this.enqueue(() => this.options.session.compactContext());
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.tail.then(operation);

		this.tail = run.then(
			() => undefined,
			() => undefined,
		);

		return run;
	}

	private async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
		const turnContext: TurnContext = {
			sessionId: this.options.sessionId,
			turnId: randomUUIDv7(),
			source: input.source,
			events: this.options.events,
		};

		publishRuntimeEvent(this.options.events, {
			...createEventMetadata(turnContext),
			type: "turn.started",
			inputLength: input.content.length,
		});
		const startedAt = performance.now();

		try {
			const content = await this.options.session.chat(
				input.content,
				turnContext,
			);
			const durationMs = performance.now() - startedAt;

			publishRuntimeEvent(this.options.events, {
				...createEventMetadata(turnContext),
				type: "turn.completed",
				responseLength: content.length,
				durationMs,
			});

			return {
				turnId: turnContext.turnId,
				content,
			};
		} catch (error) {
			const durationMs = performance.now() - startedAt;

			publishRuntimeEvent(this.options.events, {
				...createEventMetadata(turnContext),
				type: "turn.failed",
				durationMs,
				error: {
					name: error instanceof Error ? error.name : "Error",
					message: error instanceof Error ? error.message : String(error),
				},
			});

			throw error;
		}
	}
}
