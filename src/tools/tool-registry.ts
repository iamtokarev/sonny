import type { Tool } from "./tool";

export class ToolRegistry {
	constructor(private tools = new Map<string, Tool>()) {}

	register(tool: Tool): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Tool already registered: ${tool.name}`);
		}

		this.tools.set(tool.name, tool);
	}

	get(name: string): Tool {
		const tool = this.tools.get(name);

		if (tool === undefined) {
			throw new Error(`Tool not found: ${name}`);
		}

		return tool;
	}

	list(): Tool[] {
		return Array.from(this.tools.values());
	}

	getSchemas(): unknown[] {
		return Array.from(this.tools.values()).map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}
}
