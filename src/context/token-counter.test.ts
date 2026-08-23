import { describe, expect, test } from "bun:test";
import type { ChatMessage, ToolSchema } from "../domain";
import { RoughTokenCounter, type TokenCountRequest } from "./token-counter";

const systemPrompt = "You are Sonny, a local agent.";
const messages: ChatMessage[] = [
	{ role: "user", content: "Read src/index.ts and summarize it." },
	{
		role: "assistant",
		content: "Reading the file now.",
		toolCalls: [
			{ id: "call-1", name: "readFile", parameters: { path: "src/index.ts" } },
		],
	},
	{
		role: "tool",
		toolCallId: "call-1",
		content: "export const value = 1;\n".repeat(40),
	},
	{ role: "assistant", content: "It exports a single constant." },
];

describe("RoughTokenCounter", () => {
	test("never estimates non-empty content as zero tokens", () => {
		const counter = new RoughTokenCounter();

		expect(
			counter.countRequestTokens({ systemPrompt: "hi", messages: [] }),
		).toBeGreaterThan(0);
	});

	test("counts an empty conversation as zero", () => {
		const counter = new RoughTokenCounter();

		expect(counter.countRequestTokens({ systemPrompt: "", messages: [] })).toBe(
			0,
		);
	});

	test("grows monotonically as messages are added", () => {
		const counter = new RoughTokenCounter();

		const short = counter.countRequestTokens({
			systemPrompt,
			messages: messages.slice(0, 2),
		});
		const full = counter.countRequestTokens({ systemPrompt, messages });

		expect(full).toBeGreaterThan(short);
	});

	test("is deterministic for the same request", () => {
		const counter = new RoughTokenCounter();
		const request: TokenCountRequest = { systemPrompt, messages };

		expect(counter.countRequestTokens(request)).toBe(
			counter.countRequestTokens(request),
		);
	});

	test("counts tool schemas", () => {
		const counter = new RoughTokenCounter();
		const tools: ToolSchema[] = [
			{
				name: "readFile",
				description: "Reads a file",
				parameters: { type: "object", properties: {} },
			},
		];

		const withoutTools = counter.countRequestTokens({
			systemPrompt,
			messages,
		});
		const withTools = counter.countRequestTokens({
			systemPrompt,
			messages,
			tools,
		});

		expect(withTools).toBeGreaterThan(withoutTools);
	});

	test("counts tool calls and tool call ids on assistant/tool messages", () => {
		const counter = new RoughTokenCounter();

		const withoutToolCalls = counter.countRequestTokens({
			systemPrompt,
			messages: [{ role: "assistant", content: "Reading the file now." }],
		});
		const withToolCalls = counter.countRequestTokens({
			systemPrompt,
			messages: messages.slice(0, 3),
		});

		expect(withToolCalls).toBeGreaterThan(withoutToolCalls);
	});

	test("counts raw arguments over serialized parameters when present", () => {
		const counter = new RoughTokenCounter();
		const withParameters = counter.countRequestTokens({
			systemPrompt,
			messages: [
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{ id: "call-1", name: "readFile", parameters: { path: "x" } },
					],
				},
			],
		});
		const withRawArguments = counter.countRequestTokens({
			systemPrompt,
			messages: [
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "call-1",
							name: "readFile",
							parameters: {},
							rawArguments: "{not-json".repeat(20),
						},
					],
				},
			],
		});

		expect(withRawArguments).not.toBe(withParameters);
	});
});
