import type { ChatMessage, ToolCall, ToolCompletionStatus } from "../domain";
import type { MeterModel } from "./context-meter";
import {
	describeToolCall,
	summariseToolResult,
	type ToolRow,
} from "./tool-row";

export type NoticeTone = "info" | "warn" | "error";

export type TranscriptItem =
	| {
			id: string;
			kind: "header";
			glyph: "sonny" | "resumed";
			title: string;
			subtitle: string;
			lines: string[];
	  }
	| { id: string; kind: "context"; meter: MeterModel }
	| { id: string; kind: "user"; text: string }
	| { id: string; kind: "answer"; text: string }
	| { id: string; kind: "tool"; row: ToolRow }
	| {
			id: string;
			kind: "notice";
			tone: NoticeTone;
			title: string | null;
			lines: string[];
	  }
	| { id: string; kind: "divider"; label: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

/** A transcript item before the renderer assigns it a stable key. */
export type TranscriptDraft = DistributiveOmit<TranscriptItem, "id">;

/**
 * Replayed history goes through the same renderers as live output, so a
 * restored tool row is indistinguishable from one you just watched run —
 * except that the history file has no durations, so we show none rather than
 * inventing a number.
 */
export function restoreTranscript(messages: ChatMessage[]): TranscriptDraft[] {
	const toolCallsById = new Map<string, ToolCall>();
	const items: TranscriptDraft[] = [];

	for (const message of messages) {
		if (message.role === "system") {
			continue;
		}

		if (message.role === "user") {
			items.push({ kind: "user", text: message.content });
			continue;
		}

		if (message.role === "assistant") {
			for (const toolCall of message.toolCalls ?? []) {
				toolCallsById.set(toolCall.id, toolCall);
			}

			if (message.content.trim().length > 0) {
				items.push({ kind: "answer", text: message.content });
			}

			continue;
		}

		items.push({
			kind: "tool",
			row: restoreToolRow(
				toolCallsById.get(message.toolCallId),
				message.content,
				message.status,
			),
		});
	}

	return items;
}

/**
 * Sessions recorded before tool results carried a status have to be read from
 * the message text, which is exactly the guessing the status field replaced.
 */
export function inferLegacyToolStatus(content: string): ToolCompletionStatus {
	if (content.startsWith("BLOCKED:")) {
		return "denied";
	}

	if (
		content.startsWith("ERROR:") ||
		content.startsWith("Tool execution failed:")
	) {
		return "failed";
	}

	return "succeeded";
}

function restoreToolRow(
	toolCall: ToolCall | undefined,
	content: string,
	status: ToolCompletionStatus | undefined,
): ToolRow {
	const toolName = toolCall?.name ?? "tool";
	const summary = summariseToolResult(
		toolName,
		status ?? inferLegacyToolStatus(content),
		content,
	);

	return {
		toolName,
		preview:
			toolCall === undefined
				? ""
				: describeToolCall(toolCall.name, toolCall.parameters),
		// History records no durations, so we show none rather than invent one.
		duration: null,
		...summary,
	};
}
