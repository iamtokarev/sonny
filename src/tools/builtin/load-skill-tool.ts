import type { Skill } from "../../skills/skill";
import type { Tool } from "../tool";

type LoadSkillParameters = {
	name: string;
};

function parseLoadSkillParameters(
	parameters: unknown,
): LoadSkillParameters | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!("name" in parameters) ||
		typeof parameters.name !== "string" ||
		!parameters.name.trim()
	) {
		return null;
	}

	return {
		name: parameters.name.trim(),
	};
}

export function createLoadSkillTool(skills: Skill[]): Tool {
	return {
		name: "loadSkill",
		description: "Load the full content of a selected skill.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Exact name of the skill to load.",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
		async execute(parameters) {
			const parsed = parseLoadSkillParameters(parameters);

			if (parsed === null) {
				return {
					ok: false,
					error: "Invalid parameters: name is required",
				};
			}

			const skill = skills.find((item) => item.name === parsed.name);

			if (!skill) {
				const availableSkills = skills.map((item) => item.name).sort();

				return {
					ok: false,
					error: `Skill not found: ${parsed.name}. Available skills: ${availableSkills.join(", ")}`,
				};
			}

			return {
				ok: true,
				content: `Skill: ${skill.name}
Directory: ${skill.directory}

${skill.body}`,
			};
		},
	};
}
