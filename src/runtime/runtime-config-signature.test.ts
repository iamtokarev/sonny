import { describe, expect, test } from "bun:test";
import type { Config } from "../config";
import { createRuntimeConfigSignature } from "./runtime-config-signature";

function createConfig(overrides: Partial<Config> = {}): Config {
	return {
		workspace: "/workspace",
		defaultAgent: "sonny",
		agentsPath: "agents",
		llm: {
			model: "openai/model-a",
			apiKey: "secret-key",
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
		...overrides,
	};
}

describe("createRuntimeConfigSignature", () => {
	test("changes for every OpenRouter request setting", () => {
		const config = createConfig();
		const signature = createRuntimeConfigSignature(config);
		const llmChanges = [
			{ ...config.llm, model: "anthropic/model-b" },
			{ ...config.llm, apiKey: "other-key" },
			{ ...config.llm, temperature: 0.2 },
			{ ...config.llm, maxTokens: 4096 },
			{ ...config.llm, reasoningEffort: "high" as const },
		];

		for (const llm of llmChanges) {
			expect(createRuntimeConfigSignature(createConfig({ llm }))).not.toBe(
				signature,
			);
		}
	});

	test("changes for compaction and web configuration", () => {
		const config = createConfig();
		const signature = createRuntimeConfigSignature(config);

		expect(
			createRuntimeConfigSignature(
				createConfig({
					contextCompaction: {
						...config.contextCompaction,
						thresholdRatio: 0.5,
					},
				}),
			),
		).not.toBe(signature);
		expect(
			createRuntimeConfigSignature(createConfig({ tavilyApiKey: "web-key" })),
		).not.toBe(signature);
	});

	test("ignores future-session defaults and never exposes secrets", () => {
		const config = createConfig();
		const signature = createRuntimeConfigSignature(config);
		const defaultsChanged = createConfig({
			workspace: "/other",
			defaultAgent: "other",
			agentsPath: "different-agents",
		});

		expect(createRuntimeConfigSignature(defaultsChanged)).toBe(signature);
		expect(signature).not.toContain(config.llm.apiKey);
	});
});
