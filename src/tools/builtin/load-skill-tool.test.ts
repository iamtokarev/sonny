import { describe, expect, test } from "bun:test";
import type { Skill } from "../../skills/skill";
import { createLoadSkillTool } from "./load-skill-tool";

function createSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "code-review",
		description: "Review code for defects.",
		body: "Check behavior, risks, and tests.",
		path: "/tmp/skills/code-review/SKILL.md",
		directory: "/tmp/skills/code-review",
		...overrides,
	};
}

describe("loadSkillTool", () => {
	test("loads skill body as markdown by exact name", async () => {
		const tool = createLoadSkillTool([createSkill()]);

		const result = await tool.execute({ name: "code-review" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.content).toBe(
				`Skill: code-review
Directory: /tmp/skills/code-review

Check behavior, risks, and tests.`,
			);
		}
	});

	test("trims skill name parameter", async () => {
		const tool = createLoadSkillTool([createSkill()]);

		const result = await tool.execute({ name: "  code-review  " });

		expect(result.ok).toBe(true);
	});

	test("returns error for invalid parameters", async () => {
		const tool = createLoadSkillTool([createSkill()]);

		const result = await tool.execute({});

		expect(result).toEqual({
			ok: false,
			error: "Invalid parameters: name is required",
		});
	});

	test("returns error for blank name", async () => {
		const tool = createLoadSkillTool([createSkill()]);

		const result = await tool.execute({ name: "   " });

		expect(result).toEqual({
			ok: false,
			error: "Invalid parameters: name is required",
		});
	});

	test("returns available skills when skill is not found", async () => {
		const tool = createLoadSkillTool([
			createSkill({ name: "zeta" }),
			createSkill({ name: "alpha" }),
		]);

		const result = await tool.execute({ name: "missing" });

		expect(result).toEqual({
			ok: false,
			error: "Skill not found: missing. Available skills: alpha, zeta",
		});
	});
});
