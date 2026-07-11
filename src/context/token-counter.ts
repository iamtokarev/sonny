import { countTokens } from "gpt-tokenizer/model/gpt-4o";
import type { ChatMessage } from "../domain";

export type TokenCountRequest = {
	systemPrompt: string;
	messages: ChatMessage[];
	tools?: unknown[];
};

export interface TokenCounter {
	countRequestTokens(request: TokenCountRequest): number;
}

/**
 * Exact token counter that avoids re-tokenizing the whole conversation on every
 * call. A chat's token count decomposes additively: the tokenizer frames each
 * message independently around fixed delimiters, so
 *
 *   countTokens(chat) === countTokens([]) + Σ (countTokens([message]) - countTokens([]))
 *
 * We cache each message's contribution keyed by object identity. Since messages
 * are immutable once created (compaction swaps in new objects), the same message
 * is tokenized once and reused across turns; only newly added messages pay the
 * tokenizer cost. Entries are dropped automatically when messages are no longer
 * referenced.
 */
export class GptTokenizerTokenCounter implements TokenCounter {
	private readonly primingTokens = countTokens([]);
	private readonly messageTokenCache = new WeakMap<ChatMessage, number>();
	private readonly systemPromptCache = new Map<string, number>();
	private lastSchema?: { serialized: string; tokens: number };

	countRequestTokens(request: TokenCountRequest): number {
		let total = this.primingTokens;
		total += this.countSystemPromptTokens(request.systemPrompt);

		for (const message of request.messages) {
			total += this.countMessageTokens(message);
		}

		total += this.countToolSchemaTokens(request.tools ?? []);

		return total;
	}

	private countSystemPromptTokens(systemPrompt: string): number {
		const cached = this.systemPromptCache.get(systemPrompt);
		if (cached !== undefined) {
			return cached;
		}

		const tokens = this.countFramedMessageTokens({
			role: "system",
			content: systemPrompt,
		});
		this.systemPromptCache.set(systemPrompt, tokens);
		return tokens;
	}

	private countMessageTokens(message: ChatMessage): number {
		const cached = this.messageTokenCache.get(message);
		if (cached !== undefined) {
			return cached;
		}

		let tokens = this.countFramedMessageTokens({
			role: message.role,
			content: message.content,
		});

		if (message.role === "assistant" && message.toolCalls?.length) {
			tokens += countTokens(JSON.stringify(toOpenAIToolCalls(message)));
		}

		if (message.role === "tool") {
			tokens += countTokens(message.toolCallId);
		}

		this.messageTokenCache.set(message, tokens);
		return tokens;
	}

	/** Per-message contribution to a chat, with the shared priming removed. */
	private countFramedMessageTokens(message: {
		role: ChatMessage["role"];
		content: string;
	}): number {
		return countTokens([message]) - this.primingTokens;
	}

	private countToolSchemaTokens(tools: unknown[]): number {
		if (tools.length === 0) {
			return 0;
		}

		const serialized = JSON.stringify(tools);
		if (this.lastSchema?.serialized === serialized) {
			return this.lastSchema.tokens;
		}

		const tokens = countTokens(serialized);
		this.lastSchema = { serialized, tokens };
		return tokens;
	}
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
