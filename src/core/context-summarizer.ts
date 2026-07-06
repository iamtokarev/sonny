import type { ChatMessage } from "./message";

export type ContextSummaryInput = {
	messages: ChatMessage[];
	maxSummaryTokens: number;
};

export interface ContextSummarizer {
	summarize(input: ContextSummaryInput): Promise<string>;
}
