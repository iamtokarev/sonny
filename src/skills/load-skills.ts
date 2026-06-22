import { dirname } from "node:path";
import { dirExists, findFiles } from "../utils/fs";
import { parseSkill } from "./parse-skill";
import type { Skill } from "./skill";

export type LoadSkillsResult = {
	skills: Skill[];
	errors: string[];
};

export async function loadSkills(
	skillsDirectory: string,
): Promise<LoadSkillsResult> {
	const skills: Skill[] = [];
	const errors: string[] = [];

	if (!(await dirExists(skillsDirectory))) {
		return {
			skills,
			errors,
		};
	}

	const skillFiles = await findFiles(
		skillsDirectory,
		(name) => name === "SKILL.md",
	);

	for (const file of skillFiles) {
		try {
			const fileContent = await Bun.file(file).text();
			const parsedSkill = parseSkill(fileContent, {
				path: file,
				directoryName: dirname(file),
			});

			if (parsedSkill.ok) {
				skills.push(parsedSkill.skill);
			} else {
				errors.push(parsedSkill.error);
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to read ${file}: ${reason}`);
		}
	}

	return {
		skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
		errors: errors.sort(),
	};
}
