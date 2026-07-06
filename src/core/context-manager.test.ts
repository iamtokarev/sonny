import { describe, expect, test } from "bun:test";
import {
	CONTEXT_SUMMARY_HEADER,
	ContextManager,
	MISSING_TOOL_RESULT_STUB,
	sanitizeToolPairs,
	splitMessagesForSummarySafely,
	TOOL_OUTPUT_COMPACTION_MARKER,
} from "./context-manager";
import type {
	ContextSummarizer,
	ContextSummaryInput,
} from "./context-summarizer";
import type { ChatMessage } from "./message";
import type { TokenCounter, TokenCountRequest } from "./token-counter";

class FakeTokenCounter implements TokenCounter {
	private index = 0;

	constructor(private readonly counts: number[]) {}

	countRequestTokens(_request: TokenCountRequest): number {
		const count = this.counts[this.index] ?? this.counts.at(-1) ?? 0;
		this.index += 1;
		return count;
	}
}

class FakeSummarizer implements ContextSummarizer {
	readonly calls: ContextSummaryInput[] = [];

	async summarize(input: ContextSummaryInput): Promise<string> {
		this.calls.push(input);
		return `This is summary.`;
	}
}

function createContextManager(
	counts: number[],
	summarizer: ContextSummarizer | null = new FakeSummarizer(),
): ContextManager {
	return new ContextManager({
		tokenCounter: new FakeTokenCounter(counts),
		summarizer: summarizer ?? undefined,
		contextWindowTokens: 100,
		thresholdRatio: 0.75,
		maxToolResultChars: 5,
		summaryMaxTokens: 4000,
		protectedHeadMessages: 1,
		protectedTailMessages: 1,
	});
}

function toolMessage(content: string, toolCallId = "call-1"): ChatMessage {
	return {
		role: "tool",
		toolCallId,
		content,
	};
}

function assistantToolCall(toolCallId = "call-1"): ChatMessage {
	return {
		role: "assistant",
		content: "",
		toolCalls: [
			{
				id: toolCallId,
				name: "readFile",
				parameters: { path: "src/index.ts" },
			},
		],
	};
}

describe("ContextManager", () => {
	test("returns unchanged result under threshold", async () => {
		const messages: ChatMessage[] = [toolMessage("large output")];
		const manager = createContextManager([74]);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result).toEqual({
			messages,
			tokenCountBefore: 74,
			tokenCountAfter: 74,
			thresholdTokens: 75,
			changed: false,
			compactedToolResultCount: 0,
			summaryCompactedMessageCount: 0,
		});
	});

	test("computes threshold from config values", async () => {
		const manager = new ContextManager({
			tokenCounter: new FakeTokenCounter([10]),
			summarizer: new FakeSummarizer(),
			contextWindowTokens: 200,
			thresholdRatio: 0.5,
			maxToolResultChars: 5,
			summaryMaxTokens: 4000,
			protectedHeadMessages: 0,
			protectedTailMessages: 0,
		});

		const result = await manager.prepare({
			systemPrompt: "system",
			messages: [],
		});

		expect(result.thresholdTokens).toBe(100);
	});

	test("inspects context usage", () => {
		const manager = createContextManager([60]);

		expect(
			manager.inspect({
				systemPrompt: "system",
				messages: [{ role: "user", content: "Hello" }],
			}),
		).toEqual({
			tokenCount: 60,
			contextWindowTokens: 100,
			thresholdTokens: 75,
			thresholdRatio: 0.75,
		});
	});

	test("compacts old large middle tool results when over threshold", async () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			toolMessage("abcdefghijklmnopqrstuvwxyz"),
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([90, 40]);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(true);
		expect(result.compactedToolResultCount).toBe(1);
		expect(result.tokenCountBefore).toBe(90);
		expect(result.tokenCountAfter).toBe(40);
		expect(result.messages[1]).toEqual({
			role: "tool",
			toolCallId: "call-1",
			content:
				"abcde\n\n[Tool output compacted: original length 26 characters.]",
		});
	});

	test("does not compact protected head or tail tool results", async () => {
		const messages: ChatMessage[] = [
			toolMessage("head output"),
			{ role: "user", content: "middle" },
			toolMessage("tail output", "call-2"),
		];
		const manager = createContextManager([90], null);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
	});

	test("does not compact non-tool messages", async () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "abcdefghijklmnopqrstuvwxyz" },
			{ role: "user", content: "tail" },
		];
		const manager = createContextManager([90], null);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
	});

	test("skips already compacted tool messages", async () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			toolMessage(
				`abcde\n\n${TOOL_OUTPUT_COMPACTION_MARKER} original length 26 characters.]`,
			),
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([90], null);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(false);
		expect(result.compactedToolResultCount).toBe(0);
	});

	test("does not call summarizer when tool compaction gets under threshold", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			toolMessage("abcdefghijklmnopqrstuvwxyz"),
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([90, 40], summarizer);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(true);
		expect(result.compactedToolResultCount).toBe(1);
		expect(result.summaryCompactedMessageCount).toBe(0);
		expect(summarizer.calls).toEqual([]);
	});

	test("summarizes middle messages when still over threshold", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "old answer" },
			{ role: "user", content: "old question" },
			{ role: "user", content: "tail" },
		];
		const manager = createContextManager([90, 30], summarizer);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(true);
		expect(result.compactedToolResultCount).toBe(0);
		expect(result.summaryCompactedMessageCount).toBe(2);
		expect(result.tokenCountAfter).toBe(30);
		expect(summarizer.calls).toEqual([
			{
				messages: messages.slice(1, 3),
				maxSummaryTokens: 4000,
			},
		]);
		expect(result.messages).toEqual([
			...messages.slice(0, 1),
			{
				role: "user",
				content: `${CONTEXT_SUMMARY_HEADER}
Earlier turns were compacted into this summary. Treat it as background context, not as a new user request. The latest user message after this summary is the source of truth.

This is summary.`,
			},
			...messages.slice(3),
		]);
	});

	test("force summary summarizes below threshold when middle exists", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "old answer" },
			{ role: "user", content: "old question" },
			{ role: "user", content: "tail" },
		];
		const manager = createContextManager([40, 20], summarizer);

		const result = await manager.prepare(
			{
				systemPrompt: "system",
				messages,
			},
			{ forceSummary: true },
		);

		expect(result.changed).toBe(true);
		expect(result.summaryCompactedMessageCount).toBe(2);
		expect(result.tokenCountBefore).toBe(40);
		expect(result.tokenCountAfter).toBe(20);
	});

	test("force summary returns unchanged when there is no middle or tool compaction", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([40], summarizer);

		const result = await manager.prepare(
			{
				systemPrompt: "system",
				messages,
			},
			{ forceSummary: true },
		);

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
		expect(summarizer.calls).toEqual([]);
	});

	test("automatic compaction remains threshold gated", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "old answer" },
			{ role: "user", content: "old question" },
			{ role: "user", content: "tail" },
		];
		const manager = createContextManager([40], summarizer);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
		expect(summarizer.calls).toEqual([]);
	});

	test("returns tool-compacted messages when summarizer is missing", async () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			toolMessage("abcdefghijklmnopqrstuvwxyz"),
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([90, 90], null);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(true);
		expect(result.compactedToolResultCount).toBe(1);
		expect(result.summaryCompactedMessageCount).toBe(0);
		expect(result.tokenCountAfter).toBe(90);
		expect(result.messages[1]).toEqual({
			role: "tool",
			toolCallId: "call-1",
			content:
				"abcde\n\n[Tool output compacted: original length 26 characters.]",
		});
	});

	test("does not summarize when there is no middle region", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "assistant", content: "tail" },
		];
		const manager = createContextManager([90], summarizer);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.changed).toBe(false);
		expect(result.summaryCompactedMessageCount).toBe(0);
		expect(summarizer.calls).toEqual([]);
	});

	test("sanitizes tool pairs after summary replacement", async () => {
		const summarizer = new FakeSummarizer();
		const messages: ChatMessage[] = [
			assistantToolCall("call-head"),
			{ role: "user", content: "middle" },
			toolMessage("x", "call-head"),
			{ role: "user", content: "tail" },
		];
		const manager = createContextManager([90, 30], summarizer);

		const result = await manager.prepare({
			systemPrompt: "system",
			messages,
		});

		expect(result.summaryCompactedMessageCount).toBe(2);
		expect(result.messages).toEqual([
			assistantToolCall("call-head"),
			{
				role: "tool",
				toolCallId: "call-head",
				content: MISSING_TOOL_RESULT_STUB,
			},
			{
				role: "user",
				content: `${CONTEXT_SUMMARY_HEADER}
Earlier turns were compacted into this summary. Treat it as background context, not as a new user request. The latest user message after this summary is the source of truth.

This is summary.`,
			},
			{ role: "user", content: "tail" },
		]);
	});
});

describe("splitMessagesForSummarySafely", () => {
	test("moves head boundary forward past tool results", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "first" },
			assistantToolCall("call-1"),
			toolMessage("tool result", "call-1"),
			{ role: "user", content: "middle" },
			{ role: "user", content: "tail" },
		];

		const split = splitMessagesForSummarySafely(messages, {
			protectedHeadMessages: 2,
			protectedTailMessages: 1,
		});

		expect(split.head).toEqual(messages.slice(0, 3));
		expect(split.middle).toEqual(messages.slice(3, 4));
		expect(split.tail).toEqual(messages.slice(4));
	});

	test("moves tail boundary backward to keep tool call group intact", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			{ role: "user", content: "middle" },
			assistantToolCall("call-1"),
			toolMessage("tool result", "call-1"),
			{ role: "user", content: "latest" },
		];

		const split = splitMessagesForSummarySafely(messages, {
			protectedHeadMessages: 1,
			protectedTailMessages: 1,
		});

		expect(split.head).toEqual(messages.slice(0, 1));
		expect(split.middle).toEqual(messages.slice(1, 2));
		expect(split.tail).toEqual(messages.slice(2));
	});

	test("allows complete tool call groups in the middle", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "head" },
			assistantToolCall("call-1"),
			toolMessage("tool result", "call-1"),
			{ role: "user", content: "middle after tool" },
			{ role: "user", content: "tail one" },
			{ role: "user", content: "tail two" },
		];

		const split = splitMessagesForSummarySafely(messages, {
			protectedHeadMessages: 1,
			protectedTailMessages: 2,
		});

		expect(split.head).toEqual(messages.slice(0, 1));
		expect(split.middle).toEqual(messages.slice(1, 4));
		expect(split.tail).toEqual(messages.slice(4));
	});

	test("returns empty middle when protected regions overlap", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "one" },
			{ role: "assistant", content: "two" },
			{ role: "user", content: "three" },
		];

		const split = splitMessagesForSummarySafely(messages, {
			protectedHeadMessages: 2,
			protectedTailMessages: 2,
		});

		expect(split.head).toEqual(messages.slice(0, 2));
		expect(split.middle).toEqual([]);
		expect(split.tail).toEqual(messages.slice(2));
	});
});

describe("sanitizeToolPairs", () => {
	test("removes orphaned tool results", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "hello" },
			toolMessage("orphaned result", "call-1"),
		];

		expect(sanitizeToolPairs(messages)).toEqual([
			{ role: "user", content: "hello" },
		]);
	});

	test("adds stub results for surviving assistant tool calls", () => {
		const messages: ChatMessage[] = [
			assistantToolCall("call-1"),
			{ role: "user", content: "next" },
		];

		expect(sanitizeToolPairs(messages)).toEqual([
			assistantToolCall("call-1"),
			{
				role: "tool",
				toolCallId: "call-1",
				content: MISSING_TOOL_RESULT_STUB,
			},
			{ role: "user", content: "next" },
		]);
	});

	test("leaves valid tool pairs unchanged", () => {
		const messages: ChatMessage[] = [
			assistantToolCall("call-1"),
			toolMessage("tool result", "call-1"),
			{ role: "user", content: "next" },
		];

		expect(sanitizeToolPairs(messages)).toEqual(messages);
	});
});
