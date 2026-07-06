import type { SlashCommand } from "../command";

function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatNumber(value: number): string {
	return value.toLocaleString("en-US");
}

export function createContextCommand(): SlashCommand {
	return {
		name: "context",
		description: "Show current context usage.",
		usage: "/context",
		execute(_args, context) {
			const usage = context.getContextUsage();
			const thresholdPercent =
				usage.thresholdTokens > 0
					? (usage.tokenCount / usage.thresholdTokens) * 100
					: 0;
			const windowPercent =
				usage.contextWindowTokens > 0
					? (usage.tokenCount / usage.contextWindowTokens) * 100
					: 0;

			return {
				type: "message",
				content: [
					`Messages: ${context.getMessageCount()}`,
					`Tokens: ${formatNumber(usage.tokenCount)}`,
					`Threshold: ${formatNumber(usage.thresholdTokens)} (${formatPercent(thresholdPercent)})`,
					`Window: ${formatNumber(usage.contextWindowTokens)} (${formatPercent(windowPercent)})`,
				].join("\n"),
			};
		},
	};
}
