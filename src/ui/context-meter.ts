import type { ContextUsage } from "../context";

export type MeterZone = "normal" | "warn" | "over";

export type MeterModel = {
	percent: number;
	filledCells: number;
	totalCells: number;
	zone: MeterZone;
	tokenCount: number;
	windowTokens: number;
	thresholdTokens: number;
	/** Tokens left before automatic compaction kicks in. */
	headroomTokens: number;
};

export const meterCells = 10;
const warnRatio = 0.6;

export function formatTokens(value: number): string {
	return value.toLocaleString("en-US");
}

export function describeUsage(
	usage: ContextUsage,
	totalCells = meterCells,
): MeterModel {
	const windowTokens = Math.max(0, usage.contextWindowTokens);
	const ratio = windowTokens === 0 ? 0 : usage.tokenCount / windowTokens;
	const percent = Math.min(100, Math.round(ratio * 100));
	const thresholdRatio =
		windowTokens === 0 ? 1 : usage.thresholdTokens / windowTokens;

	return {
		percent,
		filledCells: Math.min(totalCells, Math.round(ratio * totalCells)),
		totalCells,
		zone:
			ratio >= thresholdRatio ? "over" : ratio >= warnRatio ? "warn" : "normal",
		tokenCount: usage.tokenCount,
		windowTokens,
		thresholdTokens: usage.thresholdTokens,
		headroomTokens: Math.max(0, usage.thresholdTokens - usage.tokenCount),
	};
}
