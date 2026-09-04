import { describe, expect, mock, test } from "bun:test";
import type { RuntimeEvent } from "../events";
import { InMemoryRuntimeEventBus } from "../events";
import type {
	AgentTurnInput,
	AgentTurnResult,
	CreateAgentSessionResult,
} from "../runtime";
import type {
	ToolApprovalDecision,
	ToolApprover,
} from "../tools/tool-executor";
import {
	createInkHarness,
	enter,
	flush,
	type InkHarness,
	type InkHarnessOptions,
} from "../ui/test-support/ink-harness";
import { ChatApp } from "./chat-loop";

type RunTurn = (input: AgentTurnInput) => Promise<AgentTurnResult>;
type ReloadConfiguration =
	CreateAgentSessionResult["runtime"]["reloadConfiguration"];

class TrackingEventBus extends InMemoryRuntimeEventBus {
	unsubscribeCount = 0;

	override subscribe(
		handler: Parameters<InMemoryRuntimeEventBus["subscribe"]>[0],
	): () => void {
		const unsubscribe = super.subscribe(handler);

		return () => {
			this.unsubscribeCount += 1;
			unsubscribe();
		};
	}
}

function createSessionResult(
	runTurn: RunTurn,
	reloadConfiguration: ReloadConfiguration = async () => ({
		status: "unchanged",
		revision: 1,
		info: { model: "openai/model-a", toolNames: [] },
	}),
): CreateAgentSessionResult {
	return {
		runtime: {
			runTurn,
			getMessageCount: () => 0,
			getContextUsage: () => ({
				tokenCount: 0,
				contextWindowTokens: 200_000,
				thresholdTokens: 150_000,
				thresholdRatio: 0.75,
			}),
			compactContext: async () => ({
				messages: [],
				tokenCountBefore: 0,
				tokenCountAfter: 0,
				thresholdTokens: 150_000,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			}),
			reloadConfiguration,
		} as unknown as CreateAgentSessionResult["runtime"],
		historySession: {
			id: "session-1",
			agentId: "sonny",
			title: "Untitled session",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "System prompt",
		},
		restoredMessageCount: 0,
		restoredMessages: [],
		skills: [],
		mode: "new",
		toolNames: ["bash", "readFile"],
		model: "gpt-5.4-mini",
	};
}

function createToolEvent(
	type: "tool.started" | "tool.completed",
	overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
	const base = {
		eventId: `event-${type}`,
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" as const },
		occurredAt: "2026-01-01T00:00:00.000Z",
		toolCallId: "tool-call-1",
		toolName: "bash",
		parameters: { command: "bun test" },
	};

	if (type === "tool.started") {
		return {
			...base,
			type,
			preview: "bun test",
			...overrides,
		} as RuntimeEvent;
	}

	return {
		...base,
		type,
		status: "succeeded",
		content: JSON.stringify({
			stdout: "Tests passed",
			stderr: "",
			exitCode: 0,
		}),
		durationMs: 12,
		...overrides,
	} as RuntimeEvent;
}

function createChatHarness(
	eventBus: InMemoryRuntimeEventBus,
	runTurn: RunTurn,
	reloadConfiguration?: ReloadConfiguration,
	options: InkHarnessOptions = {},
): InkHarness {
	return createInkHarness(
		<ChatApp
			eventBus={eventBus}
			createSession={async () =>
				createSessionResult(runTurn, reloadConfiguration)
			}
		/>,
		options,
	);
}

describe("ChatApp runtime integration", () => {
	test("renders active and completed tool events and ignores another session", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		let resolveTurn: ((result: AgentTurnResult) => void) | undefined;
		const runTurn = mock(
			() =>
				new Promise<AgentTurnResult>((resolve) => {
					resolveTurn = resolve;
				}),
		);
		const harness = createChatHarness(eventBus, runTurn);

		try {
			await flush(harness);
			await enter(harness, "run tests");
			await eventBus.publish(createToolEvent("tool.started"));
			await flush(harness);

			// The row grammar pads the tool name into a fixed column.
			expect(harness.output()).toContain("bash       bun test");

			await eventBus.publish(createToolEvent("tool.completed"));
			await eventBus.publish(
				createToolEvent("tool.completed", {
					sessionId: "another-session",
					content: "FOREIGN_EVENT_CONTENT",
				}),
			);
			await flush(harness);

			expect(harness.output()).toContain(
				"bash       bun test  12ms  Tests passed",
			);
			expect(harness.output()).not.toContain("FOREIGN_EVENT_CONTENT");

			resolveTurn?.({ turnId: "turn-1", content: "Done" });
			await flush(harness);
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});

	test("unsubscribes from runtime events when unmounted", async () => {
		const eventBus = new TrackingEventBus();
		const harness = createChatHarness(eventBus, async () => ({
			turnId: "turn-1",
			content: "Done",
		}));

		await flush(harness);
		harness.app.unmount();
		await harness.app.waitUntilExit();

		expect(eventBus.unsubscribeCount).toBe(1);
	});

	test("routes normal input through AgentRuntime and renders its result", async () => {
		const inputs: AgentTurnInput[] = [];
		const runTurn = mock(async (input: AgentTurnInput) => {
			inputs.push(input);

			return { turnId: "turn-1", content: "Runtime response" };
		});
		const harness = createChatHarness(new InMemoryRuntimeEventBus(), runTurn);

		try {
			await flush(harness);
			await enter(harness, "hello runtime");
			await flush(harness);

			expect(runTurn).toHaveBeenCalledTimes(1);
			expect(inputs[0]).toMatchObject({
				content: "hello runtime",
				source: { kind: "cli" },
			});
			// Every turn is cancellable, so it carries a signal to cancel it with.
			expect(inputs[0]?.signal).toBeInstanceOf(AbortSignal);
			expect(harness.output()).toContain("Runtime response");
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});

	test("approves, denies, and cancels pending approvals from the CLI", async () => {
		const scenarios = [
			{
				key: "y",
				expected: { approved: true },
				aborted: false,
			},
			{
				key: "n",
				expected: {
					approved: false,
					reason: "Tool call denied by user.",
				},
				aborted: false,
			},
			{
				key: "\u001b",
				expected: {
					approved: false,
					reason: "Turn cancelled by user.",
				},
				aborted: true,
			},
		] as const;

		for (const scenario of scenarios) {
			let approveToolCall: ToolApprover | undefined;
			let decision: ToolApprovalDecision | undefined;
			let turnSignal: AbortSignal | undefined;
			let markApprovalRequested: (() => void) | undefined;
			const approvalRequested = new Promise<void>((resolve) => {
				markApprovalRequested = resolve;
			});
			const runTurn: RunTurn = async (input) => {
				turnSignal = input.signal;
				if (approveToolCall === undefined) {
					throw new Error("Tool approver was not initialized.");
				}

				const pendingDecision = approveToolCall({
					toolCallId: "call-1",
					toolName: "bash",
					description: "run a shell command",
					parameters: { command: "bun test" },
					turn: {
						sessionId: "session-1",
						turnId: "turn-1",
						source: input.source,
						signal: input.signal,
					},
				});
				markApprovalRequested?.();
				decision = await pendingDecision;

				return { turnId: "turn-1", content: "Done" };
			};
			const eventBus = new InMemoryRuntimeEventBus();
			const harness = createInkHarness(
				<ChatApp
					eventBus={eventBus}
					createSession={async (approver) => {
						approveToolCall = approver;
						return createSessionResult(runTurn);
					}}
				/>,
			);

			try {
				await flush(harness);
				await enter(harness, "use a tool");
				await approvalRequested;
				await flush(harness);
				expect(harness.output()).toContain("$ bun test");

				harness.stdin.write(scenario.key);
				// Ink briefly buffers escape to distinguish it from an alt-key chord.
				if (scenario.key === "\u001b") {
					await Bun.sleep(30);
				}
				await flush(harness);

				expect(decision).toEqual(scenario.expected);
				expect(turnSignal?.aborted).toBe(scenario.aborted);
			} finally {
				harness.app.unmount();
				await harness.app.waitUntilExit();
			}
		}
	});

	test("handles slash commands without starting a runtime turn", async () => {
		const runTurn = mock(async () => ({
			turnId: "turn-1",
			content: "Unexpected response",
		}));
		const harness = createChatHarness(new InMemoryRuntimeEventBus(), runTurn);

		try {
			await flush(harness);
			await enter(harness, "/help");

			expect(runTurn).not.toHaveBeenCalled();
			expect(harness.output()).toContain("/help");
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});

	test("forces manual reload and renders its event only once", async () => {
		const eventBus = new InMemoryRuntimeEventBus();
		const reload = mock<ReloadConfiguration>(async (options) => {
			eventBus.publish({
				eventId: "config-poll-event-1",
				sessionId: "session-1",
				turnId: "poll-turn-1",
				source: { kind: "system", name: "config-poll" },
				occurredAt: "2026-01-01T00:00:00.000Z",
				type: "config.reloaded",
				revision: 2,
				changedSections: ["llm"],
				runtimeRebuilt: true,
				model: "openai/poll-model",
				toolNames: ["bash"],
			});
			eventBus.publish({
				eventId: "config-event-1",
				sessionId: "session-1",
				turnId: "reload-turn-1",
				source: { kind: "cli" },
				occurredAt: "2026-01-01T00:00:00.000Z",
				type: "config.reloaded",
				revision: 2,
				changedSections: ["llm"],
				runtimeRebuilt: true,
				model: "anthropic/model-b",
				toolNames: ["bash"],
			});

			expect(options).toEqual({
				force: true,
				source: { kind: "cli" },
			});

			return {
				status: "reloaded",
				revision: 2,
				changedSections: ["llm"],
				runtimeRebuilt: true,
				info: { model: "anthropic/model-b", toolNames: ["bash"] },
			};
		});
		const runTurn = mock(async () => ({
			turnId: "turn-1",
			content: "Unexpected response",
		}));
		const harness = createChatHarness(eventBus, runTurn, reload);

		try {
			await flush(harness);
			await enter(harness, "/reload");
			await flush(harness);

			expect(reload).toHaveBeenCalledTimes(1);
			expect(runTurn).not.toHaveBeenCalled();
			expect(harness.output()).toContain("Runtime: openai/poll-model");
			expect(harness.output()).toContain("Runtime: anthropic/model-b");
			expect(harness.output()).not.toContain(
				"Configuration reloaded to revision 2.",
			);
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});

	test("renders off a TTY instead of crashing on raw mode", async () => {
		const runTurn = mock(async () => ({
			turnId: "turn-1",
			content: "Unexpected response",
		}));
		// Piped stdin cannot be put into raw mode. Ink throws rather than
		// degrading, so the app has to decline to listen for keys at all.
		const harness = createChatHarness(
			new InMemoryRuntimeEventBus(),
			runTurn,
			undefined,
			{ isTTY: false },
		);

		try {
			await flush(harness);

			expect(harness.output()).toContain("Sonny");
			expect(harness.output()).toContain("Ask Sonny");
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});

	test("renders runtime failures", async () => {
		const runTurn = mock(async () => {
			throw new Error("Runtime failed");
		});
		const harness = createChatHarness(new InMemoryRuntimeEventBus(), runTurn);

		try {
			await flush(harness);
			await enter(harness, "fail");
			await flush(harness);

			expect(runTurn).toHaveBeenCalledTimes(1);
			expect(harness.output()).toContain("Runtime failed");
		} finally {
			harness.app.unmount();
			await harness.app.waitUntilExit();
		}
	});
});
