import { describe, expect, test } from "bun:test";
import type { SlashCommandContext } from "./command";
import { createDefaultCommandRegistry } from "./create-command-registry";

function createContext(): SlashCommandContext {
	return {
		historySession: {
			id: "session-1",
			agentId: "sonny",
			title: "Test session",
			messageCount: 3,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		skills: [
			{
				name: "typescript",
				description: "Write TypeScript code.",
				body: "body",
				path: "/skills/typescript/SKILL.md",
				directory: "/skills/typescript",
			},
		],
		getMessageCount: () => 4,
		getContextUsage: () => ({
			tokenCount: 50_000,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		}),
		compactContext: async () => ({
			messages: [],
			tokenCountBefore: 50_000,
			tokenCountAfter: 10_000,
			thresholdTokens: 150_000,
			changed: true,
			compactedToolResultCount: 0,
			summaryCompactedMessageCount: 8,
		}),
	};
}

describe("createDefaultCommandRegistry", () => {
	test("registers help command", async () => {
		const registry = createDefaultCommandRegistry();
		const result = await registry.dispatch("/help", createContext());

		expect(result).toEqual({
			handled: true,
			result: {
				type: "message",
				content: [
					"/help (/h) - Show available commands.",
					"/context - Show current context usage.",
					"/compact - Compact conversation context manually.",
					"/skills [query] - List loaded skills.",
					"/session - Show current session information.",
				].join("\n"),
			},
		});
	});

	test("registers context command", async () => {
		const registry = createDefaultCommandRegistry();
		const result = await registry.dispatch("/context", createContext());

		expect(result).toEqual({
			handled: true,
			result: {
				type: "message",
				content: [
					"Messages: 4",
					"Tokens: 50,000",
					"Threshold: 150,000 (33.3%)",
					"Window: 200,000 (25.0%)",
				].join("\n"),
			},
		});
	});

	test("registers compact command", async () => {
		const registry = createDefaultCommandRegistry();
		const result = await registry.dispatch("/compact", createContext());

		expect(result).toEqual({
			handled: true,
			result: {
				type: "message",
				content:
					"Context compacted. Summarized 8 messages. Tokens: 50,000 -> 10,000.",
			},
		});
	});

	test("registers skills command", async () => {
		const registry = createDefaultCommandRegistry();
		const result = await registry.dispatch("/skills type", createContext());

		expect(result).toEqual({
			handled: true,
			result: {
				type: "message",
				content: "typescript - Write TypeScript code.",
			},
		});
	});

	test("registers session command", async () => {
		const registry = createDefaultCommandRegistry();
		const result = await registry.dispatch("/session", createContext());

		expect(result).toEqual({
			handled: true,
			result: {
				type: "message",
				content: [
					"Session: session-1",
					"Title: Test session",
					"Messages: 4",
				].join("\n"),
			},
		});
	});
});
