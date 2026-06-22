import type { Skill } from "./skill";

const SKILLS_INSTRUCTIONS =
	"Use skills as specialized task guidance. If a skill is relevant to the task, load it before acting on the task.";

export function buildSkillsPrompt(skills: Skill[]): string {
	if (skills.length === 0) {
		return "";
	}

	const skillsByName = new Map<string, Skill>();
	for (const skill of skills) {
		if (!skillsByName.has(skill.name)) {
			skillsByName.set(skill.name, skill);
		}
	}

	const uniqueSkills = [...skillsByName.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const skillsText = uniqueSkills
		.map((skill) => `- ${skill.name}: ${skill.description}`)
		.join("\n");

	return `## Skills

${SKILLS_INSTRUCTIONS}

Available skills:
${skillsText}`;
}
