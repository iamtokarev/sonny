import type { Skill } from "../skills/skill";
import type { WebReadProvider, WebSearchProvider } from "../web";
import { bashTool } from "./builtin/bash-tool";
import { editFileTool } from "./builtin/edit-file-tool";
import { createLoadSkillTool } from "./builtin/load-skill-tool";
import { readFileTool } from "./builtin/read-file-tool";
import { createWebReadTool } from "./builtin/web-read-tool";
import { createWebSearchTool } from "./builtin/web-search-tool";
import { writeFileTool } from "./builtin/write-file-tool";
import { ToolRegistry } from "./tool-registry";

type CreateDefaultToolRegistryOptions = {
	skills?: Skill[];
	webSearchProvider?: WebSearchProvider;
	webReadProvider?: WebReadProvider;
};

export function createDefaultToolRegistry(
	options: CreateDefaultToolRegistryOptions = {},
): ToolRegistry {
	const registry = new ToolRegistry();

	registry.register(readFileTool);
	registry.register(writeFileTool);
	registry.register(editFileTool);
	registry.register(bashTool);

	if (options.skills && options.skills.length > 0) {
		registry.register(createLoadSkillTool(options.skills));
	}

	if (options.webSearchProvider) {
		registry.register(createWebSearchTool(options.webSearchProvider));
	}

	if (options.webReadProvider) {
		registry.register(createWebReadTool(options.webReadProvider));
	}

	return registry;
}
