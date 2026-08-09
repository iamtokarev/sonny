import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import {
	isCommandQuery,
	type KeyMode,
	resolveKeyMode,
	routeKey,
} from "./key-router";

function key(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	};
}

function route(
	mode: KeyMode,
	input: string,
	overrides: Partial<Key> = {},
	quitArmed = false,
) {
	return routeKey({ mode, input, key: key(overrides), quitArmed });
}

describe("escape", () => {
	test("clears the input when idle", () => {
		expect(route("idle", "", { escape: true })).toEqual({
			type: "edit",
			action: { type: "clear" },
		});
	});

	test("cancels the turn while busy", () => {
		expect(route("busy", "", { escape: true })).toEqual({ type: "cancelTurn" });
	});

	test("denies and cancels from an approval", () => {
		expect(route("approval", "", { escape: true })).toEqual({
			type: "denyAndCancel",
		});
	});

	test("only closes the popup", () => {
		expect(route("popup", "", { escape: true })).toEqual({
			type: "popupClose",
		});
	});
});

describe("ctrl-c", () => {
	test("quits straight away when idle", () => {
		expect(route("idle", "c", { ctrl: true })).toEqual({ type: "quit" });
	});

	test("warns before quitting mid-turn", () => {
		expect(route("busy", "c", { ctrl: true })).toEqual({ type: "armQuit" });
	});

	test("quits on the second press", () => {
		expect(route("busy", "c", { ctrl: true }, true)).toEqual({ type: "quit" });
	});

	test("warns before quitting from an approval too", () => {
		expect(route("approval", "c", { ctrl: true })).toEqual({ type: "armQuit" });
	});
});

describe("return", () => {
	test("sends when idle", () => {
		expect(route("idle", "", { return: true })).toEqual({ type: "submit" });
	});

	test("queues while busy", () => {
		expect(route("busy", "", { return: true })).toEqual({ type: "submit" });
	});

	test("adds a line with shift held", () => {
		expect(route("idle", "", { return: true, shift: true })).toEqual({
			type: "edit",
			action: { type: "newline" },
		});
	});

	test("runs the selected command from the popup", () => {
		expect(route("popup", "", { return: true })).toEqual({ type: "popupRun" });
	});

	test("does nothing while an approval is waiting", () => {
		expect(route("approval", "", { return: true })).toEqual({ type: "none" });
	});

	test("accepts a bare newline from terminals that send one", () => {
		expect(route("idle", "\n")).toEqual({ type: "submit" });
		expect(route("idle", "\r")).toEqual({ type: "submit" });
	});
});

describe("approval keys", () => {
	test("y approves and n denies", () => {
		expect(route("approval", "y")).toEqual({ type: "approve" });
		expect(route("approval", "N")).toEqual({ type: "deny" });
	});

	test("other characters are ignored rather than typed", () => {
		expect(route("approval", "z")).toEqual({ type: "none" });
	});

	test("y is just a letter anywhere else", () => {
		expect(route("idle", "y")).toEqual({
			type: "edit",
			action: { type: "insert", text: "y" },
		});
	});
});

describe("motion and history", () => {
	test("arrows walk prompt history when editing", () => {
		expect(route("idle", "", { upArrow: true })).toEqual({
			type: "edit",
			action: { type: "historyPrev" },
		});
	});

	test("arrows move the popup selection", () => {
		expect(route("popup", "", { downArrow: true })).toEqual({
			type: "popupMove",
			direction: "down",
		});
	});

	test("meta turns a left arrow into a word jump", () => {
		expect(route("idle", "", { leftArrow: true, meta: true })).toEqual({
			type: "edit",
			action: { type: "move", to: "wordLeft" },
		});
	});

	test("readline shortcuts reach the line ends", () => {
		expect(route("idle", "a", { ctrl: true })).toEqual({
			type: "edit",
			action: { type: "move", to: "lineStart" },
		});
		expect(route("idle", "u", { ctrl: true })).toEqual({
			type: "edit",
			action: { type: "deleteToLineStart" },
		});
	});

	test("tab completes only inside the popup", () => {
		expect(route("popup", "", { tab: true })).toEqual({
			type: "popupComplete",
		});
		expect(route("idle", "", { tab: true })).toEqual({ type: "none" });
	});
});

describe("isCommandQuery", () => {
	test("recognises a slash command being typed", () => {
		expect(isCommandQuery("/co")).toBe(true);
	});

	test("stops once the command takes an argument", () => {
		expect(isCommandQuery("/skills test")).toBe(false);
	});

	test("ignores ordinary messages", () => {
		expect(isCommandQuery("what is 2/3")).toBe(false);
	});
});

describe("resolveKeyMode", () => {
	test("an approval outranks everything", () => {
		expect(
			resolveKeyMode({ hasApproval: true, isBusy: true, isPopupOpen: true }),
		).toBe("approval");
	});

	test("the popup outranks a running turn", () => {
		expect(
			resolveKeyMode({ hasApproval: false, isBusy: true, isPopupOpen: true }),
		).toBe("popup");
	});

	test("busy and idle are the base cases", () => {
		expect(
			resolveKeyMode({ hasApproval: false, isBusy: true, isPopupOpen: false }),
		).toBe("busy");
		expect(
			resolveKeyMode({ hasApproval: false, isBusy: false, isPopupOpen: false }),
		).toBe("idle");
	});
});
