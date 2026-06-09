import { readFileTool } from "./builtin/read-file-tool";
import { ToolRegistry } from "./tool-registry";

export function createDefaultToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();

	registry.register(readFileTool);

	return registry;
}
