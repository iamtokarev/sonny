import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config";
import { AgentSession } from "./agent-session";
import { createAgentSession } from "./create-agent-session";
import { HistoryStore } from "./history-store";

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
				provider: "openai",
				model: "gpt-test",
				apiKey: "test-key",
				apiBase: null,
				temperature: 0.7,
				maxTokens: 2048,
			},
		};
	}

	test("creates an agent session from config", async () => {
		const config = await createTestConfig();

		const result = await createAgentSession({
			config,
			approveToolCall: async () => ({
				approved: true,
			}),
		});

		expect(result.session).toBeInstanceOf(AgentSession);
		expect(result.mode).toBe("new");
		expect(result.restoredMessageCount).toBe(0);
		expect(result.restoredMessages).toEqual([]);
	});

	test("accepts a tool event callback", async () => {
		const config = await createTestConfig();

		const result = await createAgentSession({
			config,
			approveToolCall: async () => ({
				approved: true,
			}),
			onToolEvent: () => {},
		});

		expect(result.session).toBeInstanceOf(AgentSession);
	});

	test("creates history session files", async () => {
		const config = await createTestConfig();

		await createAgentSession({
			config,
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
			config,
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
		expect(
			(result.session as unknown as { systemPrompt: string }).systemPrompt,
		).toBe("Stored prompt.");
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
			config,
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
		expect(
			(result.session as unknown as { systemPrompt: string }).systemPrompt,
		).toBe("Newer prompt.");
	});

	test("throws clear error when resume session is missing", async () => {
		const config = await createTestConfig();

		await expect(
			createAgentSession({
				config,
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
				config,
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
				config,
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
