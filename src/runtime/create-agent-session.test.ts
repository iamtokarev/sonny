import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config, ConfigSnapshot } from "../config";
import { InMemoryRuntimeEventBus, type RuntimeEvent } from "../events";
import { HistoryStore } from "../history";
import { AgentRuntime } from "./agent-runtime";
import { createAgentSession } from "./create-agent-session";
import type { RuntimeConfigStore } from "./reloadable-agent-session";

describe("createAgentSession", () => {
	async function createTestConfig(): Promise<Config> {
		const workspace = await mkdtemp(join(tmpdir(), "sonny-session-"));
		const agentPath = join(workspace, "agents", "sonny");

		await mkdir(agentPath, { recursive: true });
		await writeFile(
			join(agentPath, "AGENT.md"),
			`---
name: Sonny
description: Test assistant
---
You are Sonny.
`,
		);

		return {
			workspace,
			defaultAgent: "sonny",
			agentsPath: "agents",
			contextCompaction: {
				contextWindowTokens: 200_000,
				thresholdRatio: 0.75,
				maxToolResultChars: 10_000,
				protectedHeadMessages: 4,
				protectedTailMessages: 6,
				summaryMaxTokens: 4000,
			},
			llm: {
				model: "gpt-test",
				apiKey: "test-key",
				temperature: 0.7,
				maxTokens: 2048,
			},
		};
	}

	function createEventBus(): InMemoryRuntimeEventBus {
		return new InMemoryRuntimeEventBus();
	}

	function createConfigStore(config: Config): RuntimeConfigStore {
		const snapshot: ConfigSnapshot = {
			revision: 1,
			loadedAt: new Date(),
			config,
		};

		return {
			current: snapshot,
			refresh: async () => ({ status: "unchanged", snapshot }),
		};
	}

	test("creates an agent session from config", async () => {
		const config = await createTestConfig();

		const result = await createAgentSession({
			configStore: createConfigStore(config),
			events: createEventBus(),
			approveToolCall: async () => ({
				approved: true,
			}),
		});

		expect(result.runtime).toBeInstanceOf(AgentRuntime);
		expect(result.mode).toBe("new");
		expect(result.restoredMessageCount).toBe(0);
		expect(result.restoredMessages).toEqual([]);
	});

	test("rebuilds a factory-created runtime from a newer config snapshot", async () => {
		const initialConfig = await createTestConfig();
		const nextConfig: Config = {
			...initialConfig,
			llm: {
				...initialConfig.llm,
				model: "anthropic/model-b",
				reasoningEffort: "high",
			},
		};
		const initialSnapshot: ConfigSnapshot = {
			revision: 1,
			loadedAt: new Date(),
			config: initialConfig,
		};
		const nextSnapshot: ConfigSnapshot = {
			revision: 2,
			loadedAt: new Date(),
			config: nextConfig,
		};
		let current = initialSnapshot;
		let refreshCount = 0;
		const configStore: RuntimeConfigStore = {
			get current() {
				return current;
			},
			async refresh() {
				refreshCount += 1;

				if (refreshCount === 1) {
					return { status: "unchanged", snapshot: current };
				}

				current = nextSnapshot;
				return {
					status: "reloaded",
					snapshot: current,
					changedSections: ["llm"],
				};
			},
		};
		const eventBus = createEventBus();
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => events.push(event));
		const result = await createAgentSession({
			configStore,
			events: eventBus,
			approveToolCall: async () => ({ approved: true }),
		});

		await expect(
			result.runtime.reloadConfiguration({
				force: true,
				source: { kind: "system", name: "reload" },
			}),
		).resolves.toMatchObject({
			status: "reloaded",
			revision: 2,
			runtimeRebuilt: true,
			info: { model: "anthropic/model-b" },
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "config.reloaded",
			model: "anthropic/model-b",
			source: { kind: "system", name: "reload" },
		});
	});

	test("creates history session files", async () => {
		const config = await createTestConfig();

		await createAgentSession({
			configStore: createConfigStore(config),
			events: createEventBus(),
			approveToolCall: async () => ({
				approved: true,
			}),
		});

		const historyDirectory = join(config.workspace, ".history");
		const indexContent = await readFile(
			join(historyDirectory, "index.jsonl"),
			"utf8",
		);
		const sessionFiles = await readdir(join(historyDirectory, "sessions"));
		const historySession = JSON.parse(indexContent);

		expect(historySession).toMatchObject({
			agentId: "sonny",
			title: "Untitled session",
			messageCount: 0,
			systemPrompt: expect.stringContaining("You are Sonny."),
		});
		expect(sessionFiles).toEqual([`${historySession.id}.jsonl`]);
	});

	test("resumes an existing history session", async () => {
		const config = await createTestConfig();
		const historyStore = new HistoryStore(join(config.workspace, ".history"));
		const existingSession = historyStore.createSession({
			id: "session-to-resume",
			agentId: "sonny",
			systemPrompt: "Stored prompt.",
		});
		historyStore.appendMessage(existingSession.id, {
			role: "user",
			content: "Previous message",
		});

		const result = await createAgentSession({
			configStore: createConfigStore(config),
			events: createEventBus(),
			approveToolCall: async () => ({
				approved: true,
			}),
			resumeSessionId: existingSession.id,
		});

		expect(result.mode).toBe("resume");
		expect(result.historySession.id).toBe(existingSession.id);
		expect(result.restoredMessageCount).toBe(1);
		expect(result.restoredMessages).toEqual([
			{ role: "user", content: "Previous message" },
		]);
		expect(result.historySession.systemPrompt).toBe("Stored prompt.");
	});

	test("continues the latest non-empty history session", async () => {
		const config = await createTestConfig();
		const historyStore = new HistoryStore(join(config.workspace, ".history"));
		historyStore.createSession({
			id: "empty-session",
			agentId: "sonny",
			systemPrompt: "Empty prompt.",
		});
		const olderSession = historyStore.createSession({
			id: "older-session",
			agentId: "sonny",
			systemPrompt: "Older prompt.",
		});
		const newerSession = historyStore.createSession({
			id: "newer-session",
			agentId: "sonny",
			systemPrompt: "Newer prompt.",
		});

		historyStore.appendMessage(olderSession.id, {
			role: "user",
			content: "Older message",
		});
		await new Promise((resolve) => setTimeout(resolve, 2));
		historyStore.appendMessage(newerSession.id, {
			role: "user",
			content: "Newer message",
		});

		const result = await createAgentSession({
			configStore: createConfigStore(config),
			events: createEventBus(),
			approveToolCall: async () => ({
				approved: true,
			}),
			continueLatest: true,
		});

		expect(result.mode).toBe("continue");
		expect(result.historySession.id).toBe(newerSession.id);
		expect(result.restoredMessageCount).toBe(1);
		expect(result.restoredMessages).toEqual([
			{ role: "user", content: "Newer message" },
		]);
		expect(result.historySession.systemPrompt).toBe("Newer prompt.");
	});

	test("throws clear error when resume session is missing", async () => {
		const config = await createTestConfig();

		await expect(
			createAgentSession({
				configStore: createConfigStore(config),
				events: createEventBus(),
				approveToolCall: async () => ({
					approved: true,
				}),
				resumeSessionId: "missing-session",
			}),
		).rejects.toThrow("Session not found: missing-session");
	});

	test("throws clear error when there is no session to continue", async () => {
		const config = await createTestConfig();

		await expect(
			createAgentSession({
				configStore: createConfigStore(config),
				events: createEventBus(),
				approveToolCall: async () => ({
					approved: true,
				}),
				continueLatest: true,
			}),
		).rejects.toThrow("No previous session found to continue");
	});

	test("rejects resume and continue together", async () => {
		const config = await createTestConfig();

		await expect(
			createAgentSession({
				configStore: createConfigStore(config),
				events: createEventBus(),
				approveToolCall: async () => ({
					approved: true,
				}),
				resumeSessionId: "session-id",
				continueLatest: true,
			}),
		).rejects.toThrow(
			"Use either resumeSessionId or continueLatest, not both.",
		);
	});
});
