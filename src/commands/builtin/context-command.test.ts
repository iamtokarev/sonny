import { describe, expect, test } from "bun:test";
import type { SlashCommandContext } from "../command";
import { createContextCommand } from "./context-command";

function createContext(): SlashCommandContext {
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
		getMessageCount: () => 4,
		getContextUsage: () => ({
			tokenCount: 50_000,
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
	};
}

describe("createContextCommand", () => {
	test("formats context usage", () => {
		const command = createContextCommand();

		expect(command.execute("", createContext())).toEqual({
			type: "message",
			content: [
				"Messages: 4",
				"Tokens: 50,000",
				"Threshold: 150,000 (33.3%)",
				"Window: 200,000 (25.0%)",
			].join("\n"),
		});
	});
});
