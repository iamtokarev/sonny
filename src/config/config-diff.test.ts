import { describe, expect, test } from "bun:test";
import { diffConfigSections } from "./config-diff";
import type { Config } from "./schemas";

function createConfig(overrides: Partial<Config> = {}): Config {
	return {
		workspace: "/workspace",
		defaultAgent: "sonny",
		agentsPath: "agents",
		llm: {
			model: "openai/model-a",
			apiKey: "key-a",
			temperature: 0.7,
			maxTokens: 2048,
		},
		contextCompaction: {
			contextWindowTokens: 200_000,
			thresholdRatio: 0.75,
			maxToolResultChars: 10_000,
			protectedHeadMessages: 4,
			protectedTailMessages: 6,
			summaryMaxTokens: 4000,
		},
		channels: {
			telegram: {
				enabled: false,
				allowedUserIds: [],
			},
		},
		...overrides,
	};
}

describe("diffConfigSections", () => {
	test("reports human-meaningful changed sections", () => {
		const previous = createConfig();
		const next = createConfig({
			llm: { ...previous.llm, reasoningEffort: "high" },
			contextCompaction: {
				...previous.contextCompaction,
				thresholdRatio: 0.6,
			},
			tavilyApiKey: "tavily-key",
			defaultAgent: "other",
		});

		expect(diffConfigSections(previous, next)).toEqual([
			"llm",
			"contextCompaction",
			"web",
			"sessionDefaults",
		]);
	});

	test("returns no sections for equivalent configs", () => {
		const config = createConfig();

		expect(diffConfigSections(config, structuredClone(config))).toEqual([]);
	});

	test("reports channel changes", () => {
		const previous = createConfig();
		const next = createConfig({
			channels: {
				telegram: {
					enabled: true,
					botToken: "telegram-token",
					allowedUserIds: ["123"],
				},
			},
		});

		expect(diffConfigSections(previous, next)).toEqual(["channels"]);
	});
});
