export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
	id: string;
	name: string;
	parameters: unknown;
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
};

export type ChatMessage =
	| SystemMessage
	| UserMessage
	| AssistantMessage
	| ToolMessage;
