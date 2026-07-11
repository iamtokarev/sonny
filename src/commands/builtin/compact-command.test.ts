import { describe, expect, test } from "bun:test";
import type { PreparedContext } from "../../context";
import type { SlashCommandContext } from "../command";
import { createCompactCommand } from "./compact-command";

function createResult(
	overrides: Partial<PreparedContext> = {},
): PreparedContext {
	return {
		messages: [],
		tokenCountBefore: 50_000,
		tokenCountAfter: 10_000,
		thresholdTokens: 150_000,
		changed: true,
		compactedToolResultCount: 0,
		summaryCompactedMessageCount: 0,
		...overrides,
	};
}

function createContext(
	compactContext: () => Promise<PreparedContext>,
): SlashCommandContext {
	return {
		historySession: {
			id: "session-1",
			agentId: "sonny",
			title: "Test session",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		skills: [],
		getMessageCount: () => 0,
		getContextUsage: () => ({
			tokenCount: 50_000,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		}),
		compactContext,
	};
}

describe("createCompactCommand", () => {
	test("formats summary compaction result", async () => {
		const command = createCompactCommand();

		await expect(
			command.execute(
				"",
				createContext(async () =>
					createResult({ summaryCompactedMessageCount: 8 }),
				),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Context compacted. Summarized 8 messages. Tokens: 50,000 -> 10,000.",
		});
	});

	test("formats tool-only compaction result", async () => {
		const command = createCompactCommand();

		await expect(
			command.execute(
				"",
				createContext(async () =>
					createResult({ compactedToolResultCount: 3 }),
				),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Context compacted. Compacted 3 tool result(s). Tokens: 50,000 -> 10,000.",
		});
	});

	test("formats unchanged result", async () => {
		const command = createCompactCommand();

		await expect(
			command.execute(
				"",
				createContext(async () => createResult({ changed: false })),
			),
		).resolves.toEqual({
			type: "message",
			content: "Nothing to compact yet.",
		});
	});

	test("formats compaction errors", async () => {
		const command = createCompactCommand();

		await expect(
			command.execute(
				"",
				createContext(async () => {
					throw new Error("summary failed");
				}),
			),
		).resolves.toEqual({
			type: "message",
			content: "Context compaction failed: summary failed",
		});
	});
});
