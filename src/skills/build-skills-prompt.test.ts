import { describe, expect, test } from "bun:test";
import { buildSkillsPrompt } from "./build-skills-prompt";
import type { Skill } from "./skill";

function createSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "test-skill",
		description: "Test description",
		body: "Secret body content",
		path: "/tmp/test-skill/SKILL.md",
		directory: "/tmp/test-skill",
		...overrides,
	};
}

describe("buildSkillsPrompt", () => {
	test("returns empty string when no skills are available", () => {
		expect(buildSkillsPrompt([])).toBe("");
	});

	test("builds a compact skills catalog", () => {
		const prompt = buildSkillsPrompt([
			createSkill({
				name: "code-review",
				description: "Review code for bugs and missing tests.",
			}),
		]);

		expect(prompt).toBe(`## Skills

Use skills as specialized task guidance. If a skill is relevant to the task, load it before acting on the task.

Available skills:
- code-review: Review code for bugs and missing tests.`);
	});

	test("sorts skills by name", () => {
		const prompt = buildSkillsPrompt([
			createSkill({ name: "zeta", description: "Last skill." }),
			createSkill({ name: "alpha", description: "First skill." }),
		]);

		expect(prompt.indexOf("- alpha: First skill.")).toBeLessThan(
			prompt.indexOf("- zeta: Last skill."),
		);
	});

	test("deduplicates skills by name", () => {
		const prompt = buildSkillsPrompt([
			createSkill({ name: "review", description: "First description." }),
			createSkill({ name: "review", description: "Second description." }),
		]);

		expect(prompt).toContain("- review: First description.");
		expect(prompt).not.toContain("- review: Second description.");
	});

	test("does not include skill body or filesystem metadata", () => {
		const prompt = buildSkillsPrompt([
			createSkill({
				body: "Detailed private instructions",
				path: "/tmp/skills/example/SKILL.md",
				directory: "/tmp/skills/example",
			}),
		]);

		expect(prompt).not.toContain("Detailed private instructions");
		expect(prompt).not.toContain("/tmp/skills/example");
		expect(prompt).not.toContain("SKILL.md");
	});
});
