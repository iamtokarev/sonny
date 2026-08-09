import type { SlashCommand } from "../commands/command";

export type CommandOption = {
	name: string;
	description: string;
};

/**
 * Driven by the registry, so a sixth command appears in the popup for free.
 */
export function toCommandOptions(commands: SlashCommand[]): CommandOption[] {
	return commands.map((command) => ({
		name: command.name,
		description: command.description,
	}));
}

export function filterCommands(
	options: CommandOption[],
	query: string,
): CommandOption[] {
	const term = query.replace(/^\//, "").toLowerCase();

	if (term.length === 0) {
		return options;
	}

	return options.filter((option) => option.name.toLowerCase().startsWith(term));
}

export function findClosestCommand(
	options: CommandOption[],
	query: string,
): CommandOption | null {
	const term = query.replace(/^\//, "").toLowerCase();

	if (term.length === 0) {
		return null;
	}

	// A single typo is the common case: match on shared prefix length.
	let best: { option: CommandOption; score: number } | null = null;

	for (const option of options) {
		const name = option.name.toLowerCase();
		let shared = 0;

		while (
			shared < term.length &&
			shared < name.length &&
			term[shared] === name[shared]
		) {
			shared += 1;
		}

		if (shared >= 2 && (best === null || shared > best.score)) {
			best = { option, score: shared };
		}
	}

	return best?.option ?? null;
}
