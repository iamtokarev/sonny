import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatResult, ChatToolCall } from "@openrouter/sdk/models";
import type { LLMConfig } from "../config";
import type { ChatMessage, ToolSchema } from "../domain";
import {
	type ChatClient,
	type ChatSendParams,
	LLMProvider,
	LLMProviderError,
	toOpenRouterTool,
} from "./llm-provider";

const config: LLMConfig = {
	model: "openai/gpt-test",
	apiKey: "test-key",
	temperature: 0.7,
	maxTokens: 2048,
};

const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];

function createFakeClient(
	send: (request: { chatRequest: ChatSendParams }) => PromiseLike<ChatResult>,
): ChatClient {
	return {
		chat: {
			send,
		},
	};
}

function createChatResult(options: {
	content: string | null;
	toolCalls?: ChatToolCall[];
	finishReason?: ChatResult["choices"][number]["finishReason"];
	usage?: ChatResult["usage"];
}): ChatResult {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 0,
		model: "openai/gpt-test",
		systemFingerprint: null,
		usage: options.usage,
		choices: [
			{
				index: 0,
				finishReason: options.finishReason ?? "stop",
				message: {
					role: "assistant",
					content: options.content,
					toolCalls: options.toolCalls,
				},
			},
		],
	};
}

function createMockSend(
	content: string | null,
	options?: {
		toolCalls?: ChatToolCall[];
		finishReason?: ChatResult["choices"][number]["finishReason"];
	},
) {
	return mock(
		async (_request: { chatRequest: ChatSendParams }): Promise<ChatResult> =>
			createChatResult({
				content,
				toolCalls: options?.toolCalls,
				finishReason: options?.finishReason,
			}),
	);
}

function createFunctionToolCall(
	argumentsJson = '{"path":"README.md"}',
): ChatToolCall {
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
	let send: ReturnType<typeof createMockSend>;
	let provider: LLMProvider;

	beforeEach(() => {
		send = createMockSend("Hello from the model");
		provider = new LLMProvider(config, createFakeClient(send));
	});

	test("returns assistant content", async () => {
		const response = await provider.chat(messages);

		expect(response).toEqual({
			content: "Hello from the model",
			toolCalls: [],
			stopReason: "stop",
		});
	});

	test("maps token usage from the response", async () => {
		provider = new LLMProvider(
			config,
			createFakeClient(async () =>
				createChatResult({
					content: "Hi",
					usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
				}),
			),
		);

		const response = await provider.chat(messages);

		expect(response.usage).toEqual({
			promptTokens: 120,
			completionTokens: 30,
			totalTokens: 150,
		});
	});

	test("omits usage when the response carries none", async () => {
		const response = await provider.chat(messages);

		expect(response.usage).toBeUndefined();
	});

	test("sends configured request parameters", async () => {
		await provider.chat(messages, [], { temperature: 0.2 });

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[0]).toEqual({
			chatRequest: {
				model: "openai/gpt-test",
				messages: [{ role: "user", content: "Hello" }],
				tools: undefined,
				temperature: 0.2,
				maxCompletionTokens: 2048,
			},
		});
	});

	test("sends the configured reasoningEffort, overridable per call", async () => {
		const providerWithReasoning = new LLMProvider(
			{ ...config, reasoningEffort: "high" },
			createFakeClient(send),
		);

		await providerWithReasoning.chat(messages);

		expect(send.mock.calls[0]?.[0].chatRequest.reasoningEffort).toBe("high");

		await providerWithReasoning.chat(messages, [], {
			reasoningEffort: "low",
		});

		expect(send.mock.calls[1]?.[0].chatRequest.reasoningEffort).toBe("low");
	});

	test("sends tool schemas when provided, translated to the wire format", async () => {
		const tools: ToolSchema[] = [
			{
				name: "read_file",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		];

		await provider.chat(messages, tools);

		expect(send.mock.calls[0]?.[0].chatRequest.tools).toEqual(
			tools.map(toOpenRouterTool),
		);
	});

	test("converts Sonny assistant and tool messages to OpenRouter messages", async () => {
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

		expect(send.mock.calls[0]?.[0].chatRequest.messages).toEqual([
			{
				role: "assistant",
				content: null,
				toolCalls: [
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
				toolCallId: "call_test",
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

		expect(send.mock.calls[0]?.[0].chatRequest.messages).toEqual([
			{
				role: "assistant",
				content: "No tools needed",
			},
		]);
	});

	test("converts OpenRouter tool calls to Sonny tool calls", async () => {
		send = createMockSend(null, {
			toolCalls: [createFunctionToolCall()],
			finishReason: "tool_calls",
		});
		provider = new LLMProvider(config, createFakeClient(send));

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

	test("preserves raw arguments when tool call arguments are invalid JSON", async () => {
		send = createMockSend(null, {
			toolCalls: [createFunctionToolCall("{not-json")],
			finishReason: "tool_calls",
		});
		provider = new LLMProvider(config, createFakeClient(send));

		const response = await provider.chat(messages);

		expect(response.toolCalls).toEqual([
			{
				id: "call_test",
				name: "read_file",
				parameters: {},
				rawArguments: "{not-json",
			},
		]);
	});

	test("replays the model's raw malformed arguments verbatim on retry, instead of re-serializing {}", async () => {
		const malformedToolCallMessages: ChatMessage[] = [
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "call_test",
						name: "read_file",
						parameters: {},
						rawArguments: "{not-json",
					},
				],
			},
			{
				role: "tool",
				content: "Malformed arguments",
				toolCallId: "call_test",
			},
		];

		await provider.chat(malformedToolCallMessages);

		expect(send.mock.calls[0]?.[0].chatRequest.messages).toEqual([
			{
				role: "assistant",
				content: null,
				toolCalls: [
					{
						id: "call_test",
						type: "function",
						function: {
							name: "read_file",
							arguments: "{not-json",
						},
					},
				],
			},
			{
				role: "tool",
				content: "Malformed arguments",
				toolCallId: "call_test",
			},
		]);
	});

	test("throws LLMProviderError when response content is missing", async () => {
		send = createMockSend(null);
		provider = new LLMProvider(config, createFakeClient(send));

		await expect(provider.chat(messages)).rejects.toThrow(LLMProviderError);
		await expect(provider.chat(messages)).rejects.toThrow(
			"LLM response did not include assistant content",
		);
	});

	test("wraps client errors as LLMProviderError", async () => {
		const cause = new Error("network failed");
		const send = mock(
			async (_request: {
				chatRequest: ChatSendParams;
			}): Promise<ChatResult> => {
				throw cause;
			},
		);
		const provider = new LLMProvider(config, createFakeClient(send));

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

describe("LLMProvider cancellation", () => {
	test("passes the signal as a request option, not as part of the body", async () => {
		const abort = new AbortController();
		let seenRequest: { chatRequest: ChatSendParams } | undefined;
		let seenOptions: { signal?: AbortSignal } | undefined;
		const provider = new LLMProvider(config, {
			chat: {
				async send(request, options) {
					seenRequest = request;
					seenOptions = options;

					return createChatResult({ content: "Hi" });
				},
			},
		});

		await provider.chat(messages, [], { signal: abort.signal });

		expect(seenOptions?.signal).toBe(abort.signal);
		expect(seenRequest?.chatRequest).not.toHaveProperty("signal");
	});

	test("lets an abort through instead of reporting it as a provider failure", async () => {
		const abort = new AbortController();
		const cause = new Error("The operation was aborted.");
		const provider = new LLMProvider(config, {
			chat: {
				async send() {
					abort.abort();
					throw cause;
				},
			},
		});

		await expect(
			provider.chat(messages, [], { signal: abort.signal }),
		).rejects.toBe(cause);
	});
});
