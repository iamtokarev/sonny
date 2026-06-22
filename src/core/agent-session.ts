import type { ToolExecutor } from "../tools/tool-executor";
import type { ToolRegistry } from "../tools/tool-registry";
import { createLogger } from "../utils/logger";
import type { ChatMessage, ToolCall } from "./message";
import type { SessionState } from "./session-state";

type ChatModelResult = {
	content: string;
	toolCalls: ToolCall[];
	stopReason: "stop" | "tool_calls" | "length" | "content_filter";
};

type ChatModel = {
	chat(
		messages: ChatMessage[],
		tools?: unknown[],
	): Promise<string | ChatModelResult>;
};

const maxToolIterations = 10;
const logger = createLogger("core.agent-session");

export class AgentSession {
	constructor(
		private readonly systemPrompt: string,
		private readonly state: SessionState,
		private readonly llm: ChatModel,
		private readonly tools?: ToolRegistry,
		private readonly toolExecutor?: ToolExecutor,
	) {}

	async chat(message: string): Promise<string> {
		logger.info("chat.started", {
			messageLength: message.length,
			messageCount: this.state.messageCount,
		});

		this.state.addMessage({ role: "user", content: message });

		for (let iteration = 0; iteration < maxToolIterations; iteration++) {
			const messages = this.state.buildMessages(this.systemPrompt);
			const toolSchemas = this.tools?.getSchemas() ?? [];

			logger.info("llm.turn.started", {
				iteration,
				messageCount: messages.length,
				toolCount: toolSchemas.length,
			});

			const response = await this.llm.chat(messages, toolSchemas);

			if (typeof response === "string") {
				this.state.addMessage({ role: "assistant", content: response });
				logger.info("chat.completed", {
					iteration,
					contentLength: response.length,
				});
				return response;
			}

			logger.info("llm.turn.completed", {
				iteration,
				stopReason: response.stopReason,
				contentLength: response.content.length,
				toolCallCount: response.toolCalls.length,
			});

			const assistantMessage: ChatMessage = {
				role: "assistant",
				content: response.content,
			};

			if (response.toolCalls.length > 0) {
				assistantMessage.toolCalls = response.toolCalls;
			}

			this.state.addMessage(assistantMessage);

			if (
				response.stopReason !== "tool_calls" ||
				response.toolCalls.length === 0
			) {
				logger.info("chat.completed", {
					iteration,
					contentLength: response.content.length,
					stopReason: response.stopReason,
				});
				return response.content;
			}

			if (this.toolExecutor === undefined) {
				logger.warn("tool.loop.missing_executor", {
					iteration,
					toolCallCount: response.toolCalls.length,
				});
				return response.content;
			}

			logger.info("tool.loop.started", {
				iteration,
				toolCallCount: response.toolCalls.length,
			});

			for (const toolCall of response.toolCalls) {
				const toolResult = await this.toolExecutor.execute(toolCall);

				this.state.addMessage({
					role: "tool",
					toolCallId: toolCall.id,
					content: toolResult.ok ? toolResult.content : toolResult.error,
				});
			}
		}

		const content =
			"Tool loop stopped after reaching the maximum number of iterations.";

		logger.warn("tool.loop.max_iterations", {
			maxToolIterations,
		});
		this.state.addMessage({ role: "assistant", content });

		return content;
	}
}
