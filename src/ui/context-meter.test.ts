import { describe, expect, test } from "bun:test";
import type { ContextUsage } from "../context";
import { describeUsage } from "./context-meter";

function usage(overrides: Partial<ContextUsage> = {}): ContextUsage {
	return {
		tokenCount: 62_411,
		contextWindowTokens: 200_000,
		thresholdTokens: 150_000,
		thresholdRatio: 0.75,
		...overrides,
	};
}

describe("describeUsage", () => {
	test("fills the meter in proportion to the window", () => {
		const meter = describeUsage(usage());

		expect(meter.percent).toBe(31);
		expect(meter.filledCells).toBe(3);
		expect(meter.zone).toBe("normal");
	});

	test("reports how far it is from automatic compaction", () => {
		expect(describeUsage(usage()).headroomTokens).toBe(87_589);
	});

	test("warns past sixty percent", () => {
		expect(describeUsage(usage({ tokenCount: 130_000 })).zone).toBe("warn");
	});

	test("goes over once the compaction threshold is reached", () => {
		expect(describeUsage(usage({ tokenCount: 155_000 })).zone).toBe("over");
	});

	test("never overflows the meter", () => {
		const meter = describeUsage(usage({ tokenCount: 400_000 }));

		expect(meter.percent).toBe(100);
		expect(meter.filledCells).toBe(meter.totalCells);
		expect(meter.headroomTokens).toBe(0);
	});

	test("survives a session with no window configured", () => {
		const meter = describeUsage(
			usage({ contextWindowTokens: 0, thresholdTokens: 0 }),
		);

		expect(meter.percent).toBe(0);
		expect(meter.filledCells).toBe(0);
	});
});
