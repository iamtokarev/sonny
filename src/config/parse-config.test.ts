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

	test("defaults to auto tool approval when the block is missing", () => {
		const config = parseConfig(
			{ llm: { model: "gpt-4.1" }, defaultAgent: "sonny" },
			{ llmApiKey: "test-key" },
		);

		expect(config.toolApproval).toEqual({
			mode: "auto",
			model: "typesafe/jev-1.13",
			timeoutMs: 5000,
			maxConsecutiveDenials: 3,
			userMessageWindow: 3,
			maxPayloadChars: 8000,
			thresholds: {
				allow: { maxDanger: 0.3, minRequested: 0.6 },
				deny: { minDanger: 0.8, maxRequested: 0.3 },
			},
		});
	});

	test("fills tool approval defaults around explicit values", () => {
		const config = parseConfig(
			{
				llm: { model: "gpt-4.1" },
				defaultAgent: "sonny",
				toolApproval: {
					mode: "manual",
					model: "~typesafe/jev-latest",
					thresholds: { deny: { minDanger: 0.9 } },
				},
			},
			{ llmApiKey: "test-key" },
		);

		expect(config.toolApproval.mode).toBe("manual");
		expect(config.toolApproval.model).toBe("~typesafe/jev-latest");
		expect(config.toolApproval.timeoutMs).toBe(5000);
		expect(config.toolApproval.thresholds).toEqual({
			allow: { maxDanger: 0.3, minRequested: 0.6 },
			deny: { minDanger: 0.9, maxRequested: 0.3 },
		});
	});

	test.each([
		["an unknown mode", { mode: "yolo" }],
		["a threshold above 1", { thresholds: { allow: { maxDanger: 1.5 } } }],
		["a negative threshold", { thresholds: { deny: { maxRequested: -0.1 } } }],
		["a non-positive timeout", { timeoutMs: 0 }],
		["a negative denial limit", { maxConsecutiveDenials: -1 }],
		["a zero denial limit", { maxConsecutiveDenials: 0 }],
		["a fractional denial limit", { maxConsecutiveDenials: 1.5 }],
	])("rejects tool approval config with %s", (_label, toolApproval) => {
		expect(() =>
			parseConfig(
				{ llm: { model: "gpt-4.1" }, defaultAgent: "sonny", toolApproval },
				{ llmApiKey: "test-key" },
			),
		).toThrow("Invalid configuration");
	});
});
