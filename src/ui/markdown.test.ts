import { describe, expect, test } from "bun:test";
import { parseMarkdown, parseSpans } from "./markdown";

describe("parseSpans", () => {
	test("marks bold and inline code for the bright ink", () => {
		expect(
			parseSpans("the cap lives in `tool-executor.ts` at **line 88**"),
		).toEqual([
			{ text: "the cap lives in ", emphasis: false },
			{ text: "tool-executor.ts", emphasis: true },
			{ text: " at ", emphasis: false },
			{ text: "line 88", emphasis: true },
		]);
	});

	test("leaves plain text as a single span", () => {
		expect(parseSpans("no markup here")).toEqual([
			{ text: "no markup here", emphasis: false },
		]);
	});
});

describe("parseMarkdown", () => {
	test("renders headings, bullets and fenced code", () => {
		expect(
			parseMarkdown(
				[
					"## Two options",
					"",
					"- config-wide",
					"",
					"```ts",
					"const x = 1;",
					"```",
				].join("\n"),
			),
		).toEqual([
			{ kind: "heading", text: "Two options" },
			{ kind: "blank" },
			{ kind: "bullet", spans: [{ text: "config-wide", emphasis: false }] },
			{ kind: "blank" },
			{ kind: "code", text: "const x = 1;" },
		]);
	});

	test("keeps numbered lists numbered", () => {
		expect(parseMarkdown("1. first")).toEqual([
			{
				kind: "bullet",
				spans: [
					{ text: "1. ", emphasis: false },
					{ text: "first", emphasis: false },
				],
			},
		]);
	});

	test("passes an unsupported construct through as text", () => {
		expect(parseMarkdown("| a | b |")).toEqual([
			{ kind: "text", spans: [{ text: "| a | b |", emphasis: false }] },
		]);
	});

	test("drops trailing blank lines the transcript already provides", () => {
		expect(parseMarkdown("done\n\n\n")).toEqual([
			{ kind: "text", spans: [{ text: "done", emphasis: false }] },
		]);
	});
});
