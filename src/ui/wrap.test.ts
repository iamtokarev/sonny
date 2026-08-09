import { describe, expect, test } from "bun:test";
import { resolveLayout } from "./use-terminal-size";
import { formatElapsed } from "./use-ticker";
import { padTo, wrapText } from "./wrap";

describe("wrapText", () => {
	test("breaks on word boundaries", () => {
		expect(wrapText("lift the timeout into config", 12)).toEqual([
			"lift the",
			"timeout into",
			"config",
		]);
	});

	test("keeps existing line breaks", () => {
		expect(wrapText("one\ntwo", 20)).toEqual(["one", "two"]);
	});

	test("breaks a word longer than the terminal", () => {
		expect(wrapText("aaaaaaaa word", 4)).toEqual(["aaaa", "aaaa", "word"]);
	});

	test("returns a single empty line for empty input", () => {
		expect(wrapText("", 10)).toEqual([""]);
	});
});

describe("padTo", () => {
	test("pads a band out to the full width", () => {
		expect(padTo("hi", 5)).toBe("hi   ");
	});

	test("never truncates", () => {
		expect(padTo("hello", 3)).toBe("hello");
	});
});

describe("resolveLayout", () => {
	test("classifies narrow, standard and wide terminals", () => {
		expect(resolveLayout(50, 20).isNarrow).toBe(true);
		expect(resolveLayout(80, 24).isNarrow).toBe(false);
		expect(resolveLayout(80, 24).isWide).toBe(false);
		expect(resolveLayout(120, 40).isWide).toBe(true);
	});

	test("falls back when the terminal reports nothing useful", () => {
		expect(resolveLayout(0, 0)).toMatchObject({ columns: 80, rows: 24 });
	});
});

describe("formatElapsed", () => {
	test("counts seconds, then minutes, then hours", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(41)).toBe("41s");
		expect(formatElapsed(64)).toBe("1m 04s");
		expect(formatElapsed(3723)).toBe("1h 02m 03s");
	});
});
