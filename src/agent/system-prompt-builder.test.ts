import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "./system-prompt-builder";

describe("buildSystemPrompt", () => {
	test("returns empty string when no parts are provided", () => {
		expect(buildSystemPrompt({})).toBe("");
	});

	test("joins stable, context, and volatile parts in order", () => {
		const prompt = buildSystemPrompt({
			stable: ["Agent instructions", "Skills catalog"],
			context: ["Current directory"],
			volatile: ["Conversation started today"],
		});

		expect(prompt).toBe(
			[
				"Agent instructions",
				"Skills catalog",
				"Current directory",
				"Conversation started today",
			].join("\n\n"),
		);
	});

	test("trims sections", () => {
		const prompt = buildSystemPrompt({
			stable: ["  Agent instructions\n"],
			context: ["\nCurrent directory  "],
		});

		expect(prompt).toBe("Agent instructions\n\nCurrent directory");
	});

	test("removes empty sections", () => {
		const prompt = buildSystemPrompt({
			stable: ["Agent instructions", "  "],
			context: ["", "Current directory"],
			volatile: ["\n\t"],
		});

		expect(prompt).toBe("Agent instructions\n\nCurrent directory");
	});

	test("separates remaining sections with double newlines", () => {
		const prompt = buildSystemPrompt({
			stable: ["A"],
			context: ["B"],
		});

		expect(prompt).toBe("A\n\nB");
	});
});
