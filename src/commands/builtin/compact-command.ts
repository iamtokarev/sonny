import type { PreparedContext } from "../../core/context-manager";
import type { SlashCommand } from "../command";

function formatNumber(value: number): string {
	return value.toLocaleString("en-US");
}

function formatTokenChange(result: PreparedContext): string {
	return `${formatNumber(result.tokenCountBefore)} -> ${formatNumber(result.tokenCountAfter)}`;
}

function formatCompactionResult(result: PreparedContext): string {
	if (!result.changed) {
		return "Nothing to compact yet.";
	}

	if (result.summaryCompactedMessageCount > 0) {
		return `Context compacted. Summarized ${result.summaryCompactedMessageCount} messages. Tokens: ${formatTokenChange(result)}.`;
	}

	if (result.compactedToolResultCount > 0) {
		return `Context compacted. Compacted ${result.compactedToolResultCount} tool result(s). Tokens: ${formatTokenChange(result)}.`;
	}

	return `Context compacted. Tokens: ${formatTokenChange(result)}.`;
}

export function createCompactCommand(): SlashCommand {
	return {
		name: "compact",
		description: "Compact conversation context manually.",
		usage: "/compact",
		async execute(_args, context) {
			try {
				return {
					type: "message",
					content: formatCompactionResult(await context.compactContext()),
				};
			} catch (error) {
				return {
					type: "message",
					content: `Context compaction failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		},
	};
}
