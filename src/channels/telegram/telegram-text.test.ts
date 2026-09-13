import { describe, expect, test } from "bun:test";
import { splitTelegramText } from "./telegram-text";

describe("splitTelegramText", () => {
	test("returns no chunks for empty text", () => {
		expect(splitTelegramText("")).toEqual([]);
	});

	test("keeps text at or below the limit intact", () => {
		expect(splitTelegramText("hello", 5)).toEqual(["hello"]);
	});

	test("prefers paragraph, line, then whitespace boundaries", () => {
		expect(splitTelegramText("abc\n\ndefgh", 7)).toEqual(["abc\n\n", "defgh"]);
		expect(splitTelegramText("abc\ndefgh", 5)).toEqual(["abc\n", "defgh"]);
		expect(splitTelegramText("abc defgh", 5)).toEqual(["abc ", "defgh"]);
	});

	test("hard-splits only when no boundary is available", () => {
		expect(splitTelegramText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
	});

	test("counts Unicode code points rather than UTF-16 code units", () => {
		const text = "🙂🙂🙂🙂🙂";
		const chunks = splitTelegramText(text, 2);

		expect(chunks).toEqual(["🙂🙂", "🙂🙂", "🙂"]);
		expect(chunks.join("")).toBe(text);
	});

	test("preserves content and bounds every generated chunk", () => {
		const text = `${"a".repeat(12)}\n\n${"b".repeat(12)} ccccc`;
		const chunks = splitTelegramText(text, 10);

		expect(chunks.join("")).toBe(text);
		expect(chunks.every((chunk) => Array.from(chunk).length <= 10)).toBe(true);
	});

	test("rejects invalid limits", () => {
		expect(() => splitTelegramText("hello", 0)).toThrow(
			"Telegram text limit must be a positive integer.",
		);
		expect(() => splitTelegramText("hello", 1.5)).toThrow(
			"Telegram text limit must be a positive integer.",
		);
	});
});
