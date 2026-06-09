import { beforeEach, describe, expect, test } from "bun:test";
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
		registry.register(createTestTool("read_file"));

		expect(() => registry.register(createTestTool("read_file"))).toThrow(
			"Tool already registered: read_file",
		);
	});

	test("returns OpenAI-compatible tool schemas", () => {
		const tool = createTestTool("read_file");
		registry.register(tool);

		expect(registry.getSchemas()).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
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
