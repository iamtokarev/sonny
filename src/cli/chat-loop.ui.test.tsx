import { describe, expect, mock, test } from "bun:test";
import type { RuntimeEvent } from "../events";
import { InMemoryRuntimeEventBus } from "../events";
import type {
	AgentTurnInput,
	AgentTurnResult,
	CreateAgentSessionResult,
} from "../runtime";
import {
	createInkHarness,
	enter,
	flush,
	type InkHarness,
	type InkHarnessOptions,
} from "../ui/test-support/ink-harness";
import { ChatApp } from "./chat-loop";

type RunTurn = (input: AgentTurnInput) => Promise<AgentTurnResult>;

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

function createSessionResult(runTurn: RunTurn): CreateAgentSessionResult {
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
	options: InkHarnessOptions = {},
): InkHarness {
	return createInkHarness(
		<ChatApp
			eventBus={eventBus}
			createSession={async () => createSessionResult(runTurn)}
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

	test("renders off a TTY instead of crashing on raw mode", async () => {
		const runTurn = mock(async () => ({
			turnId: "turn-1",
			content: "Unexpected response",
		}));
		// Piped stdin cannot be put into raw mode. Ink throws rather than
		// degrading, so the app has to decline to listen for keys at all.
		const harness = createChatHarness(new InMemoryRuntimeEventBus(), runTurn, {
			isTTY: false,
		});

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
