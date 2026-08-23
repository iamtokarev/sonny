import type { ChatMessage, ToolCall, ToolSchema } from "../domain";

export type TokenCountRequest = {
	systemPrompt: string;
	messages: ChatMessage[];
	tools?: ToolSchema[];
};

export interface TokenCounter {
	countRequestTokens(request: TokenCountRequest): number;
}

const CHARS_PER_TOKEN = 4;

function toolCallChars(toolCalls: ToolCall[] | undefined): number {
	if (!toolCalls?.length) {
		return 0;
	}

	return toolCalls.reduce(
		(total, toolCall) =>
			total +
			toolCall.id.length +
			toolCall.name.length +
			(toolCall.rawArguments ?? JSON.stringify(toolCall.parameters)).length,
		0,
	);
}

function messageChars(message: ChatMessage): number {
	let chars = message.role.length + message.content.length;

	if (message.role === "assistant") {
		chars += toolCallChars(message.toolCalls);
	}

	if (message.role === "tool") {
		chars += message.toolCallId.length;
	}

	return chars;
}

export class RoughTokenCounter implements TokenCounter {
	countRequestTokens(request: TokenCountRequest): number {
		let chars = request.systemPrompt.length;

		for (const message of request.messages) {
			chars += messageChars(message);
		}

		if (request.tools?.length) {
			chars += JSON.stringify(request.tools).length;
		}

		return Math.ceil(chars / CHARS_PER_TOKEN);
	}
}
