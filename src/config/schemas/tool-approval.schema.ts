import { z } from "zod";

export const DEFAULT_TOOL_APPROVAL_CONFIG = {
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
} as const;

const probability = z.number().min(0).max(1);
const { allow, deny } = DEFAULT_TOOL_APPROVAL_CONFIG.thresholds;

export const ToolApprovalModeSchema = z.enum(["auto", "manual"]);

export const ToolApprovalThresholdsSchema = z.object({
	allow: z
		.object({
			maxDanger: probability.default(allow.maxDanger),
			minRequested: probability.default(allow.minRequested),
		})
		.prefault({}),
	deny: z
		.object({
			minDanger: probability.default(deny.minDanger),
			maxRequested: probability.default(deny.maxRequested),
		})
		.prefault({}),
});

export const ToolApprovalConfigSchema = z.object({
	mode: ToolApprovalModeSchema.default(DEFAULT_TOOL_APPROVAL_CONFIG.mode),
	model: z.string().min(1).default(DEFAULT_TOOL_APPROVAL_CONFIG.model),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_TOOL_APPROVAL_CONFIG.timeoutMs),
	maxConsecutiveDenials: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_TOOL_APPROVAL_CONFIG.maxConsecutiveDenials),
	userMessageWindow: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_TOOL_APPROVAL_CONFIG.userMessageWindow),
	maxPayloadChars: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_TOOL_APPROVAL_CONFIG.maxPayloadChars),
	thresholds: ToolApprovalThresholdsSchema.prefault({}),
});

export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;
export type ToolApprovalThresholds = z.infer<
	typeof ToolApprovalThresholdsSchema
>;
export type ToolApprovalConfig = z.infer<typeof ToolApprovalConfigSchema>;
