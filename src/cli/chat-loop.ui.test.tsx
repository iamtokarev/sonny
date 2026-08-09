import { describe, expect, mock, test } from "bun:test";
import { PassThrough } from "node:stream";
import { type Instance, render } from "ink";
import type { RuntimeEvent } from "../events";
import { InMemoryRuntimeEventBus } from "../events";
import type {
	AgentTurnInput,
	AgentTurnResult,
	CreateAgentSessionResult,
} from "../runtime";
import { ChatApp } from "./chat-loop";

type RunTurn = (input: AgentTurnInput) => Promise<AgentTurnResult>;

type InkHarness = {
	app: Instance;
	stdin: PassThrough;
	output(): string;
};

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

function createInkHarness(
	eventBus: InMemoryRuntimeEventBus,
	runTurn: RunTurn,
): InkHarness {
	const stdin = Object.assign(new PassThrough(), {
		isTTY: true,
		setRawMode(_enabled: boolean) {
			return this;
		},
		ref() {
			return this;
		},
		unref() {
			return this;
		},
	});
	const stdout = Object.assign(new PassThrough(), {
		isTTY: true,
		columns: 120,
		rows: 40,
	});
	const stderr = new PassThrough();
	let output = "";

	stdout.on("data", (chunk) => {
		output += chunk.toString();
	});

	const app = render(
		<ChatApp
			eventBus={eventBus}
			createSession={async () => createSessionResult(runTurn)}
		/>,
		{
			stdin: stdin as unknown as NodeJS.ReadStream,
			stdout: stdout as unknown as NodeJS.WriteStream,
			stderr: stderr as unknown as NodeJS.WriteStream,
			debug: true,
			interactive: true,
			exitOnCtrlC: false,
			patchConsole: false,
			maxFps: 1000,
		},
	);

	return {
		app,
		stdin,
		output: () => output,
	};
}

async function flush(harness: InkHarness): Promise<void> {
	await harness.app.waitUntilRenderFlush();
}

async function enter(harness: InkHarness, input: string): Promise<void> {
	harness.stdin.write(input);
	await flush(harness);
	harness.stdin.write("\r");
	await flush(harness);
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
		const harness = createInkHarness(eventBus, runTurn);

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
		const harness = createInkHarness(eventBus, async () => ({
			turnId: "turn-1",
			content: "Done",
		}));

		await flush(harness);
		harness.app.unmount();
		await harness.app.waitUntilExit();

		expect(eventBus.unsubscribeCount).toBe(1);
	});

	test("routes normal input through AgentRuntime and renders its result", async () => {
		const runTurn = mock(async () => ({
			turnId: "turn-1",
			content: "Runtime response",
		}));
		const harness = createInkHarness(new InMemoryRuntimeEventBus(), runTurn);

		try {
			await flush(harness);
			await enter(harness, "hello runtime");
			await flush(harness);

			expect(runTurn).toHaveBeenCalledTimes(1);
			expect(runTurn).toHaveBeenCalledWith({
				content: "hello runtime",
				source: { kind: "cli" },
			});
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
		const harness = createInkHarness(new InMemoryRuntimeEventBus(), runTurn);

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

	test("renders runtime failures", async () => {
		const runTurn = mock(async () => {
			throw new Error("Runtime failed");
		});
		const harness = createInkHarness(new InMemoryRuntimeEventBus(), runTurn);

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
