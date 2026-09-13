import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChannelCommandRegistry } from "../commands/create-command-registry";
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
	readonly sendStarted = deferred<void>();
	sendGate?: Promise<void>;
	private readonly completion = deferred<void>();
	private handler?: ChannelEventHandler;
	private lifecycleSignal?: AbortSignal;
	private onFailure?: (error: unknown) => void;

	constructor(
		readonly name: string,
		private readonly deliver: (
			output: ChannelOutput,
			signal?: AbortSignal,
		) => Promise<void> = async () => {},
		private readonly abortFailure?: Error,
	) {}

	run(
		handler: ChannelEventHandler,
		signal: AbortSignal,
		onFailure?: (error: unknown) => void,
	): Promise<void> {
		this.handler = handler;
		this.lifecycleSignal = signal;
		this.onFailure = onFailure;
		this.started.resolve(undefined);

		if (signal.aborted) {
			this.completion.resolve(undefined);
		} else {
			signal.addEventListener(
				"abort",
				() =>
					this.abortFailure === undefined
						? this.completion.resolve(undefined)
						: this.completion.reject(this.abortFailure),
				{ once: true },
			);
		}

		return this.completion.promise;
	}

	async send(output: ChannelOutput, signal?: AbortSignal): Promise<void> {
		this.sent.push(output);
		this.sendStarted.resolve(undefined);
		await this.sendGate;
		await this.deliver(output, signal);
	}

	emit(event: ChannelEvent): Promise<void> {
		if (!this.handler) {
			throw new Error("Adapter has not started.");
		}

		return this.handler(event);
	}

	fail(error: Error): void {
		this.completion.reject(error);
		this.onFailure?.(error);
	}

	reportFailure(error: Error): void {
		this.onFailure?.(error);
	}

	finishFailure(error: Error): void {
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
	readonly acquisitionCalls: ChannelSource[];
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
		readonly beforeCreateSession?: () => Promise<void>;
		readonly initialBindings?: readonly {
			readonly source: ChannelSource;
			readonly sessionId: string;
		}[];
		readonly createSession?: (
			options: { resumeSessionId?: string },
			suggestedSessionId: string,
			runTurn: (input: AgentTurnInput) => Promise<AgentTurnResult>,
		) => Promise<CreateAgentSessionResult>;
	} = {},
): Promise<GatewayHarness> {
	const adapters = options.adapters ?? [new FakeAdapter("telegram")];
	const adapter = adapters[0] as FakeAdapter;
	const delivery = new ChannelDelivery(adapters);
	const approvals = new ChannelApprovalBroker((output, signal) =>
		delivery.send(output, signal),
	);
	const workspace = await mkdtemp(join(tmpdir(), "sonny-channel-gateway-"));
	const bindings = new ChannelSessionBindingStore(
		join(workspace, ".history", "channels", "bindings.json"),
	);
	for (const binding of options.initialBindings ?? []) {
		await bindings.bind(binding.source, binding.sessionId);
	}
	const commands = createChannelCommandRegistry();
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
		await options.beforeCreateSession?.();
		const sessionId =
			createOptions.resumeSessionId ?? `session-${nextSession++}`;

		const runTurn = async (input: AgentTurnInput) => {
			turnInputs.push(input);
			return (
				options.runTurn?.(input, sessionId, approvals) ?? {
					turnId: "turn-1",
					content: `Reply to ${input.content}`,
				}
			);
		};

		return options.createSession
			? options.createSession(createOptions, sessionId, runTurn)
			: sessionResult(sessionId, runTurn);
	};
	const sessions = new ChannelSessionDirectory(
		bindings,
		createSession,
		commands,
	);
	const acquisitionCalls: ChannelSource[] = [];
	const getOrCreate = sessions.getOrCreate.bind(sessions);
	sessions.getOrCreate = (candidate) => {
		acquisitionCalls.push(candidate);
		return getOrCreate(candidate);
	};
	const gateway = new ChannelGateway({
		adapters,
		delivery,
		sessions,
		approvals,
		commands,
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
		acquisitionCalls,
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

	test("waits for an active turn and suppresses its obsolete reply", async () => {
		const turnStarted = deferred<void>();
		const releaseTurn = deferred<void>();
		let turnSignal: AbortSignal | undefined;
		const harness = await createHarness({
			runTurn: async (input) => {
				turnSignal = input.signal;
				turnStarted.resolve(undefined);
				await releaseTurn.promise;
				return { turnId: "turn-1", content: "obsolete reply" };
			},
		});
		const emitted = harness.adapter.emit(message("conversation-1", "Hello"));
		await turnStarted.promise;
		let stopped = false;
		const stop = harness.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();

		expect(turnSignal?.aborted).toBe(true);
		expect(stopped).toBe(false);
		releaseTurn.resolve(undefined);
		await emitted;
		await stop;
		expect(harness.adapter.sent).toHaveLength(0);
	});

	test("waits for an issued outbound send before completing stop", async () => {
		const delivery = deferred<void>();
		const harness = await createHarness();
		harness.adapter.sendGate = delivery.promise;
		const emitted = harness.adapter.emit(message("conversation-1", "Hello"));
		await harness.adapter.sendStarted.promise;
		let stopped = false;
		const stop = harness.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();

		expect(stopped).toBe(false);
		delivery.resolve(undefined);
		await emitted;
		await stop;
		expect(stopped).toBe(true);
	});

	test("polling failure cancels pending approval and preserves its error", async () => {
		const approvalRequested = deferred<void>();
		const decisions: boolean[] = [];
		const harness = await createHarness({
			runTurn: approvalRunTurn(approvalRequested, (approved) =>
				decisions.push(approved),
			),
		});
		const emitted = harness.adapter.emit(message("conversation-1", "Run it"));
		await approvalRequested.promise;
		const failure = new Error("polling failed");

		harness.adapter.fail(failure);
		await expect(harness.run).rejects.toBe(failure);
		await emitted;
		expect(decisions).toEqual([false]);
		expect(harness.adapter.sent).toHaveLength(1);
	});

	test("initiating polling failure wins over a sibling abort rejection", async () => {
		const original = new Error("polling failed");
		const siblingCancellation = new Error("sibling cancelled");
		const adapters = [
			new FakeAdapter("telegram"),
			new FakeAdapter("slack", async () => {}, siblingCancellation),
		];
		const harness = await createHarness({ adapters });

		adapters[0]?.reportFailure(original);
		await Promise.resolve();
		adapters[0]?.finishFailure(original);

		await expect(harness.run).rejects.toBe(original);
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

	test("starts a fresh bound session through /new without a model turn", async () => {
		const harness = await createHarness();

		await harness.adapter.emit(
			message("conversation-1", "/new", { messageId: "reset-1" }),
		);
		await harness.adapter.emit(message("conversation-1", "/session"));

		expect(harness.createCalls).toEqual([{}]);
		expect(harness.turnInputs).toHaveLength(0);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"Started a new session. Previous history is preserved.",
			["Session: session-1", "Title: Channel test", "Messages: 0"].join("\n"),
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-1");
		await harness.stop();
	});

	test("treats malformed /new arguments as an ordinary usage response", async () => {
		const harness = await createHarness();

		await harness.adapter.emit(message("conversation-1", "/new named"));

		expect(harness.createCalls).toEqual([{}]);
		expect(harness.turnInputs).toHaveLength(0);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"Usage: /new",
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-1");
		await harness.stop();
	});

	test("interrupts A, discards queued B, confirms reset, then runs C in the replacement", async () => {
		const turnStarted = deferred<void>();
		const releaseTurn = deferred<void>();
		let turnSignal: AbortSignal | undefined;
		const harness = await createHarness({
			runTurn: async (input, sessionId) => {
				if (input.content === "A") {
					turnSignal = input.signal;
					turnStarted.resolve(undefined);
					await releaseTurn.promise;
				}
				return {
					turnId: `turn-${sessionId}`,
					content: `${sessionId}:${input.content}`,
				};
			},
		});
		const a = harness.adapter.emit(message("conversation-1", "A"));
		await turnStarted.promise;
		const b = harness.adapter.emit(message("conversation-1", "B"));
		const reset = harness.adapter.emit(message("conversation-1", "/reset"));
		const c = harness.adapter.emit(message("conversation-1", "C"));

		expect(turnSignal?.aborted).toBe(true);
		expect(harness.createCalls).toEqual([{}]);
		releaseTurn.resolve(undefined);
		await Promise.all([a, b, reset, c]);

		expect(harness.createCalls).toEqual([{}, {}]);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"A",
			"C",
		]);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"Started a new session. Previous history is preserved. Interrupted active work. Discarded 1 queued message.",
			"session-2:C",
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-2");
		await harness.stop();
	});

	test("serializes concurrent resets and attributes queued discards to the later reset", async () => {
		const harness = await createHarness();

		const first = harness.adapter.emit(message("conversation-1", "/new"));
		const between = harness.adapter.emit(message("conversation-1", "between"));
		const second = harness.adapter.emit(message("conversation-1", "/reset"));
		const after = harness.adapter.emit(message("conversation-1", "after"));
		await Promise.all([first, between, second, after]);

		expect(harness.createCalls).toEqual([{}, {}]);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual(["after"]);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"Started a new session. Previous history is preserved.",
			"Started a new session. Previous history is preserved. Discarded 1 queued message.",
			"Reply to after",
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-2");
		await harness.stop();
	});

	test("resetting one binding leaves another shared interactor and approval untouched", async () => {
		const approvalRequested = deferred<void>();
		const firstSource = source("conversation-1");
		const secondSource = source("conversation-2");
		const harness = await createHarness({
			initialBindings: [
				{ source: firstSource, sessionId: "shared-session" },
				{ source: secondSource, sessionId: "shared-session" },
			],
			runTurn: approvalRunTurn(approvalRequested),
		});
		const otherTurn = harness.adapter.emit(
			message("conversation-2", "needs approval"),
		);
		await approvalRequested.promise;
		const otherSignal = harness.turnInputs[0]?.signal;
		const approval = harness.adapter.sent.find(
			(output) => output.target.conversationId === "conversation-2",
		);
		if (!approval) {
			throw new Error("Expected the other conversation approval.");
		}

		const queuedForReset = harness.adapter.emit(
			message("conversation-1", "queued behind shared runtime"),
		);
		await Promise.resolve();
		const reset = harness.adapter.emit(message("conversation-1", "/new"));
		await Promise.all([queuedForReset, reset]);

		expect(otherSignal?.aborted).toBe(false);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"needs approval",
		]);
		expect(harness.createCalls).toEqual([
			{ resumeSessionId: "shared-session" },
			{},
		]);
		expect((await harness.bindings.get(firstSource))?.sessionId).toBe(
			"session-1",
		);
		expect((await harness.bindings.get(secondSource))?.sessionId).toBe(
			"shared-session",
		);

		await harness.adapter.emit(
			action("conversation-2", outputAction(approval, "Approve")),
		);
		await otherTurn;
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			approval.text,
			"Started a new session. Previous history is preserved. Discarded 1 queued message.",
			"Tool approved.",
		]);
		await harness.stop();
	});

	test("an old approval action cannot approve a replacement-session request", async () => {
		const requested = [deferred<void>(), deferred<void>()];
		let requestIndex = 0;
		const harness = await createHarness({
			runTurn: async (input, sessionId, approvals) => {
				const index = requestIndex++;
				const decision = approvals.request({
					toolCallId: `call-${index}`,
					toolName: "bash",
					description: "Run a command",
					parameters: { command: "bun test" },
					turn: {
						sessionId,
						turnId: `turn-${index}`,
						source: input.source,
						signal: input.signal,
					},
				});
				requested[index]?.resolve(undefined);
				const result = await decision;
				return {
					turnId: `turn-${index}`,
					content: result.approved ? "approved" : "denied",
				};
			},
		});
		const oldTurn = harness.adapter.emit(message("conversation-1", "old"));
		await requested[0]?.promise;
		const oldPrompt = harness.adapter.sent[0] as ChannelOutput;
		const reset = harness.adapter.emit(message("conversation-1", "/new"));
		await Promise.all([oldTurn, reset]);
		const newTurn = harness.adapter.emit(message("conversation-1", "new"));
		await requested[1]?.promise;
		const newPrompt = harness.adapter.sent.find(
			(output) =>
				output.actions !== undefined &&
				outputAction(output, "Approve") !== outputAction(oldPrompt, "Approve"),
		);
		if (!newPrompt) {
			throw new Error("Expected a replacement-session approval prompt.");
		}
		let newTurnSettled = false;
		void newTurn.then(() => {
			newTurnSettled = true;
		});

		await harness.adapter.emit(
			action("conversation-1", outputAction(oldPrompt, "Approve")),
		);
		await Promise.resolve();
		expect(newTurnSettled).toBe(false);
		await harness.adapter.emit(
			action("conversation-1", outputAction(newPrompt, "Approve")),
		);
		await newTurn;
		expect(harness.adapter.sent.at(-1)?.text).toBe("approved");
		await harness.stop();
	});

	test("waits for only the retiring conversation's detached approval delivery", async () => {
		const oldDelivery = deferred<void>();
		const otherDelivery = deferred<void>();
		const approvalSignals = new Map<string, AbortSignal>();
		const approvalChunks: string[] = [];
		const adapter = new FakeAdapter("telegram", async (output, signal) => {
			if (!output.actions || !signal) {
				return;
			}
			approvalSignals.set(output.target.conversationId, signal);
			approvalChunks.push(`${output.target.conversationId}:chunk-1`);
			await (output.target.conversationId === "conversation-1"
				? oldDelivery.promise
				: otherDelivery.promise);
			if (!signal.aborted) {
				approvalChunks.push(`${output.target.conversationId}:chunk-2`);
			}
		});
		const approvalsStarted = [deferred<void>(), deferred<void>()];
		const harness = await createHarness({
			adapters: [adapter],
			runTurn: async (input, sessionId, approvals) => {
				if (input.source.kind !== "channel") {
					throw new Error("Expected a channel source.");
				}
				const index = input.source.conversationId === "conversation-1" ? 0 : 1;
				const decision = approvals.request({
					toolCallId: `call-${index}`,
					toolName: "bash",
					description: "Run a command",
					parameters: { command: "bun test" },
					turn: {
						sessionId,
						turnId: `turn-${index}`,
						source: input.source,
						signal: input.signal,
					},
				});
				approvalsStarted[index]?.resolve(undefined);
				await decision;
				return { turnId: `turn-${index}`, content: "old reply" };
			},
		});
		const oldTurn = adapter.emit(message("conversation-1", "old approval"));
		const otherTurn = adapter.emit(message("conversation-2", "other approval"));
		await Promise.all(approvalsStarted.map(({ promise }) => promise));
		const oldPrompt = adapter.sent.find(
			(output) => output.target.conversationId === "conversation-1",
		);
		const otherPrompt = adapter.sent.find(
			(output) => output.target.conversationId === "conversation-2",
		);
		if (!oldPrompt || !otherPrompt) {
			throw new Error("Expected both approval prompts.");
		}

		const clicked = adapter.emit(
			action("conversation-1", outputAction(oldPrompt, "Approve")),
		);
		const reset = adapter.emit(message("conversation-1", "/new"));
		await clicked;
		await Promise.resolve();
		expect(approvalSignals.get("conversation-1")?.aborted).toBe(true);
		expect(approvalSignals.get("conversation-2")?.aborted).toBe(false);
		expect(
			adapter.sent.some(({ text }) => text.startsWith("Started a new session")),
		).toBe(false);

		oldDelivery.resolve(undefined);
		await Promise.all([oldTurn, reset]);
		expect(
			approvalChunks.filter((chunk) => chunk.startsWith("conversation-1")),
		).toEqual(["conversation-1:chunk-1"]);
		expect(
			adapter.sent.some(({ text }) => text.startsWith("Started a new session")),
		).toBe(true);
		expect(approvalSignals.get("conversation-2")?.aborted).toBe(false);

		await adapter.emit(
			action("conversation-2", outputAction(otherPrompt, "Deny")),
		);
		otherDelivery.resolve(undefined);
		await otherTurn;
		expect(
			approvalChunks.filter((chunk) => chunk.startsWith("conversation-2")),
		).toEqual(["conversation-2:chunk-1", "conversation-2:chunk-2"]);
		await harness.stop();
	});

	test("waits for an issued old reply chunk and suppresses later chunks before confirmation", async () => {
		const firstChunk = deferred<void>();
		const releaseChunk = deferred<void>();
		const chunks: string[] = [];
		const adapter = new FakeAdapter("telegram", async (output, signal) => {
			const parts = [
				output.text.slice(0, 4_000),
				output.text.slice(4_000),
			].filter((part) => part.length > 0);
			for (const [index, part] of parts.entries()) {
				if (signal?.aborted) {
					return;
				}
				chunks.push(part);
				if (output.text.startsWith("old") && index === 0) {
					firstChunk.resolve(undefined);
					await releaseChunk.promise;
				}
			}
		});
		const harness = await createHarness({
			adapters: [adapter],
			runTurn: async () => ({
				turnId: "turn-1",
				content: `old${"x".repeat(4_000)}`,
			}),
		});
		const old = adapter.emit(message("conversation-1", "old"));
		await firstChunk.promise;
		const reset = adapter.emit(message("conversation-1", "/new"));
		await Promise.resolve();
		expect(chunks).toEqual([`old${"x".repeat(3_997)}`]);

		releaseChunk.resolve(undefined);
		await Promise.all([old, reset]);
		expect(chunks).toEqual([
			`old${"x".repeat(3_997)}`,
			"Started a new session. Previous history is preserved. Interrupted active work.",
		]);
		await harness.stop();
	});

	test("reports fresh-session creation failure safely and allows a retry", async () => {
		let failed = false;
		const harness = await createHarness({
			createSession: async (_options, sessionId, runTurn) => {
				if (!failed) {
					failed = true;
					throw new Error("creation failed with private data");
				}
				return sessionResult(sessionId, runTurn);
			},
		});

		await harness.adapter.emit(message("conversation-1", "/new"));
		await harness.adapter.emit(message("conversation-1", "/reset"));

		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"Sorry, I could not start a new session. The previous session remains available.",
			"Started a new session. Previous history is preserved.",
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-2");
		await harness.stop();
	});

	test("keeps the old binding and cache usable after binding-write failure", async () => {
		const harness = await createHarness({
			runTurn: async (input, sessionId) => ({
				turnId: `turn-${sessionId}`,
				content: `${sessionId}:${input.content}`,
			}),
		});
		await harness.adapter.emit(message("conversation-1", "before"));
		const bind = harness.bindings.bind.bind(harness.bindings);
		let rejectReplacement = true;
		harness.bindings.bind = async (candidate, sessionId) => {
			if (rejectReplacement) {
				rejectReplacement = false;
				throw new Error("binding write failed");
			}
			return bind(candidate, sessionId);
		};

		await harness.adapter.emit(message("conversation-1", "/new"));
		await harness.adapter.emit(message("conversation-1", "still old"));
		await harness.adapter.emit(message("conversation-1", "/new"));

		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			"session-1:before",
			"Sorry, I could not start a new session. The previous session remains available.",
			"session-1:still old",
			"Started a new session. Previous history is preserved.",
		]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-3");
		await harness.stop();
	});

	test("retains a committed replacement when confirmation delivery fails", async () => {
		const failure = new Error("confirmation transport failed");
		const adapter = new FakeAdapter("telegram", async (output) => {
			if (output.text.startsWith("Started a new session")) {
				throw failure;
			}
		});
		const harness = await createHarness({ adapters: [adapter] });

		await expect(adapter.emit(message("conversation-1", "/new"))).rejects.toBe(
			failure,
		);
		await adapter.emit(message("conversation-1", "after failure"));

		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-1");
		expect(adapter.sent.map(({ text }) => text)).toEqual([
			"Started a new session. Previous history is preserved.",
			"Reply to after failure",
		]);
		await harness.stop();
	});

	test("stop while reset waits for old non-abortable work prevents replacement and confirmation", async () => {
		const turnStarted = deferred<void>();
		const releaseTurn = deferred<void>();
		const harness = await createHarness({
			runTurn: async () => {
				turnStarted.resolve(undefined);
				await releaseTurn.promise;
				return { turnId: "turn-1", content: "obsolete" };
			},
		});
		const old = harness.adapter.emit(message("conversation-1", "old"));
		await turnStarted.promise;
		const reset = harness.adapter.emit(message("conversation-1", "/new"));
		const queued = harness.adapter.emit(message("conversation-1", "queued"));
		let stopped = false;
		const stop = harness.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();

		expect(stopped).toBe(false);
		expect(harness.createCalls).toEqual([{}]);
		releaseTurn.resolve(undefined);
		await Promise.all([old, reset, queued, stop]);
		expect(harness.createCalls).toEqual([{}]);
		expect(harness.adapter.sent).toHaveLength(0);
	});

	test("stop during fresh creation publishes no binding or confirmation", async () => {
		const creationStarted = deferred<void>();
		const releaseCreation = deferred<void>();
		const harness = await createHarness({
			beforeCreateSession: () => {
				creationStarted.resolve(undefined);
				return releaseCreation.promise;
			},
		});
		const reset = harness.adapter.emit(message("conversation-1", "/new"));
		await creationStarted.promise;
		const stop = harness.stop();

		releaseCreation.resolve(undefined);
		await Promise.all([reset, stop]);
		expect(
			await harness.bindings.get(source("conversation-1")),
		).toBeUndefined();
		expect(harness.adapter.sent).toHaveLength(0);
	});

	test("stop during binding persistence keeps the committed binding without confirmation", async () => {
		const harness = await createHarness();
		const bindStarted = deferred<void>();
		const releaseBind = deferred<void>();
		const bind = harness.bindings.bind.bind(harness.bindings);
		harness.bindings.bind = async (candidate, sessionId) => {
			bindStarted.resolve(undefined);
			await releaseBind.promise;
			return bind(candidate, sessionId);
		};
		const reset = harness.adapter.emit(message("conversation-1", "/new"));
		await bindStarted.promise;
		const stop = harness.stop();

		releaseBind.resolve(undefined);
		await Promise.all([reset, stop]);
		expect(
			(await harness.bindings.get(source("conversation-1")))?.sessionId,
		).toBe("session-1");
		expect(harness.adapter.sent).toHaveLength(0);
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

	test("orders messages before delayed session acquisition", async () => {
		const releaseAcquisition = deferred<void>();
		const acquisitionStarted = deferred<void>();
		const harness = await createHarness({
			beforeCreateSession: () => {
				acquisitionStarted.resolve(undefined);
				return releaseAcquisition.promise;
			},
		});

		const first = harness.adapter.emit(message("conversation-1", "first"));
		const second = harness.adapter.emit(message("conversation-1", "second"));
		await acquisitionStarted.promise;

		expect(harness.createCalls).toHaveLength(1);
		expect(harness.turnInputs).toHaveLength(0);

		releaseAcquisition.resolve(undefined);
		await Promise.all([first, second]);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"first",
			"second",
		]);
		await harness.stop();
	});

	test("queued messages do not acquire a session after shutdown starts", async () => {
		const firstStarted = deferred<void>();
		const releaseFirst = deferred<void>();
		const harness = await createHarness({
			runTurn: async (input) => {
				if (input.content === "first") {
					firstStarted.resolve(undefined);
					await releaseFirst.promise;
				}
				return { turnId: "turn-1", content: `Reply to ${input.content}` };
			},
		});
		const first = harness.adapter.emit(message("conversation-1", "first"));
		await firstStarted.promise;
		const queued = harness.adapter.emit(message("conversation-1", "queued"));
		const stop = harness.stop();

		expect(harness.acquisitionCalls).toHaveLength(1);
		releaseFirst.resolve(undefined);
		await Promise.all([first, queued, stop]);
		expect(harness.acquisitionCalls).toHaveLength(1);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual(["first"]);
	});

	test("holds a conversation through every chunk of response delivery", async () => {
		const firstChunkSent = deferred<void>();
		const releaseFirstChunk = deferred<void>();
		const chunks: Array<{ text: string; replyToMessageId?: string }> = [];
		const adapter = new FakeAdapter("telegram", async (output) => {
			const parts = [
				output.text.slice(0, 4_000),
				output.text.slice(4_000),
			].filter((part) => part.length > 0);
			for (const [index, part] of parts.entries()) {
				chunks.push({
					text: part,
					replyToMessageId: index === 0 ? output.replyToMessageId : undefined,
				});
				if (output.text.startsWith("A") && index === 0) {
					firstChunkSent.resolve(undefined);
					await releaseFirstChunk.promise;
				}
			}
		});
		const harness = await createHarness({
			adapters: [adapter],
			runTurn: async (input) => ({
				turnId: "turn-1",
				content: input.content === "A" ? `A${"a".repeat(4_000)}` : "B reply",
			}),
		});

		const first = adapter.emit(
			message("conversation-1", "A", { messageId: "message-a" }),
		);
		await firstChunkSent.promise;
		const second = adapter.emit(
			message("conversation-1", "B", { messageId: "message-b" }),
		);
		await Promise.resolve();
		expect(harness.turnInputs.map(({ content }) => content)).toEqual(["A"]);

		releaseFirstChunk.resolve(undefined);
		await Promise.all([first, second]);
		expect(chunks.map(({ text }) => text)).toEqual([
			`A${"a".repeat(3_999)}`,
			"a",
			"B reply",
		]);
		expect(chunks.map(({ replyToMessageId }) => replyToMessageId)).toEqual([
			"message-a",
			undefined,
			"message-b",
		]);
		await harness.stop();
	});

	test("keeps notice and assistant output contiguous before the next input", async () => {
		const noticeStarted = deferred<void>();
		const releaseNotice = deferred<void>();
		const adapter = new FakeAdapter("telegram", async (output) => {
			if (output.text === "Draft submitted.") {
				noticeStarted.resolve(undefined);
				await releaseNotice.promise;
			}
		});
		const harness = await createHarness({ adapters: [adapter] });

		const first = adapter.emit(message("conversation-1", "/draft hello"));
		await noticeStarted.promise;
		const second = adapter.emit(message("conversation-1", "/echo later"));
		await Promise.resolve();
		expect(adapter.sent.map(({ text }) => text)).toEqual(["Draft submitted."]);

		releaseNotice.resolve(undefined);
		await Promise.all([first, second]);
		expect(adapter.sent.map(({ text }) => text)).toEqual([
			"Draft submitted.",
			"Reply to hello",
			"later",
		]);
		await harness.stop();
	});

	test("keeps routing identities independent", async () => {
		const releaseFirst = deferred<void>();
		const firstStarted = deferred<void>();
		const independentCompleted: string[] = [];
		const adapters = [new FakeAdapter("telegram"), new FakeAdapter("slack")];
		const harness = await createHarness({
			adapters,
			runTurn: async (input) => {
				if (input.content === "blocked") {
					firstStarted.resolve(undefined);
					await releaseFirst.promise;
				} else {
					independentCompleted.push(input.content);
				}
				return { turnId: "turn-1", content: `Reply to ${input.content}` };
			},
		});

		const blocked = adapters[0]?.emit(
			message("same", "blocked", { threadId: "one" }),
		);
		await firstStarted.promise;
		await Promise.all([
			adapters[0]?.emit(message("same", "other-thread", { threadId: "two" })),
			adapters[0]?.emit(
				message("same", "other-kind", { conversationKind: "channel" }),
			),
			adapters[1]?.emit(message("same", "other-channel", { channel: "slack" })),
		]);
		expect(independentCompleted.sort()).toEqual([
			"other-channel",
			"other-kind",
			"other-thread",
		]);

		releaseFirst.resolve(undefined);
		await blocked;
		await harness.stop();
	});

	test("holds later input through a delayed safe error reply", async () => {
		const errorReplyStarted = deferred<void>();
		const releaseErrorReply = deferred<void>();
		const adapter = new FakeAdapter("telegram", async (output) => {
			if (output.text === "Sorry, I could not handle that message.") {
				errorReplyStarted.resolve(undefined);
				await releaseErrorReply.promise;
			}
		});
		const harness = await createHarness({
			adapters: [adapter],
			runTurn: async (input) => {
				if (input.content === "fail") throw new Error("failed");
				return { turnId: "turn-1", content: "recovered" };
			},
		});

		const failed = adapter.emit(message("conversation-1", "fail"));
		await errorReplyStarted.promise;
		const later = adapter.emit(message("conversation-1", "later"));
		await Promise.resolve();
		expect(harness.turnInputs.map(({ content }) => content)).toEqual(["fail"]);

		releaseErrorReply.resolve(undefined);
		await Promise.all([failed, later]);
		expect(adapter.sent.map(({ text }) => text)).toEqual([
			"Sorry, I could not handle that message.",
			"recovered",
		]);
		await harness.stop();
	});

	test("releases ordering after delivery rejects", async () => {
		let sends = 0;
		const deliveryFailure = new Error("delivery failed");
		const adapter = new FakeAdapter("telegram", async () => {
			sends += 1;
			if (sends === 1) throw deliveryFailure;
		});
		const harness = await createHarness({ adapters: [adapter] });

		await expect(adapter.emit(message("conversation-1", "first"))).rejects.toBe(
			deliveryFailure,
		);
		await adapter.emit(message("conversation-1", "second"));

		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"first",
			"second",
		]);
		expect(adapter.sent.at(-1)?.text).toBe("Reply to second");
		await harness.stop();
	});

	test("an older cleanup cannot clear ownership of newer queued work", async () => {
		const releaseSecond = deferred<void>();
		const secondStarted = deferred<void>();
		const harness = await createHarness({
			runTurn: async (input) => {
				if (input.content === "second") {
					secondStarted.resolve(undefined);
					await releaseSecond.promise;
				}
				return { turnId: "turn-1", content: `Reply to ${input.content}` };
			},
		});

		const first = harness.adapter.emit(message("conversation-1", "first"));
		const second = harness.adapter.emit(message("conversation-1", "second"));
		await first;
		await secondStarted.promise;
		const third = harness.adapter.emit(message("conversation-1", "third"));
		await Promise.resolve();
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"first",
			"second",
		]);

		releaseSecond.resolve(undefined);
		await Promise.all([second, third]);
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"first",
			"second",
			"third",
		]);
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

	test("resolves approval actions while another ordinary message is queued", async () => {
		const approvalRequested = deferred<void>();
		const harness = await createHarness({
			runTurn: async (input, sessionId, approvals) => {
				if (input.content !== "approve") {
					return { turnId: "turn-2", content: "Queued reply." };
				}

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
				return {
					turnId: "turn-1",
					content: (await decision).approved
						? "Tool approved."
						: "Tool denied.",
				};
			},
		});
		const waiting = harness.adapter.emit(message("conversation-1", "approve"));
		await approvalRequested.promise;
		const approvalOutput = harness.adapter.sent[0] as ChannelOutput;
		const value = outputAction(approvalOutput, "Approve");
		const queued = harness.adapter.emit(message("conversation-1", "queued"));
		await Promise.resolve();
		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"approve",
		]);

		await harness.adapter.emit(
			action("conversation-1", value, { userId: "wrong-user" }),
		);
		await harness.adapter.emit(action("conversation-1", value));
		await harness.adapter.emit(action("conversation-1", value));
		await Promise.all([waiting, queued]);

		expect(harness.turnInputs.map(({ content }) => content)).toEqual([
			"approve",
			"queued",
		]);
		expect(harness.adapter.sent.map(({ text }) => text)).toEqual([
			approvalOutput.text,
			"Tool approved.",
			"Queued reply.",
		]);
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
