import { describe, expect, mock, test } from "bun:test";
import type {
	ConfigRefreshResult,
	ConfigSnapshot,
	ResolvedConfig,
} from "../config";
import { ConfigReloadError } from "../config";
import {
	InMemoryRuntimeEventBus,
	type RuntimeSource,
	type TurnContext,
} from "../events";
import type { AgentRuntimeSession } from "./agent-runtime";
import {
	type AgentSessionBuilder,
	ReloadableAgentSession,
	type RuntimeConfigStore,
} from "./reloadable-agent-session";

function createConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		workspace: "/workspace",
		defaultAgent: "sonny",
		agentsPath: "agents",
		llm: {
			model: "openai/model-a",
			apiKey: "key-a",
			temperature: 0.7,
			maxTokens: 2048,
		},
		contextCompaction: {
			contextWindowTokens: 200_000,
			thresholdRatio: 0.75,
			maxToolResultChars: 10_000,
			protectedHeadMessages: 4,
			protectedTailMessages: 6,
			summaryMaxTokens: 4000,
		},
		channels: {
			telegram: {
				enabled: false,
				allowedUserIds: [],
			},
		},
		...overrides,
	};
}

function createSnapshot(
	revision: number,
	config: ResolvedConfig = createConfig(),
): ConfigSnapshot {
	return { revision, loadedAt: new Date(), config };
}

function createSession(label: string): AgentRuntimeSession {
	return {
		chat: mock(async () => `${label} response`),
		getMessageCount: () => 4,
		getContextUsage: () => ({
			tokenCount: 100,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		}),
		compactContext: async () => ({
			messages: [],
			tokenCountBefore: 100,
			tokenCountAfter: 100,
			thresholdTokens: 150_000,
			changed: false,
			compactedToolResultCount: 0,
			summaryCompactedMessageCount: 0,
		}),
	};
}

function createStore(
	initial: ConfigSnapshot,
	refresh: () => Promise<ConfigRefreshResult>,
): RuntimeConfigStore {
	return { current: initial, refresh };
}

function createTurnContext(signal?: AbortSignal): TurnContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" },
		events: new InMemoryRuntimeEventBus(),
		signal,
	};
}

describe("ReloadableAgentSession", () => {
	test("delegates execution and preserves the turn context", async () => {
		const snapshot = createSnapshot(1);
		const session = createSession("initial");
		const store = createStore(snapshot, async () => ({
			status: "unchanged",
			snapshot,
		}));
		const wrapper = new ReloadableAgentSession(
			store,
			() => ({ session, info: { model: "unused", toolNames: [] } }),
			snapshot,
			{ session, info: { model: "openai/model-a", toolNames: ["bash"] } },
		);
		const abort = new AbortController();
		const context = createTurnContext(abort.signal);

		await expect(wrapper.chat("hello", context)).resolves.toBe(
			"initial response",
		);
		expect(session.chat).toHaveBeenCalledWith("hello", context);
		expect(wrapper.getMessageCount()).toBe(4);
	});

	test("forwards source-aware context inspection and compaction", async () => {
		const snapshot = createSnapshot(1);
		const source: RuntimeSource = {
			kind: "channel",
			channel: "telegram",
			conversationId: "conversation-1",
			conversationKind: "direct",
			userId: "user-1",
		};
		const usage = {
			tokenCount: 100,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		};
		const prepared = {
			messages: [],
			tokenCountBefore: 100,
			tokenCountAfter: 100,
			thresholdTokens: 150_000,
			changed: false,
			compactedToolResultCount: 0,
			summaryCompactedMessageCount: 0,
		};
		const getContextUsage = mock((_source: RuntimeSource) => usage);
		const compactContext = mock(async (_context: TurnContext) => prepared);
		const session: AgentRuntimeSession = {
			...createSession("initial"),
			getContextUsage,
			compactContext,
		};
		const wrapper = new ReloadableAgentSession(
			createStore(snapshot, async () => ({ status: "unchanged", snapshot })),
			() => ({ session, info: { model: "unused", toolNames: [] } }),
			snapshot,
			{ session, info: { model: "openai/model-a", toolNames: [] } },
		);
		const turnContext = { ...createTurnContext(), source };

		expect(wrapper.getContextUsage(source)).toBe(usage);
		await expect(wrapper.compactContext(turnContext)).resolves.toBe(prepared);
		expect(getContextUsage).toHaveBeenCalledWith(source);
		expect(compactContext).toHaveBeenCalledWith(turnContext);
	});

	test("atomically rebuilds for OpenRouter configuration changes", async () => {
		const initialSnapshot = createSnapshot(1);
		const nextSnapshot = createSnapshot(
			2,
			createConfig({
				llm: {
					...initialSnapshot.config.llm,
					model: "anthropic/model-b",
					reasoningEffort: "high",
				},
			}),
		);
		const initialSession = createSession("initial");
		const replacementSession = createSession("replacement");
		const builder = mock<AgentSessionBuilder>(() => ({
			session: replacementSession,
			info: { model: "anthropic/model-b", toolNames: ["bash"] },
		}));
		const wrapper = new ReloadableAgentSession(
			createStore(initialSnapshot, async () => ({
				status: "reloaded",
				snapshot: nextSnapshot,
				changedSections: ["llm"],
			})),
			builder,
			initialSnapshot,
			{
				session: initialSession,
				info: { model: "openai/model-a", toolNames: ["bash"] },
			},
		);

		await expect(wrapper.refreshConfiguration()).resolves.toMatchObject({
			status: "reloaded",
			revision: 2,
			runtimeRebuilt: true,
		});
		expect(builder).toHaveBeenCalledWith(nextSnapshot.config);
		await expect(wrapper.chat("hello", createTurnContext())).resolves.toBe(
			"replacement response",
		);
	});

	test("applies future-session defaults without rebuilding", async () => {
		const initialSnapshot = createSnapshot(1);
		const nextSnapshot = createSnapshot(
			2,
			createConfig({ defaultAgent: "other" }),
		);
		const session = createSession("initial");
		const builder = mock<AgentSessionBuilder>(() => {
			throw new Error("must not rebuild");
		});
		const wrapper = new ReloadableAgentSession(
			createStore(initialSnapshot, async () => ({
				status: "reloaded",
				snapshot: nextSnapshot,
				changedSections: ["sessionDefaults"],
			})),
			builder,
			initialSnapshot,
			{
				session,
				info: { model: "openai/model-a", toolNames: [] },
			},
		);

		await expect(wrapper.refreshConfiguration()).resolves.toMatchObject({
			status: "reloaded",
			revision: 2,
			runtimeRebuilt: false,
		});
		expect(builder).not.toHaveBeenCalled();
	});

	test("retains the active session when applying a valid snapshot fails", async () => {
		const initialSnapshot = createSnapshot(1);
		const nextSnapshot = createSnapshot(
			2,
			createConfig({
				llm: { ...initialSnapshot.config.llm, model: "openai/model-b" },
			}),
		);
		const session = createSession("initial");
		const builder = mock<AgentSessionBuilder>(() => {
			throw new Error("construction failed");
		});
		const store = createStore(initialSnapshot, async () => ({
			status: "unchanged",
			snapshot: nextSnapshot,
		}));
		const wrapper = new ReloadableAgentSession(
			store,
			builder,
			initialSnapshot,
			{
				session,
				info: { model: "openai/model-a", toolNames: [] },
			},
		);

		await expect(wrapper.refreshConfiguration()).resolves.toMatchObject({
			status: "rejected",
			retainedRevision: 1,
			phase: "apply",
		});
		await expect(wrapper.chat("hello", createTurnContext())).resolves.toBe(
			"initial response",
		);
		await wrapper.refreshConfiguration();
		expect(builder).toHaveBeenCalledTimes(1);
		await wrapper.refreshConfiguration({ force: true });
		expect(builder).toHaveBeenCalledTimes(2);
	});

	test("returns load rejection without invoking the builder", async () => {
		const snapshot = createSnapshot(1);
		const session = createSession("initial");
		const builder = mock<AgentSessionBuilder>(() => ({
			session,
			info: { model: "unused", toolNames: [] },
		}));
		const wrapper = new ReloadableAgentSession(
			createStore(snapshot, async () => ({
				status: "rejected",
				snapshot,
				error: new ConfigReloadError("safe failure"),
			})),
			builder,
			snapshot,
			{
				session,
				info: { model: "openai/model-a", toolNames: [] },
			},
		);

		await expect(wrapper.refreshConfiguration()).resolves.toMatchObject({
			status: "rejected",
			retainedRevision: 1,
			phase: "load",
		});
		expect(builder).not.toHaveBeenCalled();
	});
});
