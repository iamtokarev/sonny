import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileTool } from "../tools/builtin/write-file-tool";
import type { Tool } from "../tools/tool";
import { ToolExecutor } from "../tools/tool-executor";
import { ToolRegistry } from "../tools/tool-registry";
import { AgentSession } from "./agent-session";
import type { HistoryRecorderSink } from "./history-recorder";
import type { ChatMessage, ToolCall } from "./message";
import { SessionState } from "./session-state";

type FakeLLMResult = {
	content: string;
	toolCalls: ToolCall[];
	stopReason: "stop" | "tool_calls" | "length" | "content_filter";
};

class FakeLLM {
	readonly calls: ChatMessage[][] = [];
	readonly toolSchemas: unknown[][] = [];
	private readonly responses: Array<string | FakeLLMResult>;

	constructor(responses: Array<string | FakeLLMResult> = ["Hello back"]) {
		this.responses = responses;
	}

	async chat(
		messages: ChatMessage[],
		tools: unknown[] = [],
	): Promise<string | FakeLLMResult> {
		this.calls.push(messages);
		this.toolSchemas.push(tools);
		return this.responses.shift() ?? "Hello back";
	}
}

class ThrowingLLM {
	async chat(): Promise<string> {
		throw new Error("LLM failed");
	}
}

class FakeHistoryRecorder implements HistoryRecorderSink {
	readonly flushes: ChatMessage[][] = [];

	constructor(private readonly error?: Error) {}

	flush(messages: ChatMessage[]): void {
		this.flushes.push([...messages]);

		if (this.error) {
			throw this.error;
		}
	}
}

const testTool: Tool = {
	name: "read_test",
	description: "Read test data",
	parameters: {
		type: "object",
		properties: {},
	},
	execute: async () => ({ ok: true, content: "tool output" }),
};

describe("AgentSession", () => {
	let state: SessionState;
	let llm: FakeLLM;
	let session: AgentSession;

	beforeEach(() => {
		state = new SessionState();
		llm = new FakeLLM();
		session = new AgentSession("You are Sonny.", state, llm);
	});

	test("sends system prompt and user message to the LLM", async () => {
		await session.chat("Hello");

		expect(llm.calls).toEqual([
			[
				{ role: "system", content: "You are Sonny." },
				{ role: "user", content: "Hello" },
			],
		]);
	});

	test("returns the assistant response", async () => {
		const response = await session.chat("Hello");

		expect(response).toBe("Hello back");
	});

	test("adds user and assistant messages to session state", async () => {
		await session.chat("Hello");

		expect(state.buildMessages("You are Sonny.")).toEqual([
			{ role: "system", content: "You are Sonny." },
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hello back" },
		]);
	});

	test("executes tool calls and continues until final answer", async () => {
		const tools = new ToolRegistry();
		tools.register(testTool);

		const toolExecutor = new ToolExecutor(tools, {
			preTool: [() => ({ action: "ask" })],
			permission: async () => ({ approved: true }),
		});
		const llm = new FakeLLM([
			{
				content: "",
				stopReason: "tool_calls",
				toolCalls: [
					{
						id: "call_test",
						name: "read_test",
						parameters: {},
					},
				],
			},
			{
				content: "Final answer",
				stopReason: "stop",
				toolCalls: [],
			},
		]);
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			tools,
			toolExecutor,
		);

		const response = await session.chat("Use a tool");

		expect(response).toBe("Final answer");
		expect(llm.calls).toHaveLength(2);
		expect(llm.toolSchemas[0]).toEqual(tools.getSchemas());
		expect(llm.calls[1]).toEqual([
			{ role: "system", content: "You are Sonny." },
			{ role: "user", content: "Use a tool" },
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "call_test",
						name: "read_test",
						parameters: {},
					},
				],
			},
			{
				role: "tool",
				toolCallId: "call_test",
				content: "tool output",
			},
		]);
	});

	test("adds failed tool results to the conversation", async () => {
		const tools = new ToolRegistry();
		const toolExecutor = new ToolExecutor(tools, {
			preTool: [() => ({ action: "ask" })],
			permission: async () => ({ approved: true }),
		});
		const llm = new FakeLLM([
			{
				content: "",
				stopReason: "tool_calls",
				toolCalls: [
					{
						id: "call_missing",
						name: "missing_tool",
						parameters: {},
					},
				],
			},
			{
				content: "I could not use that tool",
				stopReason: "stop",
				toolCalls: [],
			},
		]);
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			tools,
			toolExecutor,
		);

		await session.chat("Use a missing tool");

		expect(llm.calls[1]?.at(-1)).toEqual({
			role: "tool",
			toolCallId: "call_missing",
			content: "Tool not found: missing_tool",
		});
	});

	test("feeds denied built-in tool approvals back to the LLM", async () => {
		const tools = new ToolRegistry();
		tools.register(writeFileTool);

		const toolExecutor = new ToolExecutor(tools, {
			preTool: [() => ({ action: "ask" })],
			permission: async () => ({
				approved: false,
				reason: "User declined writeFile.",
			}),
		});
		const llm = new FakeLLM([
			{
				content: "",
				stopReason: "tool_calls",
				toolCalls: [
					{
						id: "call_write",
						name: "writeFile",
						parameters: {
							path: "notes.txt",
							content: "hello",
						},
					},
				],
			},
			{
				content: "I will not write that file.",
				stopReason: "stop",
				toolCalls: [],
			},
		]);
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			tools,
			toolExecutor,
		);

		await session.chat("Write a file");

		const toolMessage = llm.calls[1]?.at(-1);

		expect(toolMessage).toMatchObject({
			role: "tool",
			toolCallId: "call_write",
		});
		expect(toolMessage?.content).toContain("BLOCKED");
		expect(toolMessage?.content).toContain("Do NOT retry");
		expect(toolMessage?.content).toContain("User declined writeFile.");
	});

	test("does not store empty tool calls on final assistant messages", async () => {
		const llm = new FakeLLM([
			{
				content: "Plain answer",
				stopReason: "stop",
				toolCalls: [],
			},
		]);
		const session = new AgentSession("You are Sonny.", state, llm);

		await session.chat("No tool needed");

		expect(state.buildMessages("You are Sonny.")).toEqual([
			{ role: "system", content: "You are Sonny." },
			{ role: "user", content: "No tool needed" },
			{ role: "assistant", content: "Plain answer" },
		]);
	});

	test("flushes history after successful chat", async () => {
		const historyRecorder = new FakeHistoryRecorder();
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
		);

		await session.chat("Hello");

		expect(historyRecorder.flushes).toEqual([
			[
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hello back" },
			],
		]);
	});

	test("flushes user message after LLM error", async () => {
		const historyRecorder = new FakeHistoryRecorder();
		const session = new AgentSession(
			"You are Sonny.",
			state,
			new ThrowingLLM(),
			undefined,
			undefined,
			historyRecorder,
		);

		await expect(session.chat("Hello")).rejects.toThrow("LLM failed");

		expect(historyRecorder.flushes).toEqual([
			[{ role: "user", content: "Hello" }],
		]);
	});

	test("does not let history failures replace successful chat response", async () => {
		const historyRecorder = new FakeHistoryRecorder(
			new Error("history failed"),
		);
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
		);

		const response = await session.chat("Hello");

		expect(response).toBe("Hello back");
	});

	test("does not let history failures mask original chat error", async () => {
		const historyRecorder = new FakeHistoryRecorder(
			new Error("history failed"),
		);
		const session = new AgentSession(
			"You are Sonny.",
			state,
			new ThrowingLLM(),
			undefined,
			undefined,
			historyRecorder,
		);

		await expect(session.chat("Hello")).rejects.toThrow("LLM failed");
	});
});
