import { describe, expect, test } from "bun:test";
import {
	InMemoryRuntimeEventBus,
	type RuntimeEvent,
	type TurnContext,
} from "../events";
import {
	AgentRuntime,
	type AgentTurnInput,
	type AgentTurnSession,
} from "./agent-runtime";
import type {
	ConfigurableAgentRuntimeSession,
	RuntimeConfigurationResult,
} from "./reloadable-agent-session";

type Deferred<T> = {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

function createInput(content: string): AgentTurnInput {
	return {
		content,
		source: { kind: "cli" },
	};
}

function createRuntime(
	session: AgentTurnSession &
		Partial<Omit<ConfigurableAgentRuntimeSession, "chat">>,
	eventBus: InMemoryRuntimeEventBus,
): AgentRuntime {
	const unchanged: RuntimeConfigurationResult = {
		status: "unchanged",
		revision: 1,
		info: { model: "openai/model-a", toolNames: ["bash"] },
	};

	return new AgentRuntime({
		sessionId: "session-1",
		session: {
			getMessageCount: () => 0,
			getContextUsage: () => ({
				tokenCount: 0,
				contextWindowTokens: 200_000,
				thresholdTokens: 150_000,
				thresholdRatio: 0.75,
			}),
			compactContext: async () => ({
				messages: [],
				tokenCountBefore: 0,
				tokenCountAfter: 0,
				thresholdTokens: 150_000,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			}),
			refreshConfiguration: async () => unchanged,
			...session,
		},
		events: eventBus,
	});
}

describe("AgentRuntime", () => {
	test("refreshes configuration after turn start and before chat", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const activity: string[] = [];
		eventBus.subscribe((event) => activity.push(event.type));
		const runtime = createRuntime(
			{
				async refreshConfiguration() {
					activity.push("refresh");
					return {
						status: "unchanged",
						revision: 1,
						info: { model: "openai/model-a", toolNames: [] },
					};
				},
				async chat() {
					activity.push("chat");
					return "Response";
				},
			},
			eventBus,
		);

		await runtime.runTurn(createInput("Hello"));

		expect(activity).toEqual([
			"turn.started",
			"refresh",
			"chat",
			"turn.completed",
		]);
	});

	test("reports a rejected refresh and continues the turn", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => events.push(event));
		const runtime = createRuntime(
			{
				async refreshConfiguration() {
					return {
						status: "rejected",
						retainedRevision: 3,
						phase: "load",
						error: new Error("safe configuration failure"),
					} as RuntimeConfigurationResult;
				},
				async chat() {
					return "Response from retained runtime";
				},
			},
			eventBus,
		);

		await expect(runtime.runTurn(createInput("Hello"))).resolves.toMatchObject({
			content: "Response from retained runtime",
		});
		expect(events.map((event) => event.type)).toEqual([
			"turn.started",
			"config.reload.failed",
			"turn.completed",
		]);
		expect(events[1]).toMatchObject({
			retainedRevision: 3,
			phase: "load",
			error: { name: "Error", message: "safe configuration failure" },
		});
	});

	test("publishes safe metadata for an applied runtime rebuild", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => events.push(event));
		const runtime = createRuntime(
			{
				async refreshConfiguration() {
					return {
						status: "reloaded",
						revision: 2,
						changedSections: ["llm"],
						runtimeRebuilt: true,
						info: {
							model: "anthropic/model-b",
							toolNames: ["bash", "readFile"],
						},
					};
				},
				chat: async () => "Response",
			},
			eventBus,
		);

		await runtime.runTurn(createInput("Hello"));

		expect(events[1]).toMatchObject({
			type: "config.reloaded",
			revision: 2,
			changedSections: ["llm"],
			runtimeRebuilt: true,
			model: "anthropic/model-b",
			toolNames: ["bash", "readFile"],
		});
		expect(JSON.stringify(events[1])).not.toContain("apiKey");
	});
	test("emits correlated lifecycle events around a successful turn", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const events: RuntimeEvent[] = [];
		const activity: string[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
			activity.push(event.type);
		});
		const session: AgentTurnSession = {
			async chat(message: string, turnContext: TurnContext) {
				activity.push("session.chat");
				expect(message).toBe("Hello");
				expect(turnContext.sessionId).toBe("session-1");
				return "Hi";
			},
		};
		const runtime = createRuntime(session, eventBus);

		const result = await runtime.runTurn(createInput("Hello"));

		expect(activity).toEqual([
			"turn.started",
			"session.chat",
			"turn.completed",
		]);
		expect(result.content).toBe("Hi");
		expect(result.turnId).not.toBe("");
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "turn.started",
			sessionId: "session-1",
			turnId: result.turnId,
			source: { kind: "cli" },
			inputLength: 5,
		});
		expect(events[1]).toMatchObject({
			type: "turn.completed",
			sessionId: "session-1",
			turnId: result.turnId,
			source: { kind: "cli" },
			responseLength: 2,
		});
	});

	test("reports an aborted turn as cancelled rather than failed", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const abort = new AbortController();
		const session: AgentTurnSession = {
			async chat(_message, turnContext) {
				abort.abort();
				turnContext.signal?.throwIfAborted();

				return "unreachable";
			},
		};
		const runtime = createRuntime(session, eventBus);

		await expect(
			runtime.runTurn({ ...createInput("Hello"), signal: abort.signal }),
		).rejects.toThrow();

		expect(events.map((event) => event.type)).toEqual([
			"turn.started",
			"turn.cancelled",
		]);
	});

	test("passes the caller's signal to the session so a turn can stop early", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const abort = new AbortController();
		let seen: AbortSignal | undefined;
		const runtime = createRuntime(
			{
				async chat(_message, turnContext) {
					seen = turnContext.signal;

					return "Hi";
				},
			},
			eventBus,
		);

		await runtime.runTurn({ ...createInput("Hello"), signal: abort.signal });

		expect(seen).toBe(abort.signal);
	});

	test("emits a failed event and rethrows the original error", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const failure = new TypeError("Session failed");
		const session: AgentTurnSession = {
			async chat() {
				throw failure;
			},
		};
		const runtime = createRuntime(session, eventBus);

		await expect(runtime.runTurn(createInput("Hello"))).rejects.toBe(failure);

		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			type: "turn.failed",
			sessionId: "session-1",
			error: {
				name: "TypeError",
				message: "Session failed",
			},
		});
		expect(events[1]?.turnId).toBe(events[0]?.turnId);
	});

	test("serializes concurrent turns", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const firstStarted = createDeferred<void>();
		const releaseFirst = createDeferred<void>();
		const calls: string[] = [];
		const session: AgentTurnSession = {
			async chat(message: string) {
				calls.push(message);

				if (message === "first") {
					firstStarted.resolve();
					await releaseFirst.promise;
				}

				return `${message} response`;
			},
		};
		const runtime = createRuntime(session, eventBus);

		const firstRun = runtime.runTurn(createInput("first"));
		await firstStarted.promise;
		const secondRun = runtime.runTurn(createInput("second"));

		await Promise.resolve();
		expect(calls).toEqual(["first"]);

		releaseFirst.resolve();
		const [firstResult, secondResult] = await Promise.all([
			firstRun,
			secondRun,
		]);

		expect(calls).toEqual(["first", "second"]);
		expect(firstResult.content).toBe("first response");
		expect(secondResult.content).toBe("second response");
	});

	test("continues with the next queued turn after a failure", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const calls: string[] = [];
		const session: AgentTurnSession = {
			async chat(message: string) {
				calls.push(message);

				if (message === "first") {
					throw new Error("First turn failed");
				}

				return "Second turn succeeded";
			},
		};
		const runtime = createRuntime(session, eventBus);

		const firstRun = runtime.runTurn(createInput("first"));
		const secondRun = runtime.runTurn(createInput("second"));

		await expect(firstRun).rejects.toThrow("First turn failed");
		await expect(secondRun).resolves.toMatchObject({
			content: "Second turn succeeded",
		});
		expect(calls).toEqual(["first", "second"]);
	});

	test("does not fail a turn when an event subscriber fails", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		eventBus.subscribe(() => {
			throw new Error("Subscriber failed");
		});
		const session: AgentTurnSession = {
			async chat() {
				return "Response";
			},
		};
		const runtime = createRuntime(session, eventBus);

		await expect(runtime.runTurn(createInput("Hello"))).resolves.toMatchObject({
			content: "Response",
		});
	});

	test("exposes session inspection through the runtime", () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const usage = {
			tokenCount: 42,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		};
		const runtime = createRuntime(
			{
				async chat() {
					return "Response";
				},
				getMessageCount: () => 7,
				getContextUsage: () => usage,
			},
			eventBus,
		);

		expect(runtime.getMessageCount()).toBe(7);
		expect(runtime.getContextUsage()).toBe(usage);
	});

	test("queues context compaction behind the active turn", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const turnStarted = createDeferred<void>();
		const releaseTurn = createDeferred<void>();
		const activity: string[] = [];
		const compactedContext = {
			messages: [],
			tokenCountBefore: 100,
			tokenCountAfter: 50,
			thresholdTokens: 150_000,
			changed: true,
			compactedToolResultCount: 1,
			summaryCompactedMessageCount: 0,
		};
		const runtime = createRuntime(
			{
				async chat() {
					activity.push("turn");
					turnStarted.resolve();
					await releaseTurn.promise;
					return "Response";
				},
				async compactContext() {
					activity.push("compact");
					return compactedContext;
				},
			},
			eventBus,
		);

		const turn = runtime.runTurn(createInput("Hello"));
		await turnStarted.promise;
		const compaction = runtime.compactContext();

		await Promise.resolve();
		expect(activity).toEqual(["turn"]);

		releaseTurn.resolve();
		await expect(turn).resolves.toMatchObject({ content: "Response" });
		await expect(compaction).resolves.toBe(compactedContext);
		expect(activity).toEqual(["turn", "compact"]);
	});

	test("gives manual compaction its own correlated, system-sourced context", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		let compactionContext: TurnContext | undefined;
		const runtime = createRuntime(
			{
				chat: async () => "Response",
				async compactContext(turnContext) {
					compactionContext = turnContext;

					return {
						messages: [],
						tokenCountBefore: 0,
						tokenCountAfter: 0,
						thresholdTokens: 150_000,
						changed: false,
						compactedToolResultCount: 0,
						summaryCompactedMessageCount: 0,
					};
				},
			},
			eventBus,
		);

		await runtime.runTurn(createInput("Hello"));
		await runtime.compactContext();

		expect(compactionContext?.sessionId).toBe("session-1");
		expect(compactionContext?.source).toEqual({
			kind: "system",
			name: "compact",
		});
	});
});
