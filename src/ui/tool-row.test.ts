import { describe, expect, test } from "bun:test";
import type { ToolCompletedEvent } from "../events";
import {
	createToolRow,
	describeToolCall,
	formatBytes,
	padName,
	truncate,
	userDenialReason,
} from "./tool-row";

function completed(
	overrides: Partial<ToolCompletedEvent> = {},
): ToolCompletedEvent {
	return {
		type: "tool.completed",
		eventId: "event-1",
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" },
		occurredAt: "2026-01-01T00:00:00.000Z",
		toolCallId: "call-1",
		toolName: "bash",
		parameters: { command: "bun run test" },
		status: "succeeded",
		content: JSON.stringify({ exitCode: 0, stdout: "42 pass", stderr: "" }),
		durationMs: 4200,
		...overrides,
	};
}

describe("describeToolCall", () => {
	test("picks the identifying argument per tool", () => {
		expect(describeToolCall("bash", { command: "bun test" })).toBe("bun test");
		expect(describeToolCall("readFile", { path: "src/main.ts" })).toBe(
			"src/main.ts",
		);
		expect(describeToolCall("webSearch", { query: "ink colours" })).toBe(
			"ink colours",
		);
		expect(describeToolCall("webRead", { url: "https://example.com" })).toBe(
			"https://example.com",
		);
		expect(describeToolCall("loadSkill", { name: "precommit" })).toBe(
			"precommit",
		);
	});

	test("collapses whitespace so a multi-line command stays on one row", () => {
		expect(describeToolCall("bash", { command: "bun test\n  --watch" })).toBe(
			"bun test --watch",
		);
	});

	test("returns nothing for an unknown tool", () => {
		expect(describeToolCall("mystery", { path: "x" })).toBe("");
	});
});

describe("createToolRow", () => {
	test("summarises a successful command", () => {
		const row = createToolRow(completed());

		expect(row).toMatchObject({
			toolName: "bash",
			preview: "bun run test",
			duration: "4.2s",
			status: "ok",
			result: "42 pass",
		});
	});

	test("reports a non-zero exit with one line of why", () => {
		const row = createToolRow(
			completed({
				status: "succeeded",
				content: JSON.stringify({
					exitCode: 1,
					stdout: "",
					stderr: "2 failing\nat chat-loop.test.ts",
				}),
			}),
		);

		expect(row.status).toBe("error");
		expect(row.result).toBe("exit 1");
		expect(row.detail).toBe("2 failing");
	});

	test("reports a timeout as a failure", () => {
		const row = createToolRow(
			completed({
				content: JSON.stringify({ exitCode: 0, timedOut: true, stdout: "" }),
			}),
		);

		expect(row.result).toBe("timed out");
	});

	test("tells your denial apart from a policy block", () => {
		const denied = createToolRow(
			completed({
				status: "failed",
				content: `BLOCKED: not allowed. Reason: ${userDenialReason}`,
			}),
		);
		const blocked = createToolRow(
			completed({
				status: "failed",
				toolName: "readFile",
				parameters: { path: ".env" },
				content:
					"BLOCKED: not allowed. Reason: Access denied: refusing to read environment files",
			}),
		);

		expect(denied.status).toBe("denied");
		expect(denied.detail).toBe("you declined this call");
		expect(blocked.status).toBe("blocked");
		expect(blocked.detail).toBe(
			"policy: Access denied: refusing to read environment files",
		);
	});

	test("flags truncated output as a warning, not a failure", () => {
		const row = createToolRow(
			completed({
				toolName: "readFile",
				parameters: { path: "package-lock.json" },
				content:
					"…\n\n[Tool output truncated by Sonny: original output was 412118 characters.]",
			}),
		);

		expect(row.status).toBe("truncated");
		expect(row.result).toBe("truncated");
	});

	test("says nothing about a file it read successfully", () => {
		const row = createToolRow(
			completed({
				toolName: "readFile",
				parameters: { path: "src/main.ts" },
				content: "const x = 1;",
			}),
		);

		expect(row.result).toBe(null);
	});

	test("counts edits, sizes writes and counts search results", () => {
		expect(
			createToolRow(
				completed({
					toolName: "editFile",
					parameters: { path: "a.ts" },
					content: JSON.stringify({ path: "a.ts", replacements: 1 }),
				}),
			).result,
		).toBe("1 replacement");

		expect(
			createToolRow(
				completed({
					toolName: "writeFile",
					parameters: { path: "a.ts" },
					content: JSON.stringify({ path: "a.ts", bytesWritten: 1229 }),
				}),
			).result,
		).toBe("1.2 KB");

		expect(
			createToolRow(
				completed({
					toolName: "webSearch",
					parameters: { query: "ink" },
					content: JSON.stringify([1, 2, 3, 4, 5]),
				}),
			).result,
		).toBe("5 results");
	});

	test("surfaces a plain failure with its first line", () => {
		const row = createToolRow(
			completed({
				status: "failed",
				toolName: "editFile",
				parameters: { path: "main.ts" },
				content: "old string not found in file\n\nTool failed. Use this error…",
			}),
		);

		expect(row.status).toBe("error");
		expect(row.result).toBe("failed");
		expect(row.detail).toBe("old string not found in file");
	});
});

describe("layout helpers", () => {
	test("pads tool names into a fixed column", () => {
		expect(padName("bash")).toBe("bash      ");
		expect(padName("writeFile")).toBe("writeFile ");
	});

	test("truncates with an ellipsis rather than cutting hard", () => {
		expect(truncate("abcdef", 4)).toBe("abc…");
		expect(truncate("abc", 4)).toBe("abc");
	});

	test("formats bytes at human scale", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(3_145_728)).toBe("3.0 MB");
	});
});
