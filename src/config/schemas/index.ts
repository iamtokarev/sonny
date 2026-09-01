import { join } from "node:path";
import { z } from "zod";

import { ChannelsConfigSchema } from "./channels.schema";
import {
	ContextCompactionConfigSchema,
	DEFAULT_CONTEXT_COMPACTION_CONFIG,
} from "./context-compaction.schema";
import { LLMConfigSchema } from "./llm.schema";

export const ConfigSchema = z.object({
	workspace: z.string().default(join(process.cwd(), "workspace")),
	llm: LLMConfigSchema,
	defaultAgent: z.string(),
	agentsPath: z.string().default("agents"),
	contextCompaction: ContextCompactionConfigSchema.default(
		DEFAULT_CONTEXT_COMPACTION_CONFIG,
	),
	channels: ChannelsConfigSchema.default({
		telegram: {
			enabled: false,
			allowedUserIds: [],
		},
	}),

	// web search
	tavilyApiKey: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export * from "./channels.schema";
export * from "./context-compaction.schema";
export * from "./llm.schema";
