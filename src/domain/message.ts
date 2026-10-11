export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCompletionStatus =
	| "succeeded"
	| "denied"
	| "failed"
	| "not_found";

/**
 * Who let a tool call run or refused it. Absent when no approval step applied
 * (no hook asked, decided automatically or denied).
 */
export type ToolApprovalOutcome =
	| "auto-approved"
	| "auto-denied"
	| "user-approved"
	| "user-denied"
	| "policy-blocked";

export type ToolCall = {
	id: string;
	name: string;
	parameters: unknown;
	rawArguments?: string;
};

export type ToolSchema = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type SystemMessage = {
	role: "system";
	content: string;
};

export type UserMessage = {
	role: "user";
	content: string;
};

export type AssistantMessage = {
	role: "assistant";
	content: string;
	toolCalls?: ToolCall[];
};

export type ToolMessage = {
	role: "tool";
	content: string;
	toolCallId: string;
	status?: ToolCompletionStatus;
};

export type ChatMessage =
	| SystemMessage
	| UserMessage
	| AssistantMessage
	| ToolMessage;
