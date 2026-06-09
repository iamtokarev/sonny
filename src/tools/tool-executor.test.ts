import { beforeEach, describe, expect, test } from "bun:test";
import type { Tool } from "./tool";
import { type ToolApprover, ToolExecutor } from "./tool-executor";
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

const createThrowingTool = (name = "throwing_tool"): Tool => ({
	name,
	description: "A tool that throws",
	parameters: {
		type: "object",
		properties: {},
	},
	execute: async () => {
		throw new Error("Something bad happened");
	},
});

describe("ToolExecutor", () => {
	let executor: ToolExecutor;
	let rejectedExecutor: ToolExecutor;
	let registry: ToolRegistry;
	let tool: Tool;
	let throwingTool: Tool;
	let approver: ToolApprover;
	let falseApprover: ToolApprover;

	beforeEach(() => {
		registry = new ToolRegistry();
		tool = createTestTool();
		throwingTool = createThrowingTool();
		approver = async () => ({ approved: true });
		falseApprover = async () => ({
			approved: false,
			reason: "Command can not be executed in this directory",
		});

		registry.register(tool);
		registry.register(throwingTool);

		executor = new ToolExecutor(registry, approver);
		rejectedExecutor = new ToolExecutor(registry, falseApprover);
	});

	test("executes an approved tool call", async () => {
		const result = await executor.execute({
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: true,
			content: "done",
		});
	});

	test("rejects denied approval", async () => {
		const result = await rejectedExecutor.execute({
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("denied");
			expect(result.error).toContain("BLOCKED");
			expect(result.error).toContain("User denied this tool call");
			expect(result.error).toContain("Do NOT retry");
			expect(result.error).toContain("do NOT rephrase");
			expect(result.error).toContain("different tool");
			expect(result.error).toContain(
				"Reason: Command can not be executed in this directory",
			);
		}
	});

	test("returns error for unknown tool", async () => {
		const result = await executor.execute({
			id: "call_test",
			name: "unknown_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: false,
			error: "Tool not found: unknown_tool",
			reason: "not_found",
		});
	});

	test("returns error when tool throws", async () => {
		const result = await executor.execute({
			id: "call_test",
			name: "throwing_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: false,
			error: "Tool execution failed: Something bad happened",
			reason: "execution_failed",
		});
	});
});
