import { describe, expect, test } from "bun:test";
import {
	formatCompletedToolMessage,
	formatDuration,
	formatToolPreview,
	formatToolResultPreview,
} from "./tool-display";

describe("tool display formatting", () => {
	test("formats file tool previews from path", () => {
		expect(formatToolPreview("readFile", { path: "src/core/message.ts" })).toBe(
			"src/core/message.ts",
		);
		expect(formatToolPreview("writeFile", { path: "src/output.txt" })).toBe(
			"src/output.txt",
		);
		expect(formatToolPreview("editFile", { path: "src/output.txt" })).toBe(
			"src/output.txt",
		);
	});

	test("formats bash previews from command", () => {
		expect(formatToolPreview("bash", { command: "bun test" })).toBe("bun test");
	});

	test("truncates long output previews", () => {
		const preview = formatToolResultPreview(
			"bash",
			JSON.stringify({
				exitCode: 0,
				stdout: "a".repeat(600),
				stderr: "",
			}),
			"succeeded",
		);

		expect(preview?.length).toBeLessThanOrEqual(503);
		expect(preview?.endsWith("...")).toBe(true);
	});

	test("displays denied suffix without blocked text", () => {
		expect(
			formatToolResultPreview(
				"bash",
				"BLOCKED: User denied this tool call.",
				"denied",
			),
		).toBe("[denied]");
	});

	test("displays bash exit code suffix", () => {
		expect(
			formatToolResultPreview(
				"bash",
				JSON.stringify({
					exitCode: 1,
					stdout: "",
					stderr: "",
				}),
				"succeeded",
			),
		).toBe("[exit 1]");
	});

	test("formats completed tool messages", () => {
		expect(
			formatCompletedToolMessage({
				type: "tool.completed",
				eventId: "event-1",
				sessionId: "session-1",
				turnId: "turn-1",
				source: { kind: "cli" },
				occurredAt: "2026-08-09T10:00:00.000Z",
				toolCallId: "call_1",
				toolName: "bash",
				parameters: {
					command: "bun test",
				},
				status: "succeeded",
				content: JSON.stringify({
					exitCode: 0,
					stdout: "ok",
					stderr: "",
				}),
				durationMs: 331,
			}),
		).toBe("bash  bun test  331ms  ok");
	});

	test("formats second durations", () => {
		expect(formatDuration(1250)).toBe("1.3s");
	});
});
