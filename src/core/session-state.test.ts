import { beforeEach, describe, expect, test } from "bun:test";
import { SessionState } from "./session-state";

describe("SessionState", () => {
	let state: SessionState;

	beforeEach(() => {
		state = new SessionState();
	});

	test("starts with no conversation messages", () => {
		expect(state.messageCount).toBe(0);
	});

	test("builds messages with the system prompt first", () => {
		state.addMessage({ role: "user", content: "Hello" });

		expect(state.buildMessages("You are Sonny")).toEqual([
			{ role: "system", content: "You are Sonny" },
			{ role: "user", content: "Hello" },
		]);
	});

	test("counts added conversation messages", () => {
		state.addMessage({ role: "user", content: "Hello" });
		state.addMessage({ role: "assistant", content: "Hey there" });

		expect(state.messageCount).toBe(2);
	});

	test("returns conversation messages without system prompt", () => {
		state.addMessage({ role: "user", content: "Hello" });

		expect(state.getMessages()).toEqual([{ role: "user", content: "Hello" }]);
	});

	test("returns a copy of conversation messages", () => {
		state.addMessage({ role: "user", content: "Hello" });

		const messages = state.getMessages();
		messages.push({ role: "assistant", content: "Mutated externally" });

		expect(state.getMessages()).toEqual([{ role: "user", content: "Hello" }]);
	});
});
