import { describe, expect, test } from "bun:test";
import type { Tool } from "../tool";
import { ToolExecutor } from "../tool-executor";
import { ToolRegistry } from "../tool-registry";
import {
	createDefaultToolHooks,
	enrichFailureForModel,
	reduceLargeToolOutput,
} from "./default-tool-hooks";

describe("default tool hooks", () => {
	test("file policy denies blocked file paths before permission", async () => {
		let executed = false;
		let permissionCalled = false;
		const registry = new ToolRegistry();
		const readFileTool: Tool = {
			name: "readFile",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				executed = true;
				return { ok: true, content: "secret" };
			},
		};
		registry.register(readFileTool);

		const executor = new ToolExecutor(
			registry,
			createDefaultToolHooks(async () => {
				permissionCalled = true;
				return { approved: true };
			}),
		);

		const result = await executor.execute({
			id: "call_test",
			name: "readFile",
			parameters: {
				path: ".env",
			},
		});

		expect(executed).toBe(false);
		expect(permissionCalled).toBe(false);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("BLOCKED");
			expect(result.error).toContain(
				"Access denied: refusing to read environment files",
			);
		}
	});

	test("web URL policy denies non-public destinations before permission", async () => {
		let executed = false;
		let permissionCalled = false;
		const registry = new ToolRegistry();
		const webReadTool: Tool = {
			name: "webRead",
			description: "Read a web page",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				executed = true;
				return { ok: true, content: "private content" };
			},
		};
		registry.register(webReadTool);

		const executor = new ToolExecutor(
			registry,
			createDefaultToolHooks(async () => {
				permissionCalled = true;
				return { approved: true };
			}),
		);

		const result = await executor.execute({
			id: "call_test",
			name: "webRead",
			parameters: { url: "http://169.254.169.254/latest/meta-data" },
		});

		expect(executed).toBe(false);
		expect(permissionCalled).toBe(false);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("BLOCKED");
			expect(result.error).toContain(
				"Access denied: refusing web requests to local or non-public destinations",
			);
		}
	});

	test("enriches non-blocked failures for the model", async () => {
		const result = await enrichFailureForModel({
			toolCallId: "call_test",
			toolName: "readFile",
			description: "Read a file",
			parameters: {},
			durationMs: 1,
			result: {
				ok: false,
				error: "File not found",
				reason: "execution_failed",
			},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("File not found");
			expect(result.error).toContain("Tool failed");
			expect(result.error).toContain("Inspect current state");
		}
	});

	test("does not enrich blocked failures", async () => {
		const result = await enrichFailureForModel({
			toolCallId: "call_test",
			toolName: "bash",
			description: "Execute command",
			parameters: {},
			durationMs: 1,
			result: {
				ok: false,
				error: "BLOCKED: User denied this tool call.",
				reason: "denied",
			},
		});

		expect(result).toEqual({
			ok: false,
			error: "BLOCKED: User denied this tool call.",
			reason: "denied",
		});
	});

	test("truncates large success output", async () => {
		const largeOutput = "x".repeat(20_100);

		const result = await reduceLargeToolOutput({
			toolCallId: "call_test",
			toolName: "bash",
			description: "Execute command",
			parameters: {},
			durationMs: 1,
			result: {
				ok: true,
				content: largeOutput,
			},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.content.length).toBeLessThan(largeOutput.length);
			expect(result.content).toContain("Tool output truncated by Sonny");
			expect(result.content).toContain("20100 characters");
		}
	});
});
