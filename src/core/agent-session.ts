import type { ToolExecutor } from "../tools/tool-executor";
import type { ToolRegistry } from "../tools/tool-registry";
import { createLogger } from "../utils/logger";
import type {
	ContextManager,
	ContextUsage,
	PreparedContext,
} from "./context-manager";
import type { HistoryRecorderSink } from "./history-recorder";
import type { ChatMessage, ToolCall } from "./message";
import type { SessionState } from "./session-state";
import type { TokenCountRequest } from "./token-counter";

type ContextController = Pick<ContextManager, "inspect" | "prepare">;

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
		private readonly historyRecorder?: HistoryRecorderSink,
		private readonly contextManager?: ContextController,
	) {}

	getMessageCount(): number {
		return this.state.messageCount;
	}

	getContextUsage(): ContextUsage {
		if (this.contextManager === undefined) {
			throw new Error("Context manager is not configured.");
		}

		return this.contextManager.inspect(this.buildContextRequest());
	}

	async compactContext(): Promise<PreparedContext> {
		if (this.contextManager === undefined) {
			throw new Error("Context manager is not configured.");
		}

		const preparedContext = await this.contextManager.prepare(
			this.buildContextRequest(),
			{ forceSummary: true },
		);

		this.applyPreparedContext(preparedContext);

		return preparedContext;
	}

	async chat(message: string): Promise<string> {
		logger.info("chat.started", {
			messageLength: message.length,
			messageCount: this.state.messageCount,
		});

		try {
			this.state.addMessage({ role: "user", content: message });

			for (let iteration = 0; iteration < maxToolIterations; iteration++) {
				const toolSchemas = this.tools?.getSchemas() ?? [];
				await this.prepareContext(toolSchemas);
				const messages = this.state.buildMessages(this.systemPrompt);

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
		} finally {
			try {
				this.historyRecorder?.flush(this.state.getMessages());
			} catch (error) {
				logger.warn("history.flush.failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	private async prepareContext(toolSchemas: unknown[]): Promise<void> {
		// Automatic compaction is a best-effort optimization. A transient
		// summarizer failure must not abort the user's turn, so degrade to the
		// current (uncompacted) context instead of propagating the error. The
		// manual /compact path reports failures separately.
		try {
			const preparedContext = await this.contextManager?.prepare({
				systemPrompt: this.systemPrompt,
				messages: this.state.getMessages(),
				tools: toolSchemas,
			});

			if (preparedContext === undefined) {
				return;
			}

			this.applyPreparedContext(preparedContext);
		} catch (error) {
			logger.warn("context.prepare.failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private buildContextRequest(): TokenCountRequest {
		return {
			systemPrompt: this.systemPrompt,
			messages: this.state.getMessages(),
			tools: this.tools?.getSchemas() ?? [],
		};
	}

	private applyPreparedContext(preparedContext: PreparedContext): void {
		if (!preparedContext.changed) {
			return;
		}

		this.state.replaceMessages(preparedContext.messages);

		try {
			this.historyRecorder?.replaceMessages(preparedContext.messages);
		} catch (error) {
			logger.warn("history.replace.failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		logger.info("context.compacted", {
			tokenCountBefore: preparedContext.tokenCountBefore,
			tokenCountAfter: preparedContext.tokenCountAfter,
			thresholdTokens: preparedContext.thresholdTokens,
			compactedToolResultCount: preparedContext.compactedToolResultCount,
		});
	}
}
