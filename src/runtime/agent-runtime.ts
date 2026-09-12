import { randomUUIDv7 } from "bun";
import type { ContextUsage, PreparedContext } from "../context";
import {
	createEventMetadata,
	publishRuntimeEvent,
	type RuntimeEventPublisher,
	type RuntimeSource,
	type TurnContext,
} from "../events";
import type {
	ConfigurableAgentRuntimeSession,
	RuntimeConfigurationResult,
} from "./reloadable-agent-session";

export interface AgentTurnSession {
	chat(message: string, turnContext: TurnContext): Promise<string>;
}

export interface AgentRuntimeSession extends AgentTurnSession {
	getMessageCount(): number;
	getContextUsage(source: RuntimeSource): ContextUsage;
	compactContext(turnContext: TurnContext): Promise<PreparedContext>;
}

export interface AgentTurnInput {
	readonly content: string;
	readonly source: RuntimeSource;
	/** Abort to give up on the turn; it stops instead of running to completion. */
	readonly signal?: AbortSignal;
}

export interface AgentTurnResult {
	readonly turnId: string;
	readonly content: string;
}

export interface AgentRuntimeOptions {
	readonly sessionId: string;
	readonly session: ConfigurableAgentRuntimeSession;
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

	getContextUsage(source: RuntimeSource = { kind: "cli" }): ContextUsage {
		return this.options.session.getContextUsage(source);
	}

	/**
	 * `/compact` is not a model turn, but it is slow and it rewrites what the
	 * agent remembers — so it reports through the same channel, under a source
	 * that says who asked for it.
	 */
	compactContext(
		options: { readonly source?: RuntimeSource } = {},
	): Promise<PreparedContext> {
		return this.enqueue(async () => {
			const turnContext = this.createTurnContext(
				options.source ?? { kind: "system", name: "compact" },
			);

			await this.refreshConfiguration(false, turnContext);
			return this.options.session.compactContext(turnContext);
		});
	}

	reloadConfiguration(
		options: { readonly force?: boolean; readonly source?: RuntimeSource } = {},
	): Promise<RuntimeConfigurationResult> {
		return this.enqueue(() => {
			const turnContext = this.createTurnContext(
				options.source ?? { kind: "system", name: "config-poll" },
			);

			return this.refreshConfiguration(options.force ?? false, turnContext);
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.tail.then(operation);

		this.tail = run.then(
			() => undefined,
			() => undefined,
		);

		return run;
	}

	private createTurnContext(
		source: RuntimeSource,
		signal?: AbortSignal,
	): TurnContext {
		return {
			sessionId: this.options.sessionId,
			turnId: randomUUIDv7(),
			source,
			events: this.options.events,
			signal,
		};
	}

	private async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
		const turnContext = this.createTurnContext(input.source, input.signal);

		publishRuntimeEvent(this.options.events, {
			...createEventMetadata(turnContext),
			type: "turn.started",
			inputLength: input.content.length,
		});
		const startedAt = performance.now();

		try {
			await this.refreshConfiguration(false, turnContext);
			input.signal?.throwIfAborted();
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

			// A turn that stopped because it was asked to is not a broken turn,
			// however the abort surfaced — a rejected request or a checkpoint.
			publishRuntimeEvent(
				this.options.events,
				input.signal?.aborted === true
					? {
							...createEventMetadata(turnContext),
							type: "turn.cancelled",
							durationMs,
						}
					: {
							...createEventMetadata(turnContext),
							type: "turn.failed",
							durationMs,
							error: {
								name: error instanceof Error ? error.name : "Error",
								message: error instanceof Error ? error.message : String(error),
							},
						},
			);

			throw error;
		}
	}

	private async refreshConfiguration(
		force: boolean,
		turnContext: TurnContext,
	): Promise<RuntimeConfigurationResult> {
		const result = await this.options.session.refreshConfiguration({ force });

		if (result.status === "reloaded") {
			publishRuntimeEvent(this.options.events, {
				...createEventMetadata(turnContext),
				type: "config.reloaded",
				revision: result.revision,
				changedSections: result.changedSections,
				runtimeRebuilt: result.runtimeRebuilt,
				model: result.info.model,
				toolNames: result.info.toolNames,
			});
		}

		if (result.status === "rejected") {
			publishRuntimeEvent(this.options.events, {
				...createEventMetadata(turnContext),
				type: "config.reload.failed",
				retainedRevision: result.retainedRevision,
				phase: result.phase,
				error: {
					name: result.error.name,
					message: result.error.message,
				},
			});
		}

		return result;
	}
}
