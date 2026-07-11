import { describe, expect, test } from "bun:test";
import type { HistorySession } from "../history";
import type { CreateAgentSessionResult } from "../runtime";
import {
	createRestoredUiMessages,
	formatSessionExitSummary,
	formatSessionStartupMessage,
} from "./chat-loop";

function createHistorySession(
	overrides: Partial<HistorySession> = {},
): HistorySession {
	return {
		id: "session-1",
		agentId: "sonny",
		title: "Useful task",
		messageCount: 2,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:01.000Z",
		systemPrompt: "stored system prompt",
		...overrides,
	};
}

function createSessionResult(
	overrides: Partial<CreateAgentSessionResult> = {},
): CreateAgentSessionResult {
	return {
		session: {} as CreateAgentSessionResult["session"],
		historySession: createHistorySession(),
		restoredMessageCount: 2,
		restoredMessages: [],
		skills: [],
		mode: "resume",
		...overrides,
	};
}

describe("formatSessionStartupMessage", () => {
	test("does not format a startup message for new sessions", () => {
		expect(
			formatSessionStartupMessage(createSessionResult({ mode: "new" })),
		).toBe(null);
	});

	test("formats resume startup message with title", () => {
		expect(formatSessionStartupMessage(createSessionResult())).toBe(
			"↻ Resumed Useful task (2 messages)",
		);
	});

	test("falls back to session id for untitled sessions", () => {
		expect(
			formatSessionStartupMessage(
				createSessionResult({
					historySession: createHistorySession({
						id: "session-2",
						title: "Untitled session",
					}),
					mode: "continue",
					restoredMessageCount: 5,
				}),
			),
		).toBe("↻ Resumed session-2 (5 messages)");
	});
});

describe("createRestoredUiMessages", () => {
	test("converts persisted user and assistant messages to UI messages", () => {
		expect(
			createRestoredUiMessages([
				{ role: "system", content: "system prompt" },
				{ role: "user", content: "Previous question" },
				{ role: "assistant", content: "Previous answer" },
			]),
		).toEqual([
			{ role: "user", content: "Previous question" },
			{ role: "assistant", content: "Previous answer" },
		]);
	});

	test("reconstructs compact tool messages from persisted tool calls", () => {
		expect(
			createRestoredUiMessages([
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "tool-call-1",
							name: "bash",
							parameters: { command: "bun test" },
						},
					],
				},
				{
					role: "tool",
					toolCallId: "tool-call-1",
					content: JSON.stringify({
						stdout: "pass",
						stderr: "",
						exitCode: 0,
					}),
				},
			]),
		).toEqual([{ role: "tool", content: "bash  bun test  pass" }]);
	});

	test("marks restored denied tool messages without blocked text", () => {
		expect(
			createRestoredUiMessages([
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "tool-call-1",
							name: "readFile",
							parameters: { path: ".env" },
						},
					],
				},
				{
					role: "tool",
					toolCallId: "tool-call-1",
					content: "BLOCKED: secret",
				},
			]),
		).toEqual([{ role: "tool", content: "readFile  .env  [denied]" }]);
	});
});

describe("formatSessionExitSummary", () => {
	test("returns null without a created session", () => {
		expect(formatSessionExitSummary(null)).toBe(null);
	});

	test("formats resume command for a created session", () => {
		expect(formatSessionExitSummary(createSessionResult())).toBe(
			["", "Resume this session with:", "  sonny chat --resume session-1"].join(
				"\n",
			),
		);
	});
});
