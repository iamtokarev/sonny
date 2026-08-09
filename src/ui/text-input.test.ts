import { describe, expect, test } from "bun:test";
import {
	createTextInputState,
	renderInput,
	type TextInputAction,
	type TextInputState,
	textInputReducer,
} from "./text-input";

function apply(
	state: TextInputState,
	...actions: TextInputAction[]
): TextInputState {
	return actions.reduce(textInputReducer, state);
}

function typed(text: string): TextInputState {
	return apply(createTextInputState(), { type: "insert", text });
}

describe("editing", () => {
	test("inserts at the cursor rather than at the end", () => {
		const state = apply(
			typed("fix the test"),
			{ type: "move", to: "lineStart" },
			{ type: "insert", text: "please " },
		);

		expect(state.value).toBe("please fix the test");
		expect(state.cursor).toBe(7);
	});

	test("backspace at the start of the line does nothing", () => {
		const state = apply(
			typed("hi"),
			{ type: "move", to: "lineStart" },
			{
				type: "backspace",
			},
		);

		expect(state.value).toBe("hi");
	});

	test("deletes forward under the cursor", () => {
		const state = apply(
			typed("abc"),
			{ type: "move", to: "lineStart" },
			{
				type: "delete",
			},
		);

		expect(state.value).toBe("bc");
	});
});

describe("word motion", () => {
	test("moves left over a whole word", () => {
		const state = apply(typed("lift the timeout"), {
			type: "move",
			to: "wordLeft",
		});

		expect(state.cursor).toBe("lift the ".length);
	});

	test("moves right over a whole word", () => {
		const state = apply(
			typed("lift the timeout"),
			{ type: "move", to: "lineStart" },
			{ type: "move", to: "wordRight" },
		);

		expect(state.cursor).toBe("lift".length);
	});

	test("deletes the word to the left", () => {
		const state = apply(typed("lift the timeout"), {
			type: "deleteWordLeft",
		});

		expect(state.value).toBe("lift the ");
	});

	test("deletes to the start of the current line only", () => {
		const state = apply(
			typed("first"),
			{ type: "newline" },
			{ type: "insert", text: "second" },
			{ type: "deleteToLineStart" },
		);

		expect(state.value).toBe("first\n");
	});
});

describe("multi-line", () => {
	test("newline splits at the cursor and keeps counting", () => {
		const state = apply(
			typed("explain this:"),
			{ type: "newline" },
			{ type: "insert", text: "  const x = 1;" },
		);

		expect(state.value).toBe("explain this:\n  const x = 1;");
		expect(renderInput(state)).toEqual({
			lines: ["explain this:", "  const x = 1;"],
			cursorLine: 1,
			cursorColumn: "  const x = 1;".length,
		});
	});

	test("home and end stay within the current line", () => {
		const state = apply(
			typed("one"),
			{ type: "newline" },
			{ type: "insert", text: "two" },
			{ type: "move", to: "lineStart" },
		);

		expect(state.cursor).toBe(4);
		expect(apply(state, { type: "move", to: "lineEnd" }).cursor).toBe(7);
	});
});

describe("prompt history", () => {
	test("remembers submitted lines newest first", () => {
		const state = apply(
			typed("first"),
			{ type: "submitted" },
			{ type: "insert", text: "second" },
			{ type: "submitted" },
		);

		expect(state.history).toEqual(["second", "first"]);
		expect(state.value).toBe("");
	});

	test("walks back through history and returns to the draft", () => {
		const submitted = apply(typed("first"), { type: "submitted" });
		const drafting = apply(submitted, { type: "insert", text: "half-typed" });
		const recalled = apply(drafting, { type: "historyPrev" });

		expect(recalled.value).toBe("first");
		expect(apply(recalled, { type: "historyNext" }).value).toBe("half-typed");
	});

	test("does not store blank submissions or immediate repeats", () => {
		const once = apply(typed("same"), { type: "submitted" });
		const twice = apply(
			once,
			{ type: "insert", text: "same" },
			{
				type: "submitted",
			},
		);
		const blank = apply(
			twice,
			{ type: "insert", text: "   " },
			{
				type: "submitted",
			},
		);

		expect(blank.history).toEqual(["same"]);
	});

	test("editing a recalled line detaches it from history", () => {
		const submitted = apply(typed("first"), { type: "submitted" });
		const edited = apply(
			submitted,
			{ type: "historyPrev" },
			{
				type: "insert",
				text: "!",
			},
		);

		expect(edited.historyIndex).toBe(null);
		expect(edited.value).toBe("first!");
	});
});
