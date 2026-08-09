/**
 * The editing model behind the composer.
 *
 * Kept as a pure reducer so every key binding can be tested without a
 * terminal: the hook in `use-text-input.ts` is a thin wrapper around it.
 */

export type TextInputState = {
	value: string;
	cursor: number;
	history: string[];
	/** Index into `history` while browsing it, counted from the newest. */
	historyIndex: number | null;
	/** The line being edited, parked while history is browsed. */
	stash: string;
};

export type CursorTarget =
	| "left"
	| "right"
	| "wordLeft"
	| "wordRight"
	| "lineStart"
	| "lineEnd";

export type TextInputAction =
	| { type: "insert"; text: string }
	| { type: "backspace" }
	| { type: "delete" }
	| { type: "deleteWordLeft" }
	| { type: "deleteToLineStart" }
	| { type: "move"; to: CursorTarget }
	| { type: "newline" }
	| { type: "clear" }
	| { type: "set"; value: string }
	| { type: "historyPrev" }
	| { type: "historyNext" }
	| { type: "submitted" };

const maxHistoryEntries = 100;

export function createTextInputState(
	overrides: Partial<TextInputState> = {},
): TextInputState {
	return {
		value: "",
		cursor: 0,
		history: [],
		historyIndex: null,
		stash: "",
		...overrides,
	};
}

function clampCursor(value: string, cursor: number): number {
	return Math.max(0, Math.min(value.length, cursor));
}

function withValue(
	state: TextInputState,
	value: string,
	cursor: number,
): TextInputState {
	return {
		...state,
		value,
		cursor: clampCursor(value, cursor),
		// Any edit detaches the line from the history entry it came from.
		historyIndex: null,
	};
}

function isWordCharacter(character: string | undefined): boolean {
	return character !== undefined && /\S/.test(character);
}

function findWordLeft(value: string, cursor: number): number {
	let index = cursor;

	while (index > 0 && !isWordCharacter(value[index - 1])) {
		index -= 1;
	}

	while (index > 0 && isWordCharacter(value[index - 1])) {
		index -= 1;
	}

	return index;
}

function findWordRight(value: string, cursor: number): number {
	let index = cursor;

	while (index < value.length && !isWordCharacter(value[index])) {
		index += 1;
	}

	while (index < value.length && isWordCharacter(value[index])) {
		index += 1;
	}

	return index;
}

export function findLineStart(value: string, cursor: number): number {
	const previousBreak = value.lastIndexOf("\n", Math.max(0, cursor - 1));

	return previousBreak === -1 ? 0 : previousBreak + 1;
}

export function findLineEnd(value: string, cursor: number): number {
	const nextBreak = value.indexOf("\n", cursor);

	return nextBreak === -1 ? value.length : nextBreak;
}

function moveCursor(state: TextInputState, to: CursorTarget): TextInputState {
	const { value, cursor } = state;

	const nextCursor = (() => {
		switch (to) {
			case "left":
				return cursor - 1;
			case "right":
				return cursor + 1;
			case "wordLeft":
				return findWordLeft(value, cursor);
			case "wordRight":
				return findWordRight(value, cursor);
			case "lineStart":
				return findLineStart(value, cursor);
			case "lineEnd":
				return findLineEnd(value, cursor);
		}
	})();

	return { ...state, cursor: clampCursor(value, nextCursor) };
}

function recallHistory(
	state: TextInputState,
	direction: "prev" | "next",
): TextInputState {
	if (state.history.length === 0) {
		return state;
	}

	const currentIndex = state.historyIndex;

	if (direction === "prev") {
		const nextIndex =
			currentIndex === null
				? 0
				: Math.min(state.history.length - 1, currentIndex + 1);
		const entry = state.history[nextIndex];

		if (entry === undefined) {
			return state;
		}

		return {
			...state,
			value: entry,
			cursor: entry.length,
			historyIndex: nextIndex,
			// Park whatever was being typed so `next` can bring it back.
			stash: currentIndex === null ? state.value : state.stash,
		};
	}

	if (currentIndex === null) {
		return state;
	}

	if (currentIndex === 0) {
		return {
			...state,
			value: state.stash,
			cursor: state.stash.length,
			historyIndex: null,
			stash: "",
		};
	}

	const nextIndex = currentIndex - 1;
	const entry = state.history[nextIndex];

	if (entry === undefined) {
		return state;
	}

	return {
		...state,
		value: entry,
		cursor: entry.length,
		historyIndex: nextIndex,
	};
}

function rememberSubmission(state: TextInputState): TextInputState {
	const submitted = state.value.trim();
	const history =
		submitted.length === 0 || state.history[0] === state.value
			? state.history
			: [state.value, ...state.history].slice(0, maxHistoryEntries);

	return {
		...state,
		value: "",
		cursor: 0,
		history,
		historyIndex: null,
		stash: "",
	};
}

export function textInputReducer(
	state: TextInputState,
	action: TextInputAction,
): TextInputState {
	switch (action.type) {
		case "insert": {
			const value =
				state.value.slice(0, state.cursor) +
				action.text +
				state.value.slice(state.cursor);

			return withValue(state, value, state.cursor + action.text.length);
		}
		case "newline": {
			const value = `${state.value.slice(0, state.cursor)}\n${state.value.slice(state.cursor)}`;

			return withValue(state, value, state.cursor + 1);
		}
		case "backspace": {
			if (state.cursor === 0) {
				return state;
			}

			const value =
				state.value.slice(0, state.cursor - 1) +
				state.value.slice(state.cursor);

			return withValue(state, value, state.cursor - 1);
		}
		case "delete": {
			if (state.cursor >= state.value.length) {
				return state;
			}

			const value =
				state.value.slice(0, state.cursor) +
				state.value.slice(state.cursor + 1);

			return withValue(state, value, state.cursor);
		}
		case "deleteWordLeft": {
			const start = findWordLeft(state.value, state.cursor);

			if (start === state.cursor) {
				return state;
			}

			const value =
				state.value.slice(0, start) + state.value.slice(state.cursor);

			return withValue(state, value, start);
		}
		case "deleteToLineStart": {
			const start = findLineStart(state.value, state.cursor);

			if (start === state.cursor) {
				return state;
			}

			const value =
				state.value.slice(0, start) + state.value.slice(state.cursor);

			return withValue(state, value, start);
		}
		case "move":
			return moveCursor(state, action.to);
		case "clear":
			return { ...state, value: "", cursor: 0, historyIndex: null, stash: "" };
		case "set":
			return withValue(state, action.value, action.value.length);
		case "historyPrev":
			return recallHistory(state, "prev");
		case "historyNext":
			return recallHistory(state, "next");
		case "submitted":
			return rememberSubmission(state);
	}
}

export type RenderedInput = {
	lines: string[];
	cursorLine: number;
	cursorColumn: number;
};

/** Splits the value into rows and locates the cursor for the composer. */
export function renderInput(state: TextInputState): RenderedInput {
	const lines = state.value.split("\n");
	const before = state.value.slice(0, state.cursor).split("\n");
	const cursorLine = before.length - 1;

	return {
		lines,
		cursorLine,
		cursorColumn: before[cursorLine]?.length ?? 0,
	};
}
