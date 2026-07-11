import type { ChatMessage } from "../domain";

export type ContextSummaryInput = {
	messages: ChatMessage[];
	maxSummaryTokens: number;
};

export interface ContextSummarizer {
	summarize(input: ContextSummaryInput): Promise<string>;
}
