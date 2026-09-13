import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseConfig } from "./parse-config";

describe("parseConfig", () => {
	test("loads valid config", () => {
		const config = parseConfig(
			{
				llm: {
					model: "gpt-4.1",
					temperature: 0.7,
					maxTokens: 2048,
				},
				defaultAgent: "sonny",
				agentsPath: "agents",
			},
			{ llmApiKey: "test-key" },
		);

		expect(config.llm.apiKey).toBe("test-key");
		expect(config.defaultAgent).toBe("sonny");
		expect(config.workspace).toBe(join(process.cwd(), "workspace"));
		expect(config.contextCompaction).toEqual({
			contextWindowTokens: 200_000,
			thresholdRatio: 0.75,
			maxToolResultChars: 10_000,
			protectedHeadMessages: 4,
			protectedTailMessages: 6,
			summaryMaxTokens: 4000,
		});
		expect(config.channels).toEqual({
			telegram: {
				enabled: false,
				allowedUserIds: [],
			},
		});
	});

	test("applies a Telegram token override without other environment overrides", () => {
		const config = parseConfig(
			{
				llm: {
					model: "gpt-4.1",
					apiKey: "configured-llm-key",
				},
				defaultAgent: "sonny",
				channels: {
					telegram: {
						enabled: true,
						botToken: "yaml-token",
						allowedUserIds: ["123"],
					},
				},
			},
			{ telegramBotToken: "environment-token" },
		);

		expect(config.channels.telegram.botToken).toBe("environment-token");
	});

	test("rejects enabled Telegram without a bot token", () => {
		expect(() =>
			parseConfig(
				{
					llm: { model: "gpt-4.1" },
					defaultAgent: "sonny",
					channels: {
						telegram: {
							enabled: true,
							allowedUserIds: ["123"],
						},
					},
				},
				{ llmApiKey: "test-key" },
			),
		).toThrow("TELEGRAM_BOT_TOKEN is required");
	});

	test("rejects enabled Telegram without allowed users", () => {
		expect(() =>
			parseConfig(
				{
					llm: { model: "gpt-4.1" },
					defaultAgent: "sonny",
					channels: {
						telegram: {
							enabled: true,
							botToken: "telegram-token",
						},
					},
				},
				{ llmApiKey: "test-key" },
			),
		).toThrow("At least one Telegram user must be allowed");
	});

	test("permits disabled Telegram without a token or allowed users", () => {
		const config = parseConfig(
			{
				llm: { model: "gpt-4.1" },
				defaultAgent: "sonny",
				channels: {
					telegram: {
						enabled: false,
						allowedUserIds: [],
					},
				},
			},
			{ llmApiKey: "test-key" },
		);

		expect(config.channels.telegram).toEqual({
			enabled: false,
			allowedUserIds: [],
		});
	});

	test("accepts an optional reasoningEffort and rejects an invalid one", () => {
		const config = parseConfig(
			{
				llm: {
					model: "gpt-4.1",
					reasoningEffort: "high",
				},
				defaultAgent: "sonny",
			},
			{ llmApiKey: "test-key" },
		);

		expect(config.llm.reasoningEffort).toBe("high");

		expect(() =>
			parseConfig(
				{
					llm: { model: "gpt-4.1", reasoningEffort: "extreme" },
					defaultAgent: "sonny",
				},
				{ llmApiKey: "test-key" },
			),
		).toThrow();
	});

	test("applies Tavily API key without an LLM API key override", () => {
		const config = parseConfig(
			{
				llm: {
					model: "gpt-4.1",
					apiKey: "configured-llm-key",
				},
				defaultAgent: "sonny",
			},
			{ tavilyApiKey: "test-tavily-key" },
		);

		expect(config.llm.apiKey).toBe("configured-llm-key");
		expect(config.tavilyApiKey).toBe("test-tavily-key");
	});

	test("loads explicit context compaction config", () => {
		const config = parseConfig(
			{
				llm: {
					model: "gpt-4.1",
					temperature: 0.7,
					maxTokens: 2048,
				},
				defaultAgent: "sonny",
				contextCompaction: {
					contextWindowTokens: 100_000,
					thresholdRatio: 0.5,
					maxToolResultChars: 5_000,
					protectedHeadMessages: 2,
					protectedTailMessages: 8,
					summaryMaxTokens: 500,
				},
			},
			{ llmApiKey: "test-key" },
		);

		expect(config.contextCompaction).toEqual({
			contextWindowTokens: 100_000,
			thresholdRatio: 0.5,
			maxToolResultChars: 5_000,
			protectedHeadMessages: 2,
			protectedTailMessages: 8,
			summaryMaxTokens: 500,
		});
	});
});
