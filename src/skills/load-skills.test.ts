import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSkills } from "./load-skills";

async function createTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "sonny-load-skills-"));
}

async function writeSkill(
	root: string,
	relativePath: string,
	content: string,
): Promise<string> {
	const path = join(root, relativePath);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);

	return path;
}

function skillContent(
	name: string,
	description: string,
	body = "Instructions",
) {
	return `---
name: ${name}
description: ${description}
---
${body}
`;
}

describe("loadSkills", () => {
	test("returns empty result when skills directory does not exist", async () => {
		const root = join(await createTempDir(), "missing");

		const result = await loadSkills(root);

		expect(result).toEqual({
			skills: [],
			errors: [],
		});
	});

	test("loads one valid skill", async () => {
		const root = await createTempDir();
		const path = await writeSkill(
			root,
			"example/SKILL.md",
			skillContent("Example", "Helps with examples"),
		);

		const result = await loadSkills(root);

		expect(result).toEqual({
			skills: [
				{
					name: "Example",
					description: "Helps with examples",
					body: "Instructions",
					path,
					directory: dirname(path),
				},
			],
			errors: [],
		});
	});

	test("loads nested skills", async () => {
		const root = await createTempDir();
		const path = await writeSkill(
			root,
			"development/testing/SKILL.md",
			skillContent("Testing", "Helps with tests"),
		);

		const result = await loadSkills(root);

		expect(result.skills).toEqual([
			{
				name: "Testing",
				description: "Helps with tests",
				body: "Instructions",
				path,
				directory: dirname(path),
			},
		]);
		expect(result.errors).toEqual([]);
	});

	test("skips invalid skill and reports error", async () => {
		const root = await createTempDir();
		const validPath = await writeSkill(
			root,
			"valid/SKILL.md",
			skillContent("Valid", "Loads correctly"),
		);
		await writeSkill(
			root,
			"invalid/SKILL.md",
			`---
description: Missing name
---
Instructions
`,
		);

		const result = await loadSkills(root);

		expect(result.skills).toEqual([
			{
				name: "Valid",
				description: "Loads correctly",
				body: "Instructions",
				path: validPath,
				directory: dirname(validPath),
			},
		]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('missing a "name" field');
	});

	test("sorts skills by name", async () => {
		const root = await createTempDir();

		await writeSkill(root, "zeta/SKILL.md", skillContent("Zeta", "Last"));
		await writeSkill(root, "alpha/SKILL.md", skillContent("Alpha", "First"));

		const result = await loadSkills(root);

		expect(result.skills.map((skill) => skill.name)).toEqual(["Alpha", "Zeta"]);
	});

	test("sets path and directory from the discovered file", async () => {
		const root = await createTempDir();
		const path = await writeSkill(
			root,
			"category/example/SKILL.md",
			skillContent("Example", "Has file metadata"),
		);

		const result = await loadSkills(root);

		expect(result.skills[0]?.path).toBe(path);
		expect(result.skills[0]?.directory).toBe(dirname(path));
	});
});
