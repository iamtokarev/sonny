import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRegistry } from "../commands/command-registry";
import type {
	AgentTurnInput,
	AgentTurnResult,
	CreateAgentSessionResult,
} from "../runtime";
import type {
	ChannelAdapter,
	ChannelEvent,
	ChannelEventHandler,
	ChannelOutput,
	ChannelSource,
} from "./channel";
import { ChannelApprovalBroker } from "./channel-approval-broker";
import { ChannelDelivery } from "./channel-delivery";
import { ChannelGateway } from "./channel-gateway";
import { ChannelSessionBindingStore } from "./channel-session-binding-store";
import {
	ChannelSessionDirectory,
	type CreateChannelSession,
} from "./channel-session-directory";

function deferred<T>() {
	let resolve: ((value: T) => void) | undefined;
	let reject: ((reason?: unknown) => void) | undefined;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {
		promise,
		resolve: (value: T) => resolve?.(value),
		reject: (reason?: unknown) => reject?.(reason),
	};
}

class FakeAdapter implements ChannelAdapter {
	readonly sent: ChannelOutput[] = [];
	readonly started = deferred<void>();
	private readonly completion = deferred<void>();
	private handler?: ChannelEventHandler;
	private lifecycleSignal?: AbortSignal;

	constructor(readonly name: string) {}

	run(handler: ChannelEventHandler, signal: AbortSignal): Promise<void> {
		this.handler = handler;
		this.lifecycleSignal = signal;
		this.started.resolve(undefined);

		if (signal.aborted) {
			this.completion.resolve(undefined);
		} else {
			signal.addEventListener(
				"abort",
				() => this.completion.resolve(undefined),
				{ once: true },
			);
		}

		return this.completion.promise;
	}

	async send(output: ChannelOutput): Promise<void> {
		this.sent.push(output);
	}

	emit(event: ChannelEvent): Promise<void> {
		if (!this.handler) {
			throw new Error("Adapter has not started.");
		}

		return this.handler(event);
	}

	fail(error: Error): void {
		this.completion.reject(error);
	}

	get stopped(): boolean {
		return this.lifecycleSignal?.aborted ?? false;
	}
}

function source(
	conversationId: string,
	overrides: Partial<ChannelSource> = {},
): ChannelSource {
	return {
		channel: "telegram",
		conversationId,
		conversationKind: "direct",
		userId: "user-1",
		messageId: `message-${conversationId}`,
		...overrides,
	};
}

function message(
	conversationId: string,
	text: string,
	overrides: Partial<ChannelSource> = {},
): Extract<ChannelEvent, { type: "message" }> {
	return {
		type: "message",
		source: source(conversationId, overrides),
		text,
	};
}

function action(
	conversationId: string,
	value: string,
	overrides: Partial<ChannelSource> = {},
): Extract<ChannelEvent, { type: "action" }> {
	return {
		type: "action",
		source: source(conversationId, {
			messageId: `action-${conversationId}`,
			...overrides,
		}),
		value,
	};
}

function outputAction(
	output: ChannelOutput,
	label: "Approve" | "Deny",
): string {
	const candidate = output.actions?.find(
		(channelAction) => channelAction.label === label,
	);

	if (!candidate) {
		throw new Error(`Missing ${label} action.`);
	}

	return candidate.value;
}

function sessionResult(
	sessionId: string,
	runTurn: (input: AgentTurnInput) => Promise<AgentTurnResult>,
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
			reloadConfiguration: async () => ({
				status: "unchanged" as const,
				revision: 1,
				info: { model: "openai/model-a", toolNames: [] },
			}),
		} as unknown as CreateAgentSessionResult["runtime"],
		historySession: {
			id: sessionId,
			agentId: "sonny",
			title: "Channel test",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		restoredMessageCount: 0,
		restoredMessages: [],
		skills: [],
		mode: "new",
		toolNames: [],
		model: "openai/model-a",
	};
}

interface GatewayHarness {
	readonly adapter: FakeAdapter;
	readonly adapters: readonly FakeAdapter[];
	readonly bindings: ChannelSessionBindingStore;
	readonly createCalls: Array<{ resumeSessionId?: string }>;
	readonly turnInputs: AgentTurnInput[];
	readonly gateway: ChannelGateway;
	readonly controller: AbortController;
	readonly run: Promise<void>;
	stop(): Promise<void>;
}

async function createHarness(
	options: {
		readonly adapters?: readonly FakeAdapter[];
		readonly isAllowed?: (candidate: ChannelSource) => boolean;
		readonly runTurn?: (
			input: AgentTurnInput,
			sessionId: string,
			approvals: ChannelApprovalBroker,
		) => Promise<AgentTurnResult>;
	} = {},
): Promise<GatewayHarness> {
	const adapters = options.adapters ?? [new FakeAdapter("telegram")];
	const adapter = adapters[0] as FakeAdapter;
	const delivery = new ChannelDelivery(adapters);
	const approvals = new ChannelApprovalBroker((output) =>
		delivery.send(output),
	);
	const workspace = await mkdtemp(join(tmpdir(), "sonny-channel-gateway-"));
	const bindings = new ChannelSessionBindingStore(
		join(workspace, ".history", "channels", "bindings.json"),
	);
	const commands = new CommandRegistry();
	commands.register({
		name: "echo",
		description: "Echo text.",
		execute: (args) => ({ type: "message", content: args }),
	});
	commands.register({
		name: "draft",
		description: "Submit text with a notice.",
		execute: (args) => ({
			type: "submit",
			content: args,
			notice: "Draft submitted.",
		}),
	});
	commands.register({
		name: "exit",
		description: "Leave the active channel session.",
		execute: () => ({ type: "exit", content: "Session closed." }),
	});
	const createCalls: Array<{ resumeSessionId?: string }> = [];
	const turnInputs: AgentTurnInput[] = [];
	let nextSession = 1;
	const createSession: CreateChannelSession = async (createOptions) => {
		createCalls.push(createOptions);
		const sessionId =
			createOptions.resumeSessionId ?? `session-${nextSession++}`;

		return sessionResult(sessionId, async (input) => {
			turnInputs.push(input);
			return (
				options.runTurn?.(input, sessionId, approvals) ?? {
					turnId: "turn-1",
					content: `Reply to ${input.content}`,
				}
			);
		});
	};
	const sessions = new ChannelSessionDirectory(
		bindings,
		createSession,
		commands,
	);
	const gateway = new ChannelGateway({
		adapters,
		delivery,
		sessions,
		approvals,
		isAllowed: options.isAllowed ?? (() => true),
	});
	const controller = new AbortController();
	const run = gateway.run(controller.signal);
	await Promise.all(adapters.map((candidate) => candidate.started.promise));

	return {
		adapter,
		adapters,
		bindings,
		createCalls,
		turnInputs,
		gateway,
		controller,
		run,
		stop: async () => {
			controller.abort();
			await run;
		},
	};
}

function approvalRunTurn(
	approvalRequested: { resolve(value: undefined): void },
	onDecision?: (approved: boolean) => void,
): (
	input: AgentTurnInput,
	sessionId: string,
	approvals: ChannelApprovalBroker,
) => Promise<AgentTurnResult> {
	return async (input, sessionId, approvals) => {
		const decision = approvals.request({
			toolCallId: "call-1",
			toolName: "bash",
			description: "Run a command",
			parameters: { command: "bun test" },
			turn: {
				sessionId,
				turnId: "turn-1",
				source: input.source,
				signal: input.signal,
			},
		});
		approvalRequested.resolve(undefined);
		const result = await decision;
		onDecision?.(result.approved);

		return {
			turnId: "turn-1",
			content: result.approved ? "Tool approved." : "Tool denied.",
		};
	};
}

describe("ChannelGateway lifecycle", () => {
	test("starts every adapter and stops them when aborted", async () => {
		const adapters = [new FakeAdapter("telegram"), new FakeAdapter("slack")];
		const harness = await createHarness({ adapters });

		expect(adapters.every((adapter) => !adapter.stopped)).toBe(true);
		await harness.stop();
		expect(adapters.every((adapter) => adapter.stopped)).toBe(true);
	});

	test("fails fast and aborts sibling adapters", async () => {
		const adapters = [new FakeAdapter("telegram"), new FakeAdapter("slack")];
		const harness = await createHarness({ adapters });
		const failure = new Error("polling failed");

		adapters[0]?.fail(failure);

		await expect(harness.run).rejects.toBe(failure);
		expect(adapters[1]?.stopped).toBe(true);
	});

	test("rejects an event attributed to another channel", async () => {
		const harness = await createHarness();

		await expect(
			harness.adapter.emit(
				message("conversation-1", "Hello", { channel: "slack" }),
			),
		).rejects.toThrow("Adapter telegram emitted an event for another channel.");
		expect(harness.createCalls).toHaveLength(0);
		await harness.stop();
	});
});

describe("ChannelGateway text handling", () => {
	test("routes authorized text with source and reply context intact", async () => {
		const harness = await createHarness();
		const event = message("conversation-1", "  Hello  ", {
			threadId: "thread-1",
			messageId: "message-42",
		});

		await harness.adapter.emit(event);

		expect(harness.turnInputs).toEqual([
			{
				content: "Hello",
				source: {
					kind: "channel",
					channel: "telegram",
					conversationId: "conversation-1",
					conversationKind: "direct",
					threadId: "thread-1",
					userId: "user-1",
				},
				signal: expect.any(AbortSignal),
			},
		]);
		expect(harness.adapter.sent).toEqual([
			{
				target: {
					channel: "telegram",
					conversationId: "conversation-1",
					threadId: "thread-1",
				},
				text: "Reply to Hello",
				replyToMessageId: "message-42",
			},
		]);
		await expect(harness.bindings.get(event.source)).resolves.toMatchObject({
			sessionId: "session-1",
		});
		await harness.stop();
	});

	test("rejects unauthorized input before session acquisition or output", async () => {
		const harness = await createHarness({
			isAllowed: (candidate) => candidate.userId === "allowed-user",
		});
		const event = message("conversation-1", "/echo hidden", {
			userId: "rejected-user",
		});

		await harness.adapter.emit(event);

		expect(harness.createCalls).toHaveLength(0);
		expect(harness.turnInputs).toHaveLength(0);
		expect(harness.adapter.sent).toHaveLength(0);
		await expect(harness.bindings.get(event.source)).resolves.toBeUndefined();
		await harness.stop();
	});

	test("delivers notice and assistant messages in interaction order", async () => {
		const harness = await createHarness();

		await harness.adapter.emit(message("conversation-1", "/draft hello"));

		expect(
			harness.adapter.sent.map(({ text, target, replyToMessageId }) => ({
				text,
				target,
				replyToMessageId,
			})),
		).toEqual([
			{
				text: "Draft submitted.",
				target: {
					channel: "telegram",
					conversationId: "conversation-1",
					threadId: undefined,
				},
				replyToMessageId: "message-conversation-1",
			},
			{
				text: "Reply to hello",
				target: {
					channel: "telegram",
					conversationId: "conversation-1",
					threadId: undefined,
				},
				replyToMessageId: "message-conversation-1",
			},
		]);
		await harness.stop();
	});

	test("returns slash-command output without entering the runtime", async () => {
		const harness = await createHarness();

		await harness.adapter.emit(message("conversation-1", "/echo hello"));

		expect(harness.turnInputs).toHaveLength(0);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual(["hello"]);
		await harness.stop();
	});

	test("an exit evicts only its conversation session", async () => {
		const harness = await createHarness();

		await harness.adapter.emit(message("conversation-1", "first"));
		await harness.adapter.emit(message("conversation-2", "second"));
		await harness.adapter.emit(message("conversation-1", "/exit"));
		await harness.adapter.emit(message("conversation-2", "still active"));
		await harness.adapter.emit(message("conversation-1", "resume"));

		expect(harness.createCalls).toEqual([
			{},
			{},
			{ resumeSessionId: "session-1" },
		]);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"first",
			"second",
			"still active",
			"resume",
		]);
		await harness.stop();
	});

	test("serializes one conversation while another can run concurrently", async () => {
		const releaseFirst = deferred<void>();
		const firstStarted = deferred<void>();
		const bothConversationsStarted = deferred<void>();
		const started: string[] = [];
		const harness = await createHarness({
			runTurn: async (input) => {
				started.push(input.content);
				if (input.content === "first") {
					firstStarted.resolve(undefined);
				}
				if (started.includes("other") && started.includes("first")) {
					bothConversationsStarted.resolve(undefined);
				}

				if (input.content === "first") {
					await releaseFirst.promise;
				}

				return { turnId: "turn-1", content: `Reply to ${input.content}` };
			},
		});

		const first = harness.adapter.emit(message("conversation-1", "first"));
		await firstStarted.promise;
		const queued = harness.adapter.emit(message("conversation-1", "queued"));
		const other = harness.adapter.emit(message("conversation-2", "other"));
		await bothConversationsStarted.promise;
		expect(started).toEqual(["first", "other"]);

		releaseFirst.resolve(undefined);
		await Promise.all([first, queued, other]);
		expect(started).toEqual(["first", "other", "queued"]);
		await harness.stop();
	});

	test("returns one safe response when runtime work fails", async () => {
		let attempts = 0;
		const harness = await createHarness({
			runTurn: async () => {
				attempts += 1;
				throw new Error("provider diagnostic with credential-secret");
			},
		});

		await harness.adapter.emit(message("conversation-1", "Hello"));

		expect(attempts).toBe(1);
		expect(harness.adapter.sent).toHaveLength(1);
		expect(harness.adapter.sent[0]?.text).toBe(
			"Sorry, I could not handle that message.",
		);
		expect(harness.adapter.sent[0]?.text).not.toContain("credential-secret");
		await harness.stop();
	});
});

describe("ChannelGateway approval actions", () => {
	test.each([
		["Approve", true],
		["Deny", false],
	] as const)("lets the %s action resolve the waiting turn without entering its queue", async (label, approved) => {
		const approvalRequested = deferred<void>();
		const harness = await createHarness({
			runTurn: approvalRunTurn(approvalRequested),
		});
		const waitingTurn = harness.adapter.emit(
			message("conversation-1", "Use a tool"),
		);
		await approvalRequested.promise;
		const approvalOutput = harness.adapter.sent[0] as ChannelOutput;
		const value = outputAction(approvalOutput, label);

		await harness.adapter.emit(action("conversation-1", value));
		await waitingTurn;

		expect(harness.turnInputs).toHaveLength(1);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			approvalOutput.text,
			approved ? "Tool approved." : "Tool denied.",
		]);
		await harness.stop();
	});

	test("applies the message access check to approval actions", async () => {
		const approvalRequested = deferred<void>();
		const checkedUsers: string[] = [];
		const harness = await createHarness({
			isAllowed: (candidate) => {
				checkedUsers.push(candidate.userId);
				return candidate.userId === "user-1";
			},
			runTurn: approvalRunTurn(approvalRequested),
		});
		const waitingTurn = harness.adapter.emit(
			message("conversation-1", "Use a tool"),
		);
		await approvalRequested.promise;
		const value = outputAction(
			harness.adapter.sent[0] as ChannelOutput,
			"Approve",
		);

		await harness.adapter.emit(
			action("conversation-1", value, { userId: "user-2" }),
		);
		await Bun.sleep(0);
		expect(harness.adapter.sent).toHaveLength(1);

		await harness.adapter.emit(action("conversation-1", value));
		await waitingTurn;
		expect(checkedUsers).toEqual(["user-1", "user-2", "user-1"]);
		expect(harness.adapter.sent.at(-1)?.text).toBe("Tool approved.");
		await harness.stop();
	});

	test("mismatched, unrelated, and duplicate actions cannot resolve the wrong turn", async () => {
		const approvalRequested = deferred<void>();
		const harness = await createHarness({
			runTurn: approvalRunTurn(approvalRequested),
		});
		const waitingTurn = harness.adapter.emit(
			message("conversation-1", "Use a tool"),
		);
		await approvalRequested.promise;
		const approvalOutput = harness.adapter.sent[0] as ChannelOutput;
		const value = outputAction(approvalOutput, "Approve");

		await harness.adapter.emit(action("conversation-2", value));
		await harness.adapter.emit(
			action("conversation-1", value, { userId: "user-2" }),
		);
		await harness.adapter.emit(action("conversation-1", "settings:open"));
		await Bun.sleep(0);
		expect(harness.adapter.sent).toHaveLength(1);
		expect(harness.turnInputs).toHaveLength(1);

		await harness.adapter.emit(action("conversation-1", value));
		await waitingTurn;
		await harness.adapter.emit(action("conversation-1", value));
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			approvalOutput.text,
			"Tool approved.",
		]);
		expect(harness.turnInputs).toHaveLength(1);
		await harness.stop();
	});

	test("gateway shutdown denies a pending approval and unblocks its turn", async () => {
		const approvalRequested = deferred<void>();
		const observedDecision = deferred<boolean>();
		const harness = await createHarness({
			runTurn: approvalRunTurn(approvalRequested, (approved) =>
				observedDecision.resolve(approved),
			),
		});
		const waitingTurn = harness.adapter.emit(
			message("conversation-1", "Use a tool"),
		);
		await approvalRequested.promise;

		harness.controller.abort();
		await harness.run;
		await waitingTurn;

		await expect(observedDecision.promise).resolves.toBe(false);
		expect(harness.adapter.stopped).toBe(true);
	});
});
