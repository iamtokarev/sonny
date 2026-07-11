import { describe, expect, test } from "bun:test";
import { countTokens } from "gpt-tokenizer/model/gpt-4o";
import type { ChatMessage } from "../domain";
import {
	GptTokenizerTokenCounter,
	type TokenCountRequest,
} from "./token-counter";

const systemPrompt = "You are Sonny, a local agent.";
const messages: ChatMessage[] = [
	{ role: "user", content: "Read src/index.ts and summarize it." },
	{
		role: "assistant",
		content: "Reading the file now.",
		toolCalls: [
			{ id: "call-1", name: "readFile", parameters: { path: "src/index.ts" } },
		],
	},
	{
		role: "tool",
		toolCallId: "call-1",
		content: "export const value = 1;\n".repeat(40),
	},
	{ role: "assistant", content: "It exports a single constant." },
];

/** Independent batch reference: whole-chat framing plus tool-call/metadata. */
function referenceTokens(request: TokenCountRequest): number {
	const chat = [
		{ role: "system" as const, content: request.systemPrompt },
		...request.messages.map(({ role, content }) => ({ role, content })),
	];
	let total = countTokens(chat);

	for (const message of request.messages) {
		if (message.role === "assistant" && message.toolCalls?.length) {
			total += countTokens(
				JSON.stringify(
					message.toolCalls.map((toolCall) => ({
						id: toolCall.id,
						type: "function",
						function: {
							name: toolCall.name,
							arguments: JSON.stringify(toolCall.parameters),
						},
					})),
				),
			);
		}
		if (message.role === "tool") {
			total += countTokens(message.toolCallId);
		}
	}

	if (request.tools?.length) {
		total += countTokens(JSON.stringify(request.tools));
	}

	return total;
}

describe("GptTokenizerTokenCounter", () => {
	test("matches the exact batch token count", () => {
		const request: TokenCountRequest = {
			systemPrompt,
			messages,
			tools: [{ name: "readFile" }],
		};

		expect(new GptTokenizerTokenCounter().countRequestTokens(request)).toBe(
			referenceTokens(request),
		);
	});

	test("incremental counting is independent of call history", () => {
		const counter = new GptTokenizerTokenCounter();

		// Warm the cache with a prefix, then extend the conversation.
		counter.countRequestTokens({
			systemPrompt,
			messages: messages.slice(0, 2),
		});
		const incremental = counter.countRequestTokens({ systemPrompt, messages });

		const fresh = new GptTokenizerTokenCounter().countRequestTokens({
			systemPrompt,
			messages,
		});

		expect(incremental).toBe(fresh);
		expect(incremental).toBe(referenceTokens({ systemPrompt, messages }));
	});

	test("counts an empty conversation", () => {
		const request: TokenCountRequest = { systemPrompt: "", messages: [] };
		expect(new GptTokenizerTokenCounter().countRequestTokens(request)).toBe(
			referenceTokens(request),
		);
	});
});
