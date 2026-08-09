import type { ChatMessage, ToolCall } from "../domain";
import type { MeterModel } from "./context-meter";
import { describeToolCall, type ToolRow } from "./tool-row";

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
			),
		});
	}

	return items;
}

function restoreToolRow(
	toolCall: ToolCall | undefined,
	content: string,
): ToolRow {
	const failed =
		content.startsWith("BLOCKED:") ||
		content.startsWith("ERROR:") ||
		content.startsWith("Tool execution failed:");

	return {
		toolName: toolCall?.name ?? "tool",
		preview:
			toolCall === undefined
				? ""
				: describeToolCall(toolCall.name, toolCall.parameters),
		duration: null,
		status: failed ? "error" : "ok",
		result: null,
		detail: null,
	};
}
