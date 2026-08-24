import { createHash } from "node:crypto";
import type { ResolvedConfig } from "../config";

export function createRuntimeConfigSignature(config: ResolvedConfig): string {
	const payload = {
		llm: {
			model: config.llm.model,
			apiKey: config.llm.apiKey,
			temperature: config.llm.temperature,
			maxTokens: config.llm.maxTokens,
			reasoningEffort: config.llm.reasoningEffort ?? null,
		},
		contextCompaction: config.contextCompaction,
		web: {
			tavilyApiKey: config.tavilyApiKey ?? null,
		},
	};

	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
