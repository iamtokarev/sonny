import { z } from "zod";

export const DEFAULT_CONTEXT_COMPACTION_CONFIG = {
	contextWindowTokens: 200_000,
	thresholdRatio: 0.75,
	maxToolResultChars: 10_000,
	protectedHeadMessages: 4,
	protectedTailMessages: 6,
	summaryMaxTokens: 4000,
} as const;

export const ContextCompactionConfigSchema = z.object({
	contextWindowTokens: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.contextWindowTokens),
	thresholdRatio: z
		.number()
		.positive()
		.max(1)
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.thresholdRatio),
	maxToolResultChars: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.maxToolResultChars),
	protectedHeadMessages: z
		.number()
		.int()
		.nonnegative()
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.protectedHeadMessages),
	protectedTailMessages: z
		.number()
		.int()
		.nonnegative()
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.protectedTailMessages),
	summaryMaxTokens: z
		.number()
		.int()
		.nonnegative()
		.default(DEFAULT_CONTEXT_COMPACTION_CONFIG.summaryMaxTokens),
});

export type ContextCompactionConfig = z.infer<
	typeof ContextCompactionConfigSchema
>;
