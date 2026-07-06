import type { ContextSummarizer } from "./context-summarizer";
import type { ChatMessage, ToolMessage } from "./message";
import type { TokenCounter, TokenCountRequest } from "./token-counter";

export const TOOL_OUTPUT_COMPACTION_MARKER = "[Tool output compacted:";
export const MISSING_TOOL_RESULT_STUB =
	"[Result from earlier conversation - see context summary above]";
export const CONTEXT_SUMMARY_HEADER = "[CONTEXT COMPACTION - REFERENCE ONLY]";

export type ContextManagerOptions = {
	tokenCounter: TokenCounter;
	summarizer?: ContextSummarizer;
	contextWindowTokens: number;
	thresholdRatio: number;
	maxToolResultChars: number;
	summaryMaxTokens: number;
	protectedHeadMessages: number;
	protectedTailMessages: number;
};

export type PreparedContext = {
	messages: ChatMessage[];
	tokenCountBefore: number;
	tokenCountAfter: number;
	thresholdTokens: number;
	changed: boolean;
	compactedToolResultCount: number;
	summaryCompactedMessageCount: number;
};

export interface MessagesSummarySplit {
	head: ChatMessage[];
	middle: ChatMessage[];
	tail: ChatMessage[];
}

type SummarySplitOptions = Pick<
	ContextManagerOptions,
	"protectedHeadMessages" | "protectedTailMessages"
>;

function getAssistantToolCallIds(message: ChatMessage): string[] {
	if (message.role !== "assistant") {
		return [];
	}

	return message.toolCalls?.map((toolCall) => toolCall.id) ?? [];
}

function hasAssistantToolCalls(message: ChatMessage): boolean {
	return getAssistantToolCallIds(message).length > 0;
}

function alignSummaryStartForward(
	messages: ChatMessage[],
	index: number,
): number {
	let alignedIndex = index;

	while (
		alignedIndex < messages.length &&
		messages[alignedIndex]?.role === "tool"
	) {
		alignedIndex += 1;
	}

	return alignedIndex;
}

function alignSummaryEndBackward(
	messages: ChatMessage[],
	index: number,
): number {
	if (index <= 0 || index >= messages.length) {
		return index;
	}

	let checkIndex = index - 1;
	while (checkIndex >= 0 && messages[checkIndex]?.role === "tool") {
		checkIndex -= 1;
	}

	const parentMessage = messages[checkIndex];
	if (parentMessage !== undefined && hasAssistantToolCalls(parentMessage)) {
		return checkIndex;
	}

	return index;
}

export function splitMessagesForSummarySafely(
	messages: ChatMessage[],
	options: SummarySplitOptions,
): MessagesSummarySplit {
	const protectedHeadMessages = Math.max(0, options.protectedHeadMessages);
	const protectedTailMessages = Math.max(0, options.protectedTailMessages);
	let headEnd = Math.min(protectedHeadMessages, messages.length);
	headEnd = alignSummaryStartForward(messages, headEnd);

	let tailStart = Math.max(headEnd, messages.length - protectedTailMessages);
	tailStart = alignSummaryEndBackward(messages, tailStart);

	if (tailStart < headEnd) {
		tailStart = headEnd;
	}

	return {
		head: messages.slice(0, headEnd),
		middle: messages.slice(headEnd, tailStart),
		tail: messages.slice(tailStart),
	};
}

export function sanitizeToolPairs(messages: ChatMessage[]): ChatMessage[] {
	const survivingCallIds = new Set<string>();
	for (const message of messages) {
		for (const toolCallId of getAssistantToolCallIds(message)) {
			survivingCallIds.add(toolCallId);
		}
	}

	const resultCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role === "tool") {
			resultCallIds.add(message.toolCallId);
		}
	}

	const messagesWithoutOrphanedResults = messages.filter(
		(message) =>
			message.role !== "tool" || survivingCallIds.has(message.toolCallId),
	);

	const remainingResultIds = new Set<string>();
	for (const message of messagesWithoutOrphanedResults) {
		if (message.role === "tool") {
			remainingResultIds.add(message.toolCallId);
		}
	}

	const missingResultIds = new Set<string>();
	for (const toolCallId of survivingCallIds) {
		if (!remainingResultIds.has(toolCallId)) {
			missingResultIds.add(toolCallId);
		}
	}

	if (missingResultIds.size === 0) {
		return messagesWithoutOrphanedResults;
	}

	const patchedMessages: ChatMessage[] = [];
	for (const message of messagesWithoutOrphanedResults) {
		patchedMessages.push(message);

		for (const toolCallId of getAssistantToolCallIds(message)) {
			if (missingResultIds.has(toolCallId)) {
				patchedMessages.push({
					role: "tool",
					toolCallId,
					content: MISSING_TOOL_RESULT_STUB,
				});
			}
		}
	}

	return patchedMessages;
}

export class ContextManager {
	constructor(private readonly options: ContextManagerOptions) {}

	async prepare(request: TokenCountRequest): Promise<PreparedContext> {
		const thresholdTokens = Math.floor(
			this.options.contextWindowTokens * this.options.thresholdRatio,
		);
		const tokenCountBefore =
			this.options.tokenCounter.countRequestTokens(request);

		if (tokenCountBefore < thresholdTokens) {
			return {
				messages: request.messages,
				tokenCountBefore,
				tokenCountAfter: tokenCountBefore,
				thresholdTokens,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			};
		}

		const { messages, compactedToolResultCount } = this.compactToolMessages(
			request.messages,
		);
		const tokenCountAfterToolCompaction =
			compactedToolResultCount > 0
				? this.options.tokenCounter.countRequestTokens({
						...request,
						messages,
					})
				: tokenCountBefore;

		if (tokenCountAfterToolCompaction < thresholdTokens) {
			return {
				messages,
				tokenCountBefore,
				tokenCountAfter: tokenCountAfterToolCompaction,
				thresholdTokens,
				changed: compactedToolResultCount > 0,
				compactedToolResultCount,
				summaryCompactedMessageCount: 0,
			};
		}

		const summaryCompaction = await this.compactMessagesWithSummary(messages);

		if (summaryCompaction === undefined) {
			return {
				messages,
				tokenCountBefore,
				tokenCountAfter: tokenCountAfterToolCompaction,
				thresholdTokens,
				changed: compactedToolResultCount > 0,
				compactedToolResultCount,
				summaryCompactedMessageCount: 0,
			};
		}

		const tokenCountAfter = this.options.tokenCounter.countRequestTokens({
			...request,
			messages: summaryCompaction.messages,
		});

		return {
			messages: summaryCompaction.messages,
			tokenCountBefore,
			tokenCountAfter,
			thresholdTokens,
			changed: true,
			compactedToolResultCount,
			summaryCompactedMessageCount:
				summaryCompaction.summaryCompactedMessageCount,
		};
	}

	private compactToolMessages(messages: ChatMessage[]): {
		messages: ChatMessage[];
		compactedToolResultCount: number;
	} {
		let compactedToolResultCount = 0;

		const compactedMessages = messages.map((message, index) => {
			if (!this.canCompactMessage(message, index, messages.length)) {
				return message;
			}

			compactedToolResultCount += 1;
			return this.compactToolMessage(message);
		});

		return {
			messages: compactedToolResultCount > 0 ? compactedMessages : messages,
			compactedToolResultCount,
		};
	}

	private canCompactMessage(
		message: ChatMessage,
		index: number,
		messageCount: number,
	): message is ToolMessage {
		if (message.role !== "tool") {
			return false;
		}

		if (
			index < this.options.protectedHeadMessages ||
			index >= messageCount - this.options.protectedTailMessages
		) {
			return false;
		}

		return (
			message.content.length > this.options.maxToolResultChars &&
			!message.content.includes(TOOL_OUTPUT_COMPACTION_MARKER)
		);
	}

	private compactToolMessage(message: ToolMessage): ToolMessage {
		return {
			...message,
			content: `${message.content.slice(
				0,
				this.options.maxToolResultChars,
			)}\n\n${TOOL_OUTPUT_COMPACTION_MARKER} original length ${
				message.content.length
			} characters.]`,
		};
	}

	private async compactMessagesWithSummary(messages: ChatMessage[]): Promise<
		| {
				messages: ChatMessage[];
				summaryCompactedMessageCount: number;
		  }
		| undefined
	> {
		if (this.options.summarizer === undefined) {
			return undefined;
		}

		const split = splitMessagesForSummarySafely(messages, this.options);
		if (split.middle.length === 0) {
			return undefined;
		}

		const summary = await this.options.summarizer.summarize({
			messages: split.middle,
			maxSummaryTokens: this.options.summaryMaxTokens,
		});

		return {
			messages: sanitizeToolPairs([
				...split.head,
				this.createSummaryMessage(summary),
				...split.tail,
			]),
			summaryCompactedMessageCount: split.middle.length,
		};
	}

	private createSummaryMessage(summary: string): ChatMessage {
		return {
			role: "user",
			content: `${CONTEXT_SUMMARY_HEADER}
Earlier turns were compacted into this summary. Treat it as background context, not as a new user request. The latest user message after this summary is the source of truth.

${summary}`,
		};
	}
}
