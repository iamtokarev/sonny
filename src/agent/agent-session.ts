import { buildChannelPrompt } from "../channels";
import type {
	ContextManager,
	ContextUsage,
	PreparedContext,
	TokenCountRequest,
} from "../context";
import type { ChatMessage, ToolCall, ToolSchema } from "../domain";
import type { RuntimeSource, TurnContext } from "../events";
import type { HistoryRecorderSink } from "../history";
import type { LLMChatResult } from "../llm";
import { getToolCompletionStatus, type ToolResult } from "../tools/tool";
import type { ToolExecutor } from "../tools/tool-executor";
import type { ToolRegistry } from "../tools/tool-registry";
import { createLogger } from "../utils/logger";
import type { SessionState } from "./session-state";
import { buildSystemPrompt } from "./system-prompt-builder";

type ContextController = Pick<
	ContextManager,
	"inspect" | "prepare" | "recordUsage"
>;

type ChatModel = {
	chat(
		messages: ChatMessage[],
		tools?: ToolSchema[],
		options?: { signal?: AbortSignal },
	): Promise<string | LLMChatResult>;
};

const maxToolIterations = 10;

/**
 * A cancelled turn still has to leave a conversation the model can be sent
 * again: every tool call the assistant made needs a result, even the ones that
 * never ran.
 */
export const cancelledToolResult =
	"This tool call was not run — the turn was cancelled by the user.";
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

	getContextUsage(source: RuntimeSource): ContextUsage {
		if (this.contextManager === undefined) {
			throw new Error("Context manager is not configured.");
		}

		return this.contextManager.inspect(
			this.buildContextRequest(this.buildEffectiveSystemPrompt(source)),
		);
	}

	async compactContext(turnContext: TurnContext): Promise<PreparedContext> {
		if (this.contextManager === undefined) {
			throw new Error("Context manager is not configured.");
		}

		const preparedContext = await this.contextManager.prepare(
			this.buildContextRequest(
				this.buildEffectiveSystemPrompt(turnContext.source),
			),
			{ forceSummary: true, turnContext },
		);

		this.applyPreparedContext(preparedContext);

		return preparedContext;
	}

	async chat(message: string, turnContext: TurnContext): Promise<string> {
		logger.info("chat.started", {
			messageLength: message.length,
			messageCount: this.state.messageCount,
		});

		try {
			this.state.addMessage({ role: "user", content: message });

			for (let iteration = 0; iteration < maxToolIterations; iteration++) {
				turnContext.signal?.throwIfAborted();

				const toolSchemas = this.tools?.getSchemas() ?? [];
				const systemPrompt = this.buildEffectiveSystemPrompt(
					turnContext.source,
				);
				await this.prepareContext(toolSchemas, turnContext, systemPrompt);
				turnContext.signal?.throwIfAborted();
				const messages = this.state.buildMessages(systemPrompt);

				logger.info("llm.turn.started", {
					iteration,
					messageCount: messages.length,
					toolCount: toolSchemas.length,
				});

				const response = await this.llm.chat(messages, toolSchemas, {
					signal: turnContext.signal,
				});

				if (typeof response === "string") {
					this.state.addMessage({ role: "assistant", content: response });
					logger.info("chat.completed", {
						iteration,
						contentLength: response.length,
					});
					return response;
				}

				this.contextManager?.recordUsage(response.usage);

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

				for (const [index, toolCall] of response.toolCalls.entries()) {
					if (turnContext.signal?.aborted === true) {
						this.recordCancelledToolCalls(response.toolCalls.slice(index));
						turnContext.signal.throwIfAborted();
					}

					let toolResult: ToolResult;
					try {
						toolResult = await this.toolExecutor.execute(toolCall, turnContext);
					} catch (error) {
						if (turnContext.signal?.aborted) {
							this.recordCancelledToolCalls(response.toolCalls.slice(index));
						}
						throw error;
					}

					this.state.addMessage({
						role: "tool",
						toolCallId: toolCall.id,
						content: toolResult.ok ? toolResult.content : toolResult.error,
						status: getToolCompletionStatus(toolResult),
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

	/**
	 * Closes out tool calls the turn never got to. Without these the assistant
	 * message would keep tool calls with no results, which the API rejects on
	 * the next request — so cancelling once would break the whole session.
	 */
	private recordCancelledToolCalls(toolCalls: ToolCall[]): void {
		for (const toolCall of toolCalls) {
			this.state.addMessage({
				role: "tool",
				toolCallId: toolCall.id,
				content: cancelledToolResult,
				status: "denied",
			});
		}
	}

	private async prepareContext(
		toolSchemas: ToolSchema[],
		turnContext: TurnContext,
		systemPrompt: string,
	): Promise<void> {
		// Automatic compaction is a best-effort optimization. A transient
		// summarizer failure must not abort the user's turn, so degrade to the
		// current (uncompacted) context instead of propagating the error. The
		// manual /compact path reports failures separately.
		try {
			const preparedContext = await this.contextManager?.prepare(
				{
					systemPrompt,
					messages: this.state.getMessages(),
					tools: toolSchemas,
				},
				{ turnContext },
			);

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

	private buildEffectiveSystemPrompt(source: RuntimeSource): string {
		return buildSystemPrompt({
			stable: [this.systemPrompt],
			context: [buildChannelPrompt(source)],
		});
	}

	private buildContextRequest(systemPrompt: string): TokenCountRequest {
		return {
			systemPrompt,
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
