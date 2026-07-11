import OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { LLMConfig } from "../config";
import type { ChatMessage, ToolCall } from "../domain";
import { createLogger } from "../utils/logger";

type ChatOptions = Partial<
	Pick<
		ChatCompletionCreateParamsNonStreaming,
		"temperature" | "max_completion_tokens" | "reasoning_effort"
	>
>;

export type ChatCompletionCreateParams = ChatCompletionCreateParamsNonStreaming;

export type ChatCompletionClient = {
	chat: {
		completions: {
			create: (
				params: ChatCompletionCreateParams,
			) => PromiseLike<ChatCompletion>;
		};
	};
};

export type LLMStopReason = "stop" | "tool_calls" | "length" | "content_filter";
const logger = createLogger("providers.llm-provider");

function toOpenAIMessage(message: ChatMessage): ChatCompletionMessageParam {
	switch (message.role) {
		case "system":
		case "user":
			return {
				role: message.role,
				content: message.content,
			};

		case "assistant":
			if (message.toolCalls === undefined || message.toolCalls.length === 0) {
				return {
					role: "assistant",
					content: message.content || null,
				};
			}

			return {
				role: "assistant",
				content: message.content || null,
				tool_calls: message.toolCalls?.map((toolCall) => ({
					id: toolCall.id,
					type: "function",
					function: {
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.parameters),
					},
				})),
			};

		case "tool":
			return {
				role: "tool",
				content: message.content,
				tool_call_id: message.toolCallId,
			};
	}
}

function toOpenAIMessages(
	messages: ChatMessage[],
): ChatCompletionMessageParam[] {
	return messages.map(toOpenAIMessage);
}

function parseToolArguments(argumentsJson: string): unknown {
	try {
		return JSON.parse(argumentsJson);
	} catch {
		return {};
	}
}

function toSonnyToolCall(toolCall: ChatCompletionMessageToolCall): ToolCall {
	if (toolCall.type === "function") {
		return {
			id: toolCall.id,
			name: toolCall.function.name,
			parameters: parseToolArguments(toolCall.function.arguments),
		};
	}

	return {
		id: toolCall.id,
		name: toolCall.custom.name,
		parameters: { input: toolCall.custom.input },
	};
}

function normalizeStopReason(
	finishReason: ChatCompletion.Choice["finish_reason"] | undefined,
): LLMStopReason {
	if (finishReason === "function_call") {
		return "tool_calls";
	}

	return finishReason ?? "stop";
}

export type LLMChatResult = {
	content: string;
	toolCalls: ToolCall[];
	stopReason: LLMStopReason;
};

export class LLMProviderError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "LLMProviderError";
	}
}

export class LLMProvider {
	private readonly client: ChatCompletionClient;
	private readonly config: LLMConfig;

	constructor(config: LLMConfig, client?: ChatCompletionClient) {
		this.config = config;
		this.client =
			client ??
			(new OpenAI({
				apiKey: config.apiKey,
				baseURL: config.apiBase ?? undefined,
			}) as ChatCompletionClient);
	}

	/**
	 * Sends request to OpenAI compatible model
	 * @param messages - list of messages to sent
	 * @param options - options to control request settings
	 * @returns content of the response from the model
	 */
	async chat(
		messages: ChatMessage[],
		tools: ChatCompletionTool[] = [],
		options?: ChatOptions,
	): Promise<LLMChatResult> {
		try {
			const openAIMessages = toOpenAIMessages(messages);
			logger.info("llm.request", {
				model: this.config.model,
				messageCount: openAIMessages.length,
				toolCount: tools.length,
			});

			const completion = await this.client.chat.completions.create({
				model: this.config.model,
				messages: openAIMessages,
				tools: tools.length > 0 ? tools : undefined,
				temperature: this.config.temperature,
				max_completion_tokens: this.config.maxTokens,
				...options,
			});

			const choice = completion.choices[0];
			const message = choice?.message;
			const toolCalls = message?.tool_calls?.map(toSonnyToolCall) ?? [];
			const content = message?.content ?? "";
			const stopReason = normalizeStopReason(choice?.finish_reason);

			if (!content && toolCalls.length === 0) {
				throw new LLMProviderError(
					"LLM response did not include assistant content",
				);
			}

			logger.info("llm.response", {
				model: this.config.model,
				stopReason,
				contentLength: content.length,
				toolCallCount: toolCalls.length,
			});

			return {
				content,
				toolCalls,
				stopReason,
			};
		} catch (error) {
			if (error instanceof LLMProviderError) {
				logger.error("llm.error", {
					errorName: error.name,
					errorMessage: error.message,
				});
				throw error;
			}

			logger.error("llm.error", {
				errorName: error instanceof Error ? error.name : "UnknownError",
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw new LLMProviderError("LLM request failed", { cause: error });
		}
	}
}
