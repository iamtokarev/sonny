import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolCall } from "../domain";
import {
	InMemoryRuntimeEventBus,
	type RuntimeEvent,
	type TurnContext,
} from "../events";
import type { ToolHooks } from "./hooks/tool-hooks";
import type { Tool, ToolResult } from "./tool";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";

const createTestTool = (
	name = "test_tool",
	execute: Tool["execute"] = async () => ({ ok: true, content: "done" }),
): Tool => ({
	name,
	description: "A test tool",
	parameters: {
		type: "object",
		properties: {},
	},
	execute,
});

const createThrowingTool = (name = "throwing_tool"): Tool =>
	createTestTool(name, async () => {
		throw new Error("Something bad happened");
	});

const createFailingTool = (name = "failing_tool"): Tool =>
	createTestTool(name, async () => ({ ok: false, error: "tool failed" }));

describe("ToolExecutor", () => {
	let registry: ToolRegistry;
	let tool: Tool;
	let throwingTool: Tool;
	let allowHooks: ToolHooks;
	let askHooks: ToolHooks;
	let denyPermissionHooks: ToolHooks;
	let eventBus: InMemoryRuntimeEventBus;
	let turnContext: TurnContext;

	function executeTool(
		executor: ToolExecutor,
		call: ToolCall,
	): Promise<ToolResult> {
		return executor.execute(call, turnContext);
	}

	beforeEach(() => {
		registry = new ToolRegistry();
		tool = createTestTool();
		throwingTool = createThrowingTool();

		registry.register(tool);
		registry.register(throwingTool);
		eventBus = new InMemoryRuntimeEventBus();
		turnContext = {
			sessionId: "session-1",
			turnId: "turn-1",
			source: { kind: "cli" },
			events: eventBus,
		};

		allowHooks = {
			preTool: [() => ({ action: "allow" })],
		};
		askHooks = {
			preTool: [() => ({ action: "ask" })],
			permission: async () => ({ approved: true }),
		};
		denyPermissionHooks = {
			preTool: [() => ({ action: "ask" })],
			permission: async () => ({
				approved: false,
				reason: "Command can not be executed in this directory",
			}),
		};
	});

	test("preTool allow executes without permission", async () => {
		let permissionCalled = false;
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "allow" })],
			permission: async () => {
				permissionCalled = true;
				return { approved: true };
			},
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: true,
			content: "done",
		});
		expect(permissionCalled).toBe(false);
	});

	test("preTool ask calls permission hook", async () => {
		const permissionRequests: unknown[] = [];
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "ask", reason: "needs user approval" })],
			permission: async (request) => {
				permissionRequests.push(request);
				return { approved: true };
			},
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result.ok).toBe(true);
		expect(permissionRequests).toHaveLength(1);
		expect(permissionRequests[0]).toMatchObject({
			toolCallId: "call_test",
			toolName: "test_tool",
			reason: "needs user approval",
		});
	});

	test("preTool deny skips execution and returns BLOCKED", async () => {
		let executed = false;
		registry = new ToolRegistry();
		registry.register(
			createTestTool("test_tool", async () => {
				executed = true;
				return { ok: true, content: "done" };
			}),
		);
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "deny", reason: "outside policy" })],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(executed).toBe(false);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("denied");
			expect(result.error).toContain("BLOCKED");
			expect(result.error).toContain("Blocked by policy: outside policy");
		}
	});

	test("permission deny runs denied hook and returns BLOCKED", async () => {
		const denied: unknown[] = [];
		const executor = new ToolExecutor(registry, {
			...denyPermissionHooks,
			permissionDenied: [
				(context) => {
					denied.push(context);
				},
			],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("denied");
			expect(result.error).toContain("BLOCKED");
			expect(result.error).toContain("User denied this tool call");
			expect(result.error).toContain(
				"Command can not be executed in this directory",
			);
		}
		expect(denied).toHaveLength(1);
		expect(denied[0]).toMatchObject({
			toolCallId: "call_test",
			toolName: "test_tool",
		});
	});

	test("returns error for unknown tool before hooks run", async () => {
		let hookCalled = false;
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const executor = new ToolExecutor(registry, {
			preTool: [
				() => {
					hookCalled = true;
					return { action: "allow" };
				},
			],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "unknown_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: false,
			error: "Tool not found: unknown_tool",
			reason: "not_found",
		});
		expect(hookCalled).toBe(false);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "tool.completed",
			toolCallId: "call_test",
			toolName: "unknown_tool",
			status: "not_found",
			content: "Tool not found: unknown_tool",
		});
	});

	test("returns transformed error when tool throws", async () => {
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const executor = new ToolExecutor(registry, allowHooks);

		const result = await executeTool(executor, {
			id: "call_test",
			name: "throwing_tool",
			parameters: {},
		});

		expect(result).toEqual({
			ok: false,
			error: "Tool execution failed: Something bad happened",
			reason: "execution_failed",
		});
		expect(events.at(-1)).toMatchObject({
			type: "tool.completed",
			toolCallId: "call_test",
			toolName: "throwing_tool",
			status: "failed",
			content: "Tool execution failed: Something bad happened",
		});
	});

	test("preTool updateInput executes with updated parameters", async () => {
		let executedWith: unknown;
		registry = new ToolRegistry();
		registry.register(
			createTestTool("test_tool", async (parameters) => {
				executedWith = parameters;
				return { ok: true, content: "done" };
			}),
		);
		const executor = new ToolExecutor(registry, {
			preTool: [
				() => ({
					action: "updateInput",
					parameters: { path: "updated.txt" },
					reason: "normalize path",
				}),
			],
		});

		await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: { path: "original.txt" },
		});

		expect(executedWith).toEqual({ path: "updated.txt" });
	});

	test("multiple pre hooks run in order with updated parameters", async () => {
		const seen: unknown[] = [];
		let executedWith: unknown;
		registry = new ToolRegistry();
		registry.register(
			createTestTool("test_tool", async (parameters) => {
				executedWith = parameters;
				return { ok: true, content: "done" };
			}),
		);
		const executor = new ToolExecutor(registry, {
			preTool: [
				(context) => {
					seen.push(context.parameters);
					return {
						action: "updateInput",
						parameters: { path: "updated.txt" },
					};
				},
				(context) => {
					seen.push(context.parameters);
					return { action: "allow" };
				},
			],
		});

		await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: { path: "original.txt" },
		});

		expect(seen).toEqual([{ path: "original.txt" }, { path: "updated.txt" }]);
		expect(executedWith).toEqual({ path: "updated.txt" });
	});

	test("emits started and completed events with final parameters", async () => {
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const executor = new ToolExecutor(registry, {
			preTool: [
				() => ({
					action: "updateInput",
					parameters: { path: "notes.txt" },
				}),
				() => ({ action: "ask" }),
			],
			permission: async () => ({ approved: true }),
		});

		await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {
				path: "original.txt",
			},
		});

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "tool.started",
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call_test",
			toolName: "test_tool",
			parameters: {
				path: "notes.txt",
			},
			preview: "notes.txt",
		});
		expect(events[1]).toMatchObject({
			type: "tool.completed",
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call_test",
			toolName: "test_tool",
			parameters: {
				path: "notes.txt",
			},
			status: "succeeded",
			content: "done",
		});
	});

	test("emits completed event for denied tools", async () => {
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const executor = new ToolExecutor(registry, denyPermissionHooks);

		await executeTool(executor, {
			id: "call_denied",
			name: "test_tool",
			parameters: {},
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "tool.completed",
			toolCallId: "call_denied",
			toolName: "test_tool",
			status: "denied",
		});
		expect(
			events[0]?.type === "tool.completed" ? events[0].content : "",
		).toContain("BLOCKED");
	});

	test("postTool receives raw result before transform", async () => {
		const observed: unknown[] = [];
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "allow" })],
			postTool: [
				(context) => {
					observed.push(context.result);
				},
			],
			transformToolResult: [
				() => ({
					ok: true,
					content: "transformed",
				}),
			],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(observed).toEqual([{ ok: true, content: "done" }]);
		expect(result).toEqual({ ok: true, content: "transformed" });
	});

	test("failed tool runs failure hook", async () => {
		const failures: unknown[] = [];
		registry.register(createFailingTool());
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "allow" })],
			toolFailure: [
				(context) => {
					failures.push(context.result);
				},
			],
		});

		await executeTool(executor, {
			id: "call_fail",
			name: "failing_tool",
			parameters: {},
		});

		expect(failures).toEqual([{ ok: false, error: "tool failed" }]);
	});

	test("transformToolResult can enrich failure for the model", async () => {
		registry.register(createFailingTool());
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "allow" })],
			transformToolResult: [
				({ result }) =>
					result.ok
						? result
						: {
								...result,
								error: `${result.error}\n\nRecovery guidance.`,
							},
			],
		});

		const result = await executeTool(executor, {
			id: "call_fail",
			name: "failing_tool",
			parameters: {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("tool failed");
			expect(result.error).toContain("Recovery guidance.");
		}
	});

	test("tool.completed uses transformed result", async () => {
		const events: RuntimeEvent[] = [];
		eventBus.subscribe((event) => {
			events.push(event);
		});
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "allow" })],
			transformToolResult: [
				() => ({
					ok: true,
					content: "transformed",
				}),
			],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result).toEqual({ ok: true, content: "transformed" });
		expect(events[1]).toMatchObject({
			type: "tool.completed",
			content: "transformed",
		});
	});

	test("preTool ask without permission hook denies safely", async () => {
		const executor = new ToolExecutor(registry, {
			preTool: [() => ({ action: "ask" })],
		});

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("denied");
			expect(result.error).toContain("no permission hook was configured");
		}
	});

	test("preTool ask executes after permission approval", async () => {
		const executor = new ToolExecutor(registry, askHooks);

		const result = await executeTool(executor, {
			id: "call_test",
			name: "test_tool",
			parameters: {},
		});

		expect(result).toEqual({ ok: true, content: "done" });
	});
});
