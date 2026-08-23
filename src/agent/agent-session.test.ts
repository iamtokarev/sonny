import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatMessage, ToolCall } from "../domain";
import type { RuntimeEventPublisher, TurnContext } from "../events";
import type { HistoryRecorderSink } from "../history";
import { writeFileTool } from "../tools/builtin/write-file-tool";
import type { Tool } from "../tools/tool";
import { ToolExecutor } from "../tools/tool-executor";
import { ToolRegistry } from "../tools/tool-registry";
import { AgentSession } from "./agent-session";
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
	readonly replacements: ChatMessage[][] = [];

	constructor(private readonly error?: Error) {}

	flush(messages: ChatMessage[]): void {
		this.flushes.push([...messages]);

		if (this.error) {
			throw this.error;
		}
	}

	replaceMessages(messages: ChatMessage[]): void {
		this.replacements.push([...messages]);

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

const events: RuntimeEventPublisher = {
	async publish() {},
};

function createTurnContext(): TurnContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" },
		events,
	};
}

describe("AgentSession", () => {
	let state: SessionState;
	let llm: FakeLLM;
	let session: AgentSession;
	let turnContext: TurnContext;

	beforeEach(() => {
		state = new SessionState();
		llm = new FakeLLM();
		session = new AgentSession("You are Sonny.", state, llm);
		turnContext = createTurnContext();
	});

	test("sends system prompt and user message to the LLM", async () => {
		await session.chat("Hello", turnContext);

		expect(llm.calls).toEqual([
			[
				{ role: "system", content: "You are Sonny." },
				{ role: "user", content: "Hello" },
			],
		]);
	});

	test("returns the assistant response", async () => {
		const response = await session.chat("Hello", turnContext);

		expect(response).toBe("Hello back");
	});

	test("adds user and assistant messages to session state", async () => {
		await session.chat("Hello", turnContext);

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
		const execute = mock(toolExecutor.execute.bind(toolExecutor));
		toolExecutor.execute = execute;
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

		const response = await session.chat("Use a tool", turnContext);

		expect(response).toBe("Final answer");
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({ id: "call_test" }),
			turnContext,
		);
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
				status: "succeeded",
			},
		]);
	});

	test("stops at the next checkpoint once the turn is aborted", async () => {
		const abort = new AbortController();
		const llm = new FakeLLM(["Never asked"]);
		const session = new AgentSession("You are Sonny.", state, llm);

		abort.abort();

		await expect(
			session.chat("Hello", { ...createTurnContext(), signal: abort.signal }),
		).rejects.toThrow();
		expect(llm.calls).toHaveLength(0);
	});

	test("closes out tool calls a cancelled turn never ran", async () => {
		const abort = new AbortController();
		const tools = new ToolRegistry();
		tools.register(testTool);
		const toolExecutor = new ToolExecutor(tools, {});
		// Cancelling lands mid-turn: the model has already asked for tools.
		const llm = {
			async chat() {
				abort.abort();

				return {
					content: "",
					stopReason: "tool_calls" as const,
					toolCalls: [
						{ id: "call_one", name: "read_test", parameters: {} },
						{ id: "call_two", name: "read_test", parameters: {} },
					],
				};
			},
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			tools,
			toolExecutor,
		);

		await expect(
			session.chat("Use a tool", {
				...createTurnContext(),
				signal: abort.signal,
			}),
		).rejects.toThrow();

		// Every tool call the assistant made has a result, so the conversation is
		// still valid to send again.
		const messages = state.getMessages();
		const assistant = messages.find((message) => message.role === "assistant");
		const resultIds = messages
			.filter((message) => message.role === "tool")
			.map((message) => message.toolCallId);

		expect(assistant?.role === "assistant" ? assistant.toolCalls : []).toEqual([
			{ id: "call_one", name: "read_test", parameters: {} },
			{ id: "call_two", name: "read_test", parameters: {} },
		]);
		expect(resultIds).toEqual(["call_one", "call_two"]);
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

		await session.chat("Use a missing tool", turnContext);

		expect(llm.calls[1]?.at(-1)).toEqual({
			role: "tool",
			toolCallId: "call_missing",
			content: "Tool not found: missing_tool",
			status: "not_found",
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

		await session.chat("Write a file", turnContext);

		const toolMessage = llm.calls[1]?.at(-1);

		expect(toolMessage).toMatchObject({
			role: "tool",
			toolCallId: "call_write",
			status: "denied",
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

		await session.chat("No tool needed", turnContext);

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

		await session.chat("Hello", turnContext);

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

		await expect(session.chat("Hello", turnContext)).rejects.toThrow(
			"LLM failed",
		);

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

		const response = await session.chat("Hello", turnContext);

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

		await expect(session.chat("Hello", turnContext)).rejects.toThrow(
			"LLM failed",
		);
	});

	test("prepares context before LLM call and persists changed messages", async () => {
		state = new SessionState({
			initialMessages: [
				{
					role: "tool",
					toolCallId: "call-1",
					content: "large tool output",
				},
			],
		});
		const compactedMessages: ChatMessage[] = [
			{
				role: "tool",
				toolCallId: "call-1",
				content: "compact",
			},
			{ role: "user", content: "Next question" },
		];
		const historyRecorder = new FakeHistoryRecorder();
		const contextManager = {
			recordUsage: () => {},
			inspect: () => ({
				tokenCount: 100,
				contextWindowTokens: 200,
				thresholdTokens: 150,
				thresholdRatio: 0.75,
			}),
			prepare: async () => ({
				messages: compactedMessages,
				tokenCountBefore: 100,
				tokenCountAfter: 50,
				thresholdTokens: 75,
				changed: true,
				compactedToolResultCount: 1,
				summaryCompactedMessageCount: 0,
			}),
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
			contextManager,
		);

		await session.chat("Next question", turnContext);

		expect(historyRecorder.replacements).toEqual([compactedMessages]);
		expect(llm.calls[0]).toEqual([
			{ role: "system", content: "You are Sonny." },
			...compactedMessages,
		]);
		expect(state.getMessages()).toEqual([
			...compactedMessages,
			{ role: "assistant", content: "Hello back" },
		]);
	});

	test("continues the turn when automatic compaction fails", async () => {
		state = new SessionState();
		const historyRecorder = new FakeHistoryRecorder();
		const contextManager = {
			recordUsage: () => {},
			inspect: () => ({
				tokenCount: 100,
				contextWindowTokens: 200,
				thresholdTokens: 150,
				thresholdRatio: 0.75,
			}),
			prepare: async () => {
				throw new Error("summarizer unavailable");
			},
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
			contextManager,
		);

		const response = await session.chat("Hello", turnContext);

		expect(response).toBe("Hello back");
		expect(historyRecorder.replacements).toEqual([]);
		expect(state.getMessages()).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hello back" },
		]);
	});

	test("does not rewrite history when prepared context is unchanged", async () => {
		const historyRecorder = new FakeHistoryRecorder();
		const contextManager = {
			recordUsage: () => {},
			inspect: () => ({
				tokenCount: 10,
				contextWindowTokens: 200,
				thresholdTokens: 150,
				thresholdRatio: 0.75,
			}),
			prepare: async () => ({
				messages: state.getMessages(),
				tokenCountBefore: 10,
				tokenCountAfter: 10,
				thresholdTokens: 75,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			}),
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
			contextManager,
		);

		await session.chat("Hello", turnContext);

		expect(historyRecorder.replacements).toEqual([]);
		expect(llm.calls[0]).toEqual([
			{ role: "system", content: "You are Sonny." },
			{ role: "user", content: "Hello" },
		]);
	});

	test("gets context usage from current state and tool schemas", () => {
		state.addMessage({ role: "user", content: "Hello" });
		const tools = new ToolRegistry();
		tools.register(testTool);
		const inspectedRequests: unknown[] = [];
		const contextManager = {
			recordUsage: () => {},
			inspect: (request: unknown) => {
				inspectedRequests.push(request);
				return {
					tokenCount: 42,
					contextWindowTokens: 200,
					thresholdTokens: 150,
					thresholdRatio: 0.75,
				};
			},
			prepare: async () => ({
				messages: state.getMessages(),
				tokenCountBefore: 42,
				tokenCountAfter: 42,
				thresholdTokens: 150,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			}),
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			tools,
			undefined,
			undefined,
			contextManager,
		);

		expect(session.getContextUsage()).toEqual({
			tokenCount: 42,
			contextWindowTokens: 200,
			thresholdTokens: 150,
			thresholdRatio: 0.75,
		});
		expect(inspectedRequests).toEqual([
			{
				systemPrompt: "You are Sonny.",
				messages: [{ role: "user", content: "Hello" }],
				tools: tools.getSchemas(),
			},
		]);
	});

	test("compactContext forces compaction and persists changed messages", async () => {
		state.addMessage({ role: "user", content: "Hello" });
		const compactedMessages: ChatMessage[] = [
			{ role: "user", content: "summary" },
		];
		const historyRecorder = new FakeHistoryRecorder();
		const prepareCalls: unknown[] = [];
		const contextManager = {
			recordUsage: () => {},
			inspect: () => ({
				tokenCount: 100,
				contextWindowTokens: 200,
				thresholdTokens: 150,
				thresholdRatio: 0.75,
			}),
			prepare: async (request: unknown, options: unknown) => {
				prepareCalls.push({ request, options });
				return {
					messages: compactedMessages,
					tokenCountBefore: 100,
					tokenCountAfter: 20,
					thresholdTokens: 150,
					changed: true,
					compactedToolResultCount: 0,
					summaryCompactedMessageCount: 3,
				};
			},
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
			contextManager,
		);

		const result = await session.compactContext(createTurnContext());

		expect(result.summaryCompactedMessageCount).toBe(3);
		expect(state.getMessages()).toEqual(compactedMessages);
		expect(historyRecorder.replacements).toEqual([compactedMessages]);
		expect(prepareCalls).toMatchObject([
			{
				request: {
					systemPrompt: "You are Sonny.",
					messages: [{ role: "user", content: "Hello" }],
					tools: [],
				},
				// The turn context rides along so compaction can report itself.
				options: { forceSummary: true, turnContext: { turnId: "turn-1" } },
			},
		]);
	});

	test("compactContext does not let history failures hide compaction result", async () => {
		const compactedMessages: ChatMessage[] = [
			{ role: "user", content: "summary" },
		];
		const historyRecorder = new FakeHistoryRecorder(
			new Error("history failed"),
		);
		const contextManager = {
			recordUsage: () => {},
			inspect: () => ({
				tokenCount: 100,
				contextWindowTokens: 200,
				thresholdTokens: 150,
				thresholdRatio: 0.75,
			}),
			prepare: async () => ({
				messages: compactedMessages,
				tokenCountBefore: 100,
				tokenCountAfter: 20,
				thresholdTokens: 150,
				changed: true,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 3,
			}),
		};
		const session = new AgentSession(
			"You are Sonny.",
			state,
			llm,
			undefined,
			undefined,
			historyRecorder,
			contextManager,
		);

		const result = await session.compactContext(createTurnContext());

		expect(result.tokenCountAfter).toBe(20);
		expect(state.getMessages()).toEqual(compactedMessages);
	});
});
