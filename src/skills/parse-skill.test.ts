import { describe, expect, test } from "bun:test";
import { parseSkill } from "./parse-skill";

const options = {
	path: "/tmp/sonny/skills/example/SKILL.md",
	directoryName: "/tmp/sonny/skills/example",
};

describe("parseSkill", () => {
	test("parses skill frontmatter and body", () => {
		const result = parseSkill(
			`---
name: Example Skill
description: Helps with example tasks
---

# Example Skill

Follow these steps.
`,
			options,
		);

		expect(result).toEqual({
			ok: true,
			skill: {
				name: "Example Skill",
				description: "Helps with example tasks",
				body: "# Example Skill\n\nFollow these steps.",
				path: options.path,
				directory: options.directoryName,
			},
		});
	});

	test("trims name and description", () => {
		const result = parseSkill(
			`---
name: "  Example Skill  "
description: "  Helps with example tasks  "
---
Instructions
`,
			options,
		);

		expect(result).toEqual({
			ok: true,
			skill: {
				name: "Example Skill",
				description: "Helps with example tasks",
				body: "Instructions",
				path: options.path,
				directory: options.directoryName,
			},
		});
	});

	test("returns error for missing frontmatter", () => {
		const result = parseSkill("# Example Skill\n\nInstructions", options);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing a "name" field`,
		});
	});

	test("returns error for invalid frontmatter", () => {
		const result = parseSkill(
			`---
name: [broken
description: Helps with example tasks
---
Instructions
`,
			options,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.length).toBeGreaterThan(0);
		}
	});

	test("returns error for missing name", () => {
		const result = parseSkill(
			`---
description: Helps with example tasks
---
Instructions
`,
			options,
		);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing a "name" field`,
		});
	});

	test("returns error for blank name", () => {
		const result = parseSkill(
			`---
name: "   "
description: Helps with example tasks
---
Instructions
`,
			options,
		);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing a "name" field`,
		});
	});

	test("returns error for missing description", () => {
		const result = parseSkill(
			`---
name: Example Skill
---
Instructions
`,
			options,
		);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing a "description" field`,
		});
	});

	test("returns error for blank description", () => {
		const result = parseSkill(
			`---
name: Example Skill
description: "   "
---
Instructions
`,
			options,
		);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing a "description" field`,
		});
	});

	test("returns error for empty body", () => {
		const result = parseSkill(
			`---
name: Example Skill
description: Helps with example tasks
---
`,
			options,
		);

		expect(result).toEqual({
			ok: false,
			error: `Skill at ${options.path} is missing instructions`,
		});
	});
});
