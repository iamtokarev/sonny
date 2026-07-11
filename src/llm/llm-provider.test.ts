import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
	ChatCompletion,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { LLMConfig } from "../config";
import type { ChatMessage } from "../domain";
import {
	type ChatCompletionClient,
	type ChatCompletionCreateParams,
	LLMProvider,
	LLMProviderError,
} from "./llm-provider";

const config: LLMConfig = {
	provider: "openai",
	model: "gpt-test",
	apiKey: "test-key",
	apiBase: null,
	temperature: 0.7,
	maxTokens: 2048,
};

const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];

function createFakeClient(
	create: (params: ChatCompletionCreateParams) => PromiseLike<ChatCompletion>,
): ChatCompletionClient {
	return {
		chat: {
			completions: {
				create,
			},
		},
	};
}

function createCompletion(options: {
	content: string | null;
	toolCalls?: ChatCompletionMessageToolCall[];
	finishReason?: ChatCompletion.Choice["finish_reason"];
}): ChatCompletion {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 0,
		model: "gpt-test",
		choices: [
			{
				index: 0,
				finish_reason: options.finishReason ?? "stop",
				logprobs: null,
				message: {
					role: "assistant",
					content: options.content,
					refusal: null,
					tool_calls: options.toolCalls,
				},
			},
		],
	};
}

function createMockCreate(
	content: string | null,
	options?: {
		toolCalls?: ChatCompletionMessageToolCall[];
		finishReason?: ChatCompletion.Choice["finish_reason"];
	},
) {
	return mock(
		async (_params: ChatCompletionCreateParams): Promise<ChatCompletion> =>
			createCompletion({
				content,
				toolCalls: options?.toolCalls,
				finishReason: options?.finishReason,
			}),
	);
}

function createFunctionToolCall(
	argumentsJson = '{"path":"README.md"}',
): ChatCompletionMessageToolCall {
	return {
		id: "call_test",
		type: "function",
		function: {
			name: "read_file",
			arguments: argumentsJson,
		},
	};
}

describe("LLMProvider", () => {
	let create: ReturnType<typeof createMockCreate>;
	let provider: LLMProvider;

	beforeEach(() => {
		create = createMockCreate("Hello from the model");
		provider = new LLMProvider(config, createFakeClient(create));
	});

	test("returns assistant content", async () => {
		const response = await provider.chat(messages);

		expect(response).toEqual({
			content: "Hello from the model",
			toolCalls: [],
			stopReason: "stop",
		});
	});

	test("sends configured request parameters", async () => {
		await provider.chat(messages, [], { temperature: 0.2 });

		expect(create).toHaveBeenCalledTimes(1);
		expect(create.mock.calls[0]?.[0]).toEqual({
			model: "gpt-test",
			messages: [{ role: "user", content: "Hello" }],
			tools: undefined,
			temperature: 0.2,
			max_completion_tokens: 2048,
		});
	});

	test("sends tool schemas when provided", async () => {
		const tools: ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file",
					parameters: {
						type: "object",
						properties: {},
					},
				},
			},
		];

		await provider.chat(messages, tools);

		expect(create.mock.calls[0]?.[0].tools).toBe(tools);
	});

	test("converts Sonny assistant and tool messages to OpenAI messages", async () => {
		const messages: ChatMessage[] = [
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "call_test",
						name: "read_file",
						parameters: { path: "README.md" },
					},
				],
			},
			{
				role: "tool",
				content: "file content",
				toolCallId: "call_test",
			},
		];

		await provider.chat(messages);

		expect(create.mock.calls[0]?.[0].messages).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_test",
						type: "function",
						function: {
							name: "read_file",
							arguments: '{"path":"README.md"}',
						},
					},
				],
			},
			{
				role: "tool",
				content: "file content",
				tool_call_id: "call_test",
			},
		]);
	});

	test("omits empty assistant tool calls", async () => {
		const messages: ChatMessage[] = [
			{
				role: "assistant",
				content: "No tools needed",
				toolCalls: [],
			},
		];

		await provider.chat(messages);

		expect(create.mock.calls[0]?.[0].messages).toEqual([
			{
				role: "assistant",
				content: "No tools needed",
			},
		]);
	});

	test("converts OpenAI tool calls to Sonny tool calls", async () => {
		create = createMockCreate(null, {
			toolCalls: [createFunctionToolCall()],
			finishReason: "tool_calls",
		});
		provider = new LLMProvider(config, createFakeClient(create));

		const response = await provider.chat(messages);

		expect(response).toEqual({
			content: "",
			toolCalls: [
				{
					id: "call_test",
					name: "read_file",
					parameters: { path: "README.md" },
				},
			],
			stopReason: "tool_calls",
		});
	});

	test("uses empty parameters when tool call arguments are invalid JSON", async () => {
		create = createMockCreate(null, {
			toolCalls: [createFunctionToolCall("{not-json")],
			finishReason: "tool_calls",
		});
		provider = new LLMProvider(config, createFakeClient(create));

		const response = await provider.chat(messages);

		expect(response.toolCalls).toEqual([
			{
				id: "call_test",
				name: "read_file",
				parameters: {},
			},
		]);
	});

	test("throws LLMProviderError when response content is missing", async () => {
		create = createMockCreate(null);
		provider = new LLMProvider(config, createFakeClient(create));

		await expect(provider.chat(messages)).rejects.toThrow(LLMProviderError);
		await expect(provider.chat(messages)).rejects.toThrow(
			"LLM response did not include assistant content",
		);
	});

	test("wraps client errors as LLMProviderError", async () => {
		const cause = new Error("network failed");
		const create = mock(
			async (_params: ChatCompletionCreateParams): Promise<ChatCompletion> => {
				throw cause;
			},
		);
		const provider = new LLMProvider(config, createFakeClient(create));

		try {
			await provider.chat(messages);
			throw new Error("Expected provider.chat to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(LLMProviderError);
			expect((error as Error).message).toBe("LLM request failed");
			expect((error as Error).cause).toBe(cause);
		}
	});
});
