import { describe, expect, test } from "bun:test";
import type { SlashCommandContext } from "./command";
import { CommandRegistry } from "./command-registry";

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
		getMessageCount: () => 0,
		getContextUsage: () => ({
			tokenCount: 0,
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

describe("CommandRegistry", () => {
	test("does not handle regular chat input", async () => {
		const registry = new CommandRegistry();

		await expect(registry.dispatch("hello", createContext())).resolves.toEqual({
			handled: false,
		});
	});

	test("dispatches registered slash commands with args", async () => {
		const registry = new CommandRegistry();

		registry.register({
			name: "echo",
			description: "Echo args.",
			execute(args) {
				return {
					type: "message",
					content: args,
				};
			},
		});

		await expect(
			registry.dispatch("/echo hello world", createContext()),
		).resolves.toEqual({
			handled: true,
			result: {
				type: "message",
				content: "hello world",
			},
		});
	});

	test("resolves command aliases", async () => {
		const registry = new CommandRegistry();

		registry.register({
			name: "help",
			description: "Show help.",
			aliases: ["h"],
			execute() {
				return {
					type: "message",
					content: "help",
				};
			},
		});

		await expect(registry.dispatch("/h", createContext())).resolves.toEqual({
			handled: true,
			result: {
				type: "message",
				content: "help",
			},
		});
	});

	test("returns a message for unknown slash commands", async () => {
		const registry = new CommandRegistry();

		await expect(
			registry.dispatch("/missing", createContext()),
		).resolves.toEqual({
			handled: true,
			result: {
				type: "message",
				content: "Unknown command: /missing",
			},
		});
	});

	test("rejects duplicate command names", () => {
		const registry = new CommandRegistry();
		const command = {
			name: "help",
			description: "Show help.",
			execute: () => ({ type: "message" as const, content: "help" }),
		};

		registry.register(command);

		expect(() => registry.register(command)).toThrow(
			"Command already registered: /help",
		);
	});

	test("rejects duplicate aliases", () => {
		const registry = new CommandRegistry();

		registry.register({
			name: "help",
			description: "Show help.",
			aliases: ["h"],
			execute: () => ({ type: "message", content: "help" }),
		});

		expect(() =>
			registry.register({
				name: "history",
				description: "Show history.",
				aliases: ["h"],
				execute: () => ({ type: "message", content: "history" }),
			}),
		).toThrow("Command alias already registered: /h");
	});
});
