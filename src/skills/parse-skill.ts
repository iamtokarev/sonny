import { parseFrontmatter } from "../parsing";
import type { Skill } from "./skill";

export type ParseSkillResult =
	| { ok: true; skill: Skill }
	| { ok: false; error: string };

function failedParsing(errorString: string): ParseSkillResult {
	return {
		ok: false,
		error: errorString,
	};
}

export function parseSkill(
	fileContent: string,
	options: { path: string; directoryName: string },
): ParseSkillResult {
	try {
		const { frontmatter, body } = parseFrontmatter(fileContent);
		const data = (frontmatter ?? {}) as Record<string, unknown>;

		const name = typeof data.name === "string" ? data.name.trim() : "";
		if (!name) {
			return failedParsing(
				`Skill at ${options.path} is missing a "name" field`,
			);
		}

		const description =
			typeof data.description === "string" ? data.description.trim() : "";
		if (!description) {
			return failedParsing(
				`Skill at ${options.path} is missing a "description" field`,
			);
		}

		if (!body) {
			return failedParsing(`Skill at ${options.path} is missing instructions`);
		}

		return {
			ok: true,
			skill: {
				name,
				description,
				body,
				path: options.path,
				directory: options.directoryName,
			},
		};
	} catch (err) {
		return failedParsing(err instanceof Error ? err.message : String(err));
	}
}
