import { CONTEXT_SUMMARY_HEADER } from "../context";
import type { ChatMessage } from "../domain";
import type {
	ApprovalContext,
	PreviousToolCall,
} from "../tools/hooks/tool-hooks";

function findPreviousCall(
	messages: readonly ChatMessage[],
): PreviousToolCall | null {
	const lastResult = messages.findLast((message) => message.role === "tool");

	if (lastResult?.role !== "tool") {
		return null;
	}

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		const call = message.toolCalls?.find(
			(toolCall) => toolCall.id === lastResult.toolCallId,
		);

		if (call !== undefined) {
			return {
				name: call.name,
				parameters: call.parameters,
				status: lastResult.status ?? null,
			};
		}
	}

	return null;
}

/**
 * The conversation as approval hooks may see it: the user's own words (not
 * compaction summaries) and the last completed tool call without its output.
 */
export function createApprovalContext(
	messages: readonly ChatMessage[],
): ApprovalContext {
	const userMessages = messages.flatMap((message) =>
		message.role === "user" &&
		!message.content.startsWith(CONTEXT_SUMMARY_HEADER)
			? [message.content]
			: [],
	);

	return {
		recentUserMessages: (limit) =>
			limit > 0 ? userMessages.slice(-limit) : [],
		previousCall: findPreviousCall(messages),
	};
}
