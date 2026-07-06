import { describe, expect, test } from "bun:test";
import { LlmContextSummarizer } from "./llm-context-summarizer";
import type { ChatMessage } from "./message";

type SummaryCall = {
	messages: ChatMessage[];
	tools: [];
	options: { max_completion_tokens?: number } | undefined;
};

class FakeSummaryLLM {
	readonly calls: SummaryCall[] = [];

	constructor(
		private readonly content = "summary content",
		private readonly error?: Error,
	) {}

	async chat(
		messages: ChatMessage[],
		tools: [] = [],
		options?: { max_completion_tokens?: number },
	): Promise<{ content: string }> {
		this.calls.push({ messages, tools, options });

		if (this.error !== undefined) {
			throw this.error;
		}

		return { content: this.content };
	}
}

describe("LlmContextSummarizer", () => {
	test("sends one user prompt without tools and with summary token budget", async () => {
		const llm = new FakeSummaryLLM("summary");
		const summarizer = new LlmContextSummarizer(llm);

		const result = await summarizer.summarize({
			messages: [{ role: "user", content: "Please fix the bug." }],
			maxSummaryTokens: 1234,
		});

		expect(result).toBe("summary");
		expect(llm.calls).toHaveLength(1);
		expect(llm.calls[0]?.tools).toEqual([]);
		expect(llm.calls[0]?.options).toEqual({
			max_completion_tokens: 1234,
		});
		expect(llm.calls[0]?.messages).toHaveLength(1);
		expect(llm.calls[0]?.messages[0]?.role).toBe("user");
	});

	test("prompt includes user, assistant, tool calls, and tool results", async () => {
		const llm = new FakeSummaryLLM();
		const summarizer = new LlmContextSummarizer(llm);
		const messages: ChatMessage[] = [
			{ role: "user", content: "Read the app file." },
			{
				role: "assistant",
				content: "I will inspect it.",
				toolCalls: [
					{
						id: "call-1",
						name: "readFile",
						parameters: { path: "src/app.ts" },
					},
				],
			},
			{
				role: "tool",
				toolCallId: "call-1",
				content: "export const app = true;",
			},
		];

		await summarizer.summarize({
			messages,
			maxSummaryTokens: 4000,
		});

		const prompt = llm.calls[0]?.messages[0]?.content;

		expect(prompt).toContain("## Active task");
		expect(prompt).toContain("[REDACTED]");
		expect(prompt).toContain("1. USER:\nRead the app file.");
		expect(prompt).toContain("2. ASSISTANT:\nI will inspect it.");
		expect(prompt).toContain("TOOL CALLS:");
		expect(prompt).toContain('- readFile {"path":"src/app.ts"}');
		expect(prompt).toContain(
			"3. TOOL RESULT call-1:\nexport const app = true;",
		);
	});

	test("propagates LLM errors", async () => {
		const summarizer = new LlmContextSummarizer(
			new FakeSummaryLLM("unused", new Error("summary failed")),
		);

		await expect(
			summarizer.summarize({
				messages: [{ role: "user", content: "Hello" }],
				maxSummaryTokens: 100,
			}),
		).rejects.toThrow("summary failed");
	});
});
