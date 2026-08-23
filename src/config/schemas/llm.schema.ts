import { z } from "zod";

export const ReasoningEffortSchema = z.enum([
	"max",
	"xhigh",
	"high",
	"medium",
	"low",
	"minimal",
	"none",
]);

export const LLMConfigSchema = z.object({
	model: z.string().min(1),
	apiKey: z.string().min(1),
	temperature: z.number().min(0).max(2).default(0.7),
	maxTokens: z.number().int().positive().default(2048),
	reasoningEffort: ReasoningEffortSchema.optional(),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
