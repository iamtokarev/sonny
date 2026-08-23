import { OpenRouter } from "@openrouter/sdk";
import type {
	ChatContentItems,
	ChatFunctionToolFunction,
	ChatMessages,
	ChatRequestReasoningEffort,
	ChatResult,
	ChatToolCall,
} from "@openrouter/sdk/models";
import type { LLMConfig } from "../config";
import type { ChatMessage, ToolCall } from "../domain";
import { createLogger } from "../utils/logger";

type ChatOptions = Partial<{
	temperature: number;
	maxCompletionTokens: number;
	reasoningEffort: ChatRequestReasoningEffort;
}>;

export type ChatCompletionCreateParams = {
	model: string;
	messages: ChatMessages[];
	tools?: ChatFunctionToolFunction[];
} & ChatOptions;

export type ChatCompletionRequestOptions = {
	signal?: AbortSignal;
};

export type ChatCompletionClient = {
	chat: {
		send: (
			request: { chatRequest: ChatCompletionCreateParams },
			options?: ChatCompletionRequestOptions,
		) => PromiseLike<ChatResult>;
	};
};

export type LLMStopReason = "stop" | "tool_calls" | "length" | "content_filter";
const logger = createLogger("providers.llm-provider");

function toOpenRouterMessage(message: ChatMessage): ChatMessages {
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
				toolCalls: message.toolCalls?.map((toolCall) => ({
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
				toolCallId: message.toolCallId,
			};
	}
}

function toOpenRouterMessages(messages: ChatMessage[]): ChatMessages[] {
	return messages.map(toOpenRouterMessage);
}

function parseToolArguments(argumentsJson: string): unknown {
	try {
		return JSON.parse(argumentsJson);
	} catch {
		return {};
	}
}

function toSonnyToolCall(toolCall: ChatToolCall): ToolCall {
	return {
		id: toolCall.id,
		name: toolCall.function.name,
		parameters: parseToolArguments(toolCall.function.arguments),
	};
}


function extractTextContent(
	content: string | ChatContentItems[] | null | undefined,
): string {
	if (content === null || content === undefined) {
		return "";
	}

	if (typeof content === "string") {
		return content;
	}

	return content
		.filter(
			(part): part is Extract<ChatContentItems, { type: "text" }> =>
				part.type === "text",
		)
		.map((part) => part.text)
		.join("");
}

const knownStopReasons: readonly LLMStopReason[] = [
	"stop",
	"tool_calls",
	"length",
	"content_filter",
];

function normalizeStopReason(
	finishReason: ChatResult["choices"][number]["finishReason"] | undefined,
): LLMStopReason {
	if (
		finishReason !== undefined &&
		finishReason !== null &&
		(knownStopReasons as readonly string[]).includes(finishReason)
	) {
		return finishReason as LLMStopReason;
	}

	// Covers the "error" finish reason and any value the SDK doesn't
	// recognize yet — both fold to "stop" rather than growing LLMStopReason.
	return "stop";
}

export type LLMChatOptions = ChatOptions & ChatCompletionRequestOptions;

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


function createDefaultClient(config: LLMConfig): ChatCompletionClient {
	const client = new OpenRouter({ apiKey: config.apiKey });

	return {
		chat: {
			send: async (request, options) =>
				(await client.chat.send(request, options)) as ChatResult,
		},
	};
}

export class LLMProvider {
	private readonly client: ChatCompletionClient;
	private readonly config: LLMConfig;

	constructor(config: LLMConfig, client?: ChatCompletionClient) {
		this.config = config;
		this.client = client ?? createDefaultClient(config);
	}

	async chat(
		messages: ChatMessage[],
		tools: ChatFunctionToolFunction[] = [],
		options?: LLMChatOptions,
	): Promise<LLMChatResult> {
		const { signal, ...chatOptions } = options ?? {};

		try {
			const openRouterMessages = toOpenRouterMessages(messages);
			logger.info("llm.request", {
				model: this.config.model,
				messageCount: openRouterMessages.length,
				toolCount: tools.length,
			});

			const result = await this.client.chat.send(
				{
					chatRequest: {
						model: this.config.model,
						messages: openRouterMessages,
						tools: tools.length > 0 ? tools : undefined,
						temperature: this.config.temperature,
						maxCompletionTokens: this.config.maxTokens,
						...chatOptions,
					},
				},
				signal === undefined ? undefined : { signal },
			);

			const choice = result.choices[0];
			const message = choice?.message;
			const toolCalls = message?.toolCalls?.map(toSonnyToolCall) ?? [];
			const content = extractTextContent(message?.content);
			const stopReason = normalizeStopReason(choice?.finishReason);

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
			// A cancelled turn is not a provider failure
			if (signal?.aborted === true) {
				throw error;
			}

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
