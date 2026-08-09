import type { Key } from "ink";
import type { TextInputAction } from "./text-input";

/**
 * Four modes, one place. Every keystroke resolves to exactly one intent, which
 * is what makes "esc cancels the turn" and "ctrl-c twice quits" expressible at
 * all — a single handler that owns both editing and control keys can't do it.
 */
export type KeyMode = "idle" | "busy" | "approval" | "popup";

export type KeyIntent =
	| { type: "none" }
	| { type: "edit"; action: TextInputAction }
	| { type: "submit" }
	| { type: "cancelTurn" }
	| { type: "quit" }
	| { type: "armQuit" }
	| { type: "approve" }
	| { type: "deny" }
	| { type: "denyAndCancel" }
	| { type: "popupClose" }
	| { type: "popupMove"; direction: "up" | "down" }
	| { type: "popupComplete" }
	| { type: "popupRun" };

export type KeyEvent = {
	mode: KeyMode;
	input: string;
	key: Key;
	/** True once ctrl-c has been pressed during a turn and we warned about it. */
	quitArmed: boolean;
};

const none: KeyIntent = { type: "none" };

function edit(action: TextInputAction): KeyIntent {
	return { type: "edit", action };
}

function isEditingMode(mode: KeyMode): boolean {
	return mode === "idle" || mode === "busy" || mode === "popup";
}

function routeControlKey({
	mode,
	input,
	quitArmed,
}: KeyEvent): KeyIntent | null {
	switch (input) {
		case "c":
			if (mode === "popup") {
				return { type: "popupClose" };
			}

			// Quitting mid-turn throws away work, so it takes two presses.
			if (mode === "idle" || quitArmed) {
				return { type: "quit" };
			}

			return { type: "armQuit" };
		case "d":
			return mode === "idle" ? { type: "quit" } : none;
		case "u":
			return isEditingMode(mode) ? edit({ type: "deleteToLineStart" }) : none;
		case "w":
			return isEditingMode(mode) ? edit({ type: "deleteWordLeft" }) : none;
		case "a":
			return isEditingMode(mode)
				? edit({ type: "move", to: "lineStart" })
				: none;
		case "e":
			return isEditingMode(mode) ? edit({ type: "move", to: "lineEnd" }) : none;
		default:
			return null;
	}
}

function routeApproval(input: string): KeyIntent {
	switch (input.toLowerCase()) {
		case "y":
			return { type: "approve" };
		case "n":
			return { type: "deny" };
		default:
			return none;
	}
}

export function routeKey(event: KeyEvent): KeyIntent {
	const { mode, input, key } = event;

	if (key.ctrl) {
		return routeControlKey(event) ?? none;
	}

	if (key.escape) {
		switch (mode) {
			case "popup":
				return { type: "popupClose" };
			case "approval":
				return { type: "denyAndCancel" };
			case "busy":
				return { type: "cancelTurn" };
			case "idle":
				return edit({ type: "clear" });
		}
	}

	// Not every terminal reports Enter as a `return` key event — some deliver a
	// bare carriage return or newline. Pasted newlines arrive on the separate
	// paste channel, so treating these as Enter is safe.
	if (key.return || input === "\r" || input === "\n") {
		// Shift or meta with return means "another line", not "send".
		if ((key.shift || key.meta) && isEditingMode(mode)) {
			return edit({ type: "newline" });
		}

		switch (mode) {
			case "popup":
				return { type: "popupRun" };
			case "approval":
				return none;
			default:
				return { type: "submit" };
		}
	}

	if (key.tab) {
		return mode === "popup" ? { type: "popupComplete" } : none;
	}

	if (key.upArrow || key.downArrow) {
		const direction = key.upArrow ? "up" : "down";

		if (mode === "popup") {
			return { type: "popupMove", direction };
		}

		if (mode === "approval") {
			return none;
		}

		return edit({ type: direction === "up" ? "historyPrev" : "historyNext" });
	}

	if (mode === "approval") {
		return routeApproval(input);
	}

	if (key.leftArrow || key.rightArrow) {
		const to = key.leftArrow ? "left" : "right";
		const word = key.leftArrow ? "wordLeft" : "wordRight";

		return edit({ type: "move", to: key.meta ? word : to });
	}

	if (key.home || key.end) {
		return edit({ type: "move", to: key.home ? "lineStart" : "lineEnd" });
	}

	if (key.backspace) {
		return edit({ type: "backspace" });
	}

	if (key.delete) {
		return edit({ type: "delete" });
	}

	// Ink reports some terminals' backspace as delete with an empty input.
	if (input.length === 0) {
		return none;
	}

	return edit({ type: "insert", text: input });
}

/** The popup is open whenever the line is a bare slash command being typed. */
export function isCommandQuery(value: string): boolean {
	return value.startsWith("/") && !/\s/.test(value);
}

export function resolveKeyMode(options: {
	hasApproval: boolean;
	isBusy: boolean;
	isPopupOpen: boolean;
}): KeyMode {
	if (options.hasApproval) {
		return "approval";
	}

	if (options.isPopupOpen) {
		return "popup";
	}

	return options.isBusy ? "busy" : "idle";
}
