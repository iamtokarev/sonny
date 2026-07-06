import { countTokens } from "gpt-tokenizer/model/gpt-4o";
import type { ChatMessage } from "./message";

type TokenizerMessage = {
	role: ChatMessage["role"];
	content: string;
};

export type TokenCountRequest = {
	systemPrompt: string;
	messages: ChatMessage[];
	tools?: unknown[];
};

export interface TokenCounter {
	countRequestTokens(request: TokenCountRequest): number;
}

export class GptTokenizerTokenCounter implements TokenCounter {
	countRequestTokens(request: TokenCountRequest): number {
		return (
			countTokens(toTokenizerMessages(request)) +
			countAssistantToolCallTokens(request.messages) +
			countToolMessageMetadataTokens(request.messages) +
			countToolSchemaTokens(request.tools ?? [])
		);
	}
}

function toTokenizerMessages(request: TokenCountRequest): TokenizerMessage[] {
	return [
		{ role: "system", content: request.systemPrompt },
		...request.messages.map(({ role, content }) => ({ role, content })),
	];
}

function countAssistantToolCallTokens(messages: ChatMessage[]): number {
	return messages.reduce((total, message) => {
		if (message.role !== "assistant" || !message.toolCalls?.length) {
			return total;
		}

		return total + countTokens(JSON.stringify(toOpenAIToolCalls(message)));
	}, 0);
}

function countToolMessageMetadataTokens(messages: ChatMessage[]): number {
	return messages.reduce((total, message) => {
		if (message.role !== "tool") {
			return total;
		}

		return total + countTokens(message.toolCallId);
	}, 0);
}

function countToolSchemaTokens(tools: unknown[]): number {
	return tools.length === 0 ? 0 : countTokens(JSON.stringify(tools));
}

function toOpenAIToolCalls(
	message: Extract<ChatMessage, { role: "assistant" }>,
) {
	return (message.toolCalls ?? []).map((toolCall) => ({
		id: toolCall.id,
		type: "function",
		function: {
			name: toolCall.name,
			arguments: JSON.stringify(toolCall.parameters),
		},
	}));
}
