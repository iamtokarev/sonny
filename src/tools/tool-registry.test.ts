import { beforeEach, describe, expect, test } from "bun:test";
import { createDefaultToolRegistry } from "./create-tool-registry";
import type { Tool } from "./tool";
import { ToolRegistry } from "./tool-registry";

const createTestTool = (name = "test_tool"): Tool => ({
	name,
	description: "A test tool",
	parameters: {
		type: "object",
		properties: {},
	},
	execute: async () => ({ ok: true, content: "done" }),
});

describe("ToolRegistry", () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry();
	});

	test("starts empty", () => {
		expect(registry.list()).toEqual([]);
	});

	test("registers and retrieves a tool", () => {
		const tool = createTestTool();
		registry.register(tool);

		expect(registry.get("test_tool")).toBe(tool);
	});

	test("rejects duplicate tool names", () => {
		registry.register(createTestTool("readFile"));

		expect(() => registry.register(createTestTool("readFile"))).toThrow(
			"Tool already registered: readFile",
		);
	});

	test("returns OpenAI-compatible tool schemas", () => {
		const tool = createTestTool("readFile");
		registry.register(tool);

		expect(registry.getSchemas()).toEqual([
			{
				type: "function",
				function: {
					name: "readFile",
					description: "A test tool",
					parameters: {
						type: "object",
						properties: {},
					},
				},
			},
		]);
	});
});

describe("createDefaultToolRegistry", () => {
	test("registers built-in tools", () => {
		const registry = createDefaultToolRegistry();

		expect(registry.list().map((tool) => tool.name)).toEqual([
			"readFile",
			"writeFile",
			"editFile",
			"bash",
		]);
	});

	test("registers loadSkill when skills are provided", () => {
		const registry = createDefaultToolRegistry({
			skills: [
				{
					name: "code-review",
					description: "Review code",
					body: "Instructions",
					path: "/tmp/skills/code-review/SKILL.md",
					directory: "/tmp/skills/code-review",
				},
			],
		});

		expect(registry.list().map((tool) => tool.name)).toEqual([
			"readFile",
			"writeFile",
			"editFile",
			"bash",
			"loadSkill",
		]);
	});
});
