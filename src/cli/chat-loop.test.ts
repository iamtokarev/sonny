import { describe, expect, test } from "bun:test";
import type { HistorySession } from "../history";
import type { CreateAgentSessionResult } from "../runtime";
import { restoreTranscript } from "../ui/transcript";
import {
	describeCompaction,
	describeCompactionStart,
	describeSessionHeader,
	formatSessionExitSummary,
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
		toolNames: ["bash", "readFile"],
		model: "gpt-5.4-mini",
		...overrides,
	};
}

describe("describeSessionHeader", () => {
	test("names Sonny and counts what the session actually got", () => {
		const header = describeSessionHeader(createSessionResult({ mode: "new" }));

		expect(header.glyph).toBe("sonny");
		expect(header.title).toBe("Sonny");
		expect(header.subtitle).toContain("gpt-5.4-mini");
		expect(header.lines[0]).toBe("2 tools · 0 skills · new session");
	});

	test("leads with the session title when resuming", () => {
		const header = describeSessionHeader(createSessionResult());

		expect(header.glyph).toBe("resumed");
		expect(header.title).toBe("Useful task");
		expect(header.lines[0]).toBe("2 messages restored · session-1");
	});

	test("marks a continued session as the latest one", () => {
		const header = describeSessionHeader(
			createSessionResult({ mode: "continue" }),
		);

		expect(header.subtitle).toBe("· latest");
	});

	test("falls back to the session id for untitled sessions", () => {
		const header = describeSessionHeader(
			createSessionResult({
				historySession: createHistorySession({
					id: "session-2",
					title: "Untitled session",
				}),
			}),
		);

		expect(header.title).toBe("session-2");
	});
});

describe("restoreTranscript", () => {
	test("drops the system prompt and keeps the conversation", () => {
		expect(
			restoreTranscript([
				{ role: "system", content: "system prompt" },
				{ role: "user", content: "Previous question" },
				{ role: "assistant", content: "Previous answer" },
			]),
		).toEqual([
			{ kind: "user", text: "Previous question" },
			{ kind: "answer", text: "Previous answer" },
		]);
	});

	test("rebuilds tool rows without inventing a duration", () => {
		expect(
			restoreTranscript([
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
					content: JSON.stringify({ stdout: "pass", stderr: "", exitCode: 0 }),
				},
			]),
		).toEqual([
			{
				kind: "tool",
				row: {
					toolName: "bash",
					preview: "bun test",
					duration: null,
					status: "ok",
					result: null,
					detail: null,
				},
			},
		]);
	});

	test("marks a restored blocked call as failed", () => {
		const items = restoreTranscript([
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{ id: "tool-call-1", name: "readFile", parameters: { path: ".env" } },
				],
			},
			{ role: "tool", toolCallId: "tool-call-1", content: "BLOCKED: secret" },
		]);

		expect(items).toEqual([
			{
				kind: "tool",
				row: {
					toolName: "readFile",
					preview: ".env",
					duration: null,
					status: "error",
					result: null,
					detail: null,
				},
			},
		]);
	});
});

describe("describeCompactionStart", () => {
	test("shows a running row so compaction is visible while it happens", () => {
		expect(
			describeCompactionStart({
				type: "context.compaction.started",
				tokenCount: 150_000,
				thresholdTokens: 150_000,
				forced: false,
			}),
		).toEqual({
			toolName: "compact",
			preview: "at 100% of the compaction threshold",
			duration: null,
			status: "running",
			result: null,
			detail: null,
		});
	});

	test("says what it is doing when you asked for it", () => {
		expect(
			describeCompactionStart({
				type: "context.compaction.started",
				tokenCount: 60_000,
				thresholdTokens: 150_000,
				forced: true,
			}).preview,
		).toBe("summarising the conversation");
	});
});

describe("describeCompaction", () => {
	test("reports summarised messages and the tokens saved", () => {
		expect(
			describeCompaction({
				type: "context.compaction.completed",
				tokenCountBefore: 118_900,
				tokenCountAfter: 57_500,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 22,
				changed: true,
				durationMs: 1700,
			}),
		).toEqual({
			toolName: "compact",
			preview: "summarised 22 messages",
			duration: "1.7s",
			status: "ok",
			result: "−61,400 tokens",
			detail: null,
		});
	});

	test("reports trimmed tool results when no summary was needed", () => {
		expect(
			describeCompaction({
				type: "context.compaction.completed",
				tokenCountBefore: 71_000,
				tokenCountAfter: 62_800,
				compactedToolResultCount: 6,
				summaryCompactedMessageCount: 0,
				changed: true,
				durationMs: 400,
			}).preview,
		).toBe("trimmed 6 tool results");
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
