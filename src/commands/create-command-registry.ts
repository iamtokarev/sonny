import { createCompactCommand } from "./builtin/compact-command";
import { createContextCommand } from "./builtin/context-command";
import { createHelpCommand } from "./builtin/help-command";
import { createNewSessionCommand } from "./builtin/new-session-command";
import { createReloadCommand } from "./builtin/reload-command";
import { createSessionCommand } from "./builtin/session-command";
import { createSkillsCommand } from "./builtin/skills-command";
import { CommandRegistry } from "./command-registry";

export function createDefaultCommandRegistry(): CommandRegistry {
	return createCommandRegistry(false);
}

export function createChannelCommandRegistry(): CommandRegistry {
	return createCommandRegistry(true);
}

function createCommandRegistry(
	includeChannelCommands: boolean,
): CommandRegistry {
	const registry = new CommandRegistry();

	registry.register(createHelpCommand(() => registry.list()));
	registry.register(createContextCommand());
	registry.register(createCompactCommand());
	registry.register(createReloadCommand());
	registry.register(createSkillsCommand());
	registry.register(createSessionCommand());
	if (includeChannelCommands) {
		registry.register(createNewSessionCommand());
	}

	return registry;
}
