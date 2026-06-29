import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore } from "./history-store";

const _SESSION_ID = "test-session";
const _AGENT_ID = "sonny";
const _SYSTEM_PROMPT = "You are Sonny.";

async function createTempHistoryDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "history"));
}

describe("history-store", () => {
	test("creates session metadata", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);

		const session = store.createSession({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		expect(session).toEqual({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			title: "Untitled session",
			messageCount: 0,
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
			systemPrompt: _SYSTEM_PROMPT,
		});
	});

	test("persists created session", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);

		store.createSession({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		const indexContent = await readFile(
			join(historyDir, "index.jsonl"),
			"utf8",
		);
		const sessionFileContent = await readFile(
			join(historyDir, "sessions", `${_SESSION_ID}.jsonl`),
			"utf8",
		);

		expect(JSON.parse(indexContent)).toMatchObject({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			title: "Untitled session",
			messageCount: 0,
			systemPrompt: _SYSTEM_PROMPT,
		});
		expect(sessionFileContent).toBe("");
	});

	test("appends message to session history", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);
		store.createSession({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		store.appendMessage(_SESSION_ID, {
			role: "assistant",
			content: "Hello from Sonny.",
		});

		const sessionFileContent = await readFile(
			join(historyDir, "sessions", `${_SESSION_ID}.jsonl`),
			"utf8",
		);
		const [messageLine] = sessionFileContent.trim().split("\n");
		expect(messageLine).toBeDefined();

		if (messageLine === undefined) {
			throw new Error("Expected one history message line");
		}

		expect(JSON.parse(messageLine)).toEqual({
			role: "assistant",
			content: "Hello from Sonny.",
			timestamp: expect.any(String),
		});
	});

	test("updates session metadata when appending messages", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);
		store.createSession({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		store.appendMessage(_SESSION_ID, {
			role: "user",
			content: "  Please   help me test persistence  ",
		});

		const indexContent = await readFile(
			join(historyDir, "index.jsonl"),
			"utf8",
		);
		const updatedSession = JSON.parse(indexContent);

		expect(updatedSession).toMatchObject({
			id: _SESSION_ID,
			title: "Please help me test persistence",
			messageCount: 1,
		});
		expect(updatedSession.updatedAt).toEqual(expect.any(String));
	});

	test("lists sessions sorted by last update", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);
		store.createSession({
			id: "older-session",
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});
		store.createSession({
			id: "newer-session",
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		store.appendMessage("older-session", {
			role: "user",
			content: "older",
		});
		await new Promise((resolve) => setTimeout(resolve, 2));
		store.appendMessage("newer-session", {
			role: "user",
			content: "newer",
		});

		expect(store.listSessions().map((session) => session.id)).toEqual([
			"newer-session",
			"older-session",
		]);
	});

	test("reads messages without history timestamps", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);
		store.createSession({
			id: _SESSION_ID,
			agentId: _AGENT_ID,
			systemPrompt: _SYSTEM_PROMPT,
		});

		store.appendMessage(_SESSION_ID, {
			role: "assistant",
			content: "I need to inspect a file.",
			toolCalls: [
				{
					id: "call-1",
					name: "readFile",
					parameters: { path: "src/index.ts" },
				},
			],
		});
		store.appendMessage(_SESSION_ID, {
			role: "tool",
			toolCallId: "call-1",
			content: "file contents",
		});

		expect(store.readMessages(_SESSION_ID)).toEqual([
			{
				role: "assistant",
				content: "I need to inspect a file.",
				toolCalls: [
					{
						id: "call-1",
						name: "readFile",
						parameters: { path: "src/index.ts" },
					},
				],
			},
			{
				role: "tool",
				toolCallId: "call-1",
				content: "file contents",
			},
		]);
	});

	test("returns empty messages for missing session file", async () => {
		const historyDir = await createTempHistoryDir();
		const store = new HistoryStore(historyDir);

		expect(store.readMessages("missing-session")).toEqual([]);
	});
});
