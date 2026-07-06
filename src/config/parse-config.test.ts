import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseConfig } from "./parse-config";

describe("parseConfig", () => {
	test("loads valid config", () => {
		const config = parseConfig(
			{
				llm: {
					provider: "openai",
					model: "gpt-4.1",
					apiBase: null,
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
		expect(config.llm.provider).toBe("openai");
		expect(config.workspace).toBe(join(process.cwd(), "workspace"));
		expect(config.contextCompaction).toEqual({
			contextWindowTokens: 200_000,
			thresholdRatio: 0.75,
			maxToolResultChars: 10_000,
			protectedHeadMessages: 4,
			protectedTailMessages: 6,
			summaryMaxTokens: 4000,
		});
	});

	test("loads explicit context compaction config", () => {
		const config = parseConfig(
			{
				llm: {
					provider: "openai",
					model: "gpt-4.1",
					apiBase: null,
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
