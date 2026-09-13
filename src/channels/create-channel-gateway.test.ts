import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, type ResolvedConfig } from "../config";
import { InMemoryRuntimeEventBus } from "../events";
import type {
	AgentTurnInput,
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
	RuntimeConfigStore,
} from "../runtime";
import type {
	ChannelAdapter,
	ChannelEvent,
	ChannelEventHandler,
	ChannelOutput,
} from "./channel";
import {
	createChannelAccessCheck,
	createChannelGateway,
} from "./create-channel-gateway";
import type { EnabledTelegramChannelConfig } from "./telegram";

function deferred<T>() {
	let resolve: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return {
		promise,
		resolve: (value: T) => resolve?.(value),
	};
}

class MutableConfigStore implements RuntimeConfigStore {
	private revision = 1;

	constructor(private config: ResolvedConfig) {}

	get current() {
		return {
			revision: this.revision,
			loadedAt: new Date("2026-01-01T00:00:00.000Z"),
			config: this.config,
		};
	}

	replace(config: ResolvedConfig): void {
		this.config = config;
		this.revision += 1;
	}

	async refresh() {
		return { status: "unchanged" as const, snapshot: this.current };
	}
}

class FakeTelegramAdapter implements ChannelAdapter {
	readonly name = "telegram";
	readonly sent: ChannelOutput[] = [];
	readonly started = deferred<void>();
	private readonly stopped = deferred<void>();
	private handler?: ChannelEventHandler;

	async run(handler: ChannelEventHandler, signal: AbortSignal): Promise<void> {
		this.handler = handler;
		this.started.resolve(undefined);

		if (signal.aborted) {
			this.stopped.resolve(undefined);
		} else {
			signal.addEventListener("abort", () => this.stopped.resolve(undefined), {
				once: true,
			});
		}

		await this.stopped.promise;
	}

	async send(output: ChannelOutput): Promise<void> {
		this.sent.push(output);
	}

	emit(event: ChannelEvent): Promise<void> {
		if (this.handler === undefined) {
			throw new Error("Adapter has not started.");
		}

		return this.handler(event);
	}
}

function source(userId: string, conversationId = `conversation-${userId}`) {
	return {
		channel: "telegram",
		conversationId,
		conversationKind: "direct" as const,
		userId,
		messageId: `message-${userId}`,
	};
}

function message(userId: string): ChannelEvent {
	return {
		type: "message",
		source: source(userId),
		text: `Hello from ${userId}`,
	};
}

async function resolvedConfig(options: {
	readonly workspace?: string;
	readonly enabled: boolean;
	readonly allowedUserIds?: readonly string[];
}): Promise<ResolvedConfig> {
	const workspace =
		options.workspace ?? (await mkdtemp(join(tmpdir(), "sonny-gateway-")));

	return parseConfig({
		workspace,
		llm: { model: "openai/model-a", apiKey: "test-llm-key" },
		defaultAgent: "sonny",
		channels: {
			telegram: {
				enabled: options.enabled,
				...(options.enabled ? { botToken: "test-telegram-token" } : {}),
				allowedUserIds: options.allowedUserIds ?? [],
			},
		},
	});
}

function sessionResult(
	runTurn: (
		input: AgentTurnInput,
	) => Promise<{ turnId: string; content: string }>,
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
			id: "session-1",
			agentId: "sonny",
			title: "Gateway test",
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

describe("createChannelAccessCheck", () => {
	test("defaults to deny and permits only configured Telegram users", async () => {
		const config = await resolvedConfig({
			enabled: true,
			allowedUserIds: ["allowed-user"],
		});
		const isAllowed = createChannelAccessCheck(config);
		const telegramSource = source("allowed-user");

		expect(isAllowed(telegramSource)).toBe(true);
		expect(isAllowed(source("unknown-user"))).toBe(false);
		expect(isAllowed({ ...telegramSource, channel: "unknown-channel" })).toBe(
			false,
		);
	});
});

describe("createChannelGateway", () => {
	test("rejects startup when no channels are enabled", async () => {
		const configStore = new MutableConfigStore(
			await resolvedConfig({ enabled: false }),
		);
		let adapterCreations = 0;

		await expect(
			createChannelGateway(
				{ configStore, events: new InMemoryRuntimeEventBus() },
				{
					createTelegramAdapter: () => {
						adapterCreations += 1;
						return new FakeTelegramAdapter();
					},
				},
			),
		).rejects.toThrow("No channels are enabled.");
		expect(adapterCreations).toBe(0);
	});

	test("rejects enabled Telegram without inventing a token fallback", async () => {
		const valid = await resolvedConfig({
			enabled: true,
			allowedUserIds: ["allowed-user"],
		});
		const { botToken: _botToken, ...telegramWithoutToken } =
			valid.channels.telegram;
		const invalid = {
			...valid,
			channels: { telegram: telegramWithoutToken },
		} as ResolvedConfig;
		const configStore = new MutableConfigStore(invalid);
		let adapterCreations = 0;

		await expect(
			createChannelGateway(
				{ configStore, events: new InMemoryRuntimeEventBus() },
				{
					createTelegramAdapter: () => {
						adapterCreations += 1;
						return new FakeTelegramAdapter();
					},
				},
			),
		).rejects.toThrow(
			"Telegram configuration was enabled without a bot token.",
		);
		expect(adapterCreations).toBe(0);
	});

	test("assembles the graph from one snapshot and checks access before sessions", async () => {
		const initialConfig = await resolvedConfig({
			enabled: true,
			allowedUserIds: ["allowed-user"],
		});
		const replacementConfig = await resolvedConfig({
			workspace: initialConfig.workspace,
			enabled: true,
			allowedUserIds: ["late-user"],
		});
		const configStore = new MutableConfigStore(initialConfig);
		const events = new InMemoryRuntimeEventBus();
		const adapter = new FakeTelegramAdapter();
		const adapterConfigs: EnabledTelegramChannelConfig[] = [];
		const sessionOptions: CreateAgentSessionOptions[] = [];
		const turnInputs: AgentTurnInput[] = [];
		const gateway = await createChannelGateway(
			{ configStore, events },
			{
				createTelegramAdapter: (config) => {
					adapterConfigs.push(config);
					return adapter;
				},
				createSession: async (options) => {
					sessionOptions.push(options);
					return sessionResult(async (input) => {
						turnInputs.push(input);
						return { turnId: "turn-1", content: "Hello from Sonny" };
					});
				},
			},
		);

		expect(adapterConfigs).toEqual([
			expect.objectContaining({
				enabled: true,
				botToken: "test-telegram-token",
				allowedUserIds: ["allowed-user"],
			}),
		]);

		configStore.replace(replacementConfig);
		const abort = new AbortController();
		const run = gateway.run(abort.signal);
		await adapter.started.promise;

		await adapter.emit(message("unknown-user"));
		await adapter.emit(message("late-user"));
		expect(sessionOptions).toHaveLength(0);
		expect(adapter.sent).toHaveLength(0);

		await adapter.emit(message("allowed-user"));
		expect(sessionOptions).toHaveLength(1);
		expect(sessionOptions[0]).toMatchObject({
			configStore,
			events,
			resumeSessionId: undefined,
			approveToolCall: expect.any(Function),
		});
		expect(turnInputs[0]?.source).toMatchObject({
			kind: "channel",
			channel: "telegram",
			userId: "allowed-user",
		});
		expect(adapter.sent).toEqual([
			{
				target: {
					channel: "telegram",
					conversationId: "conversation-allowed-user",
					threadId: undefined,
				},
				text: "Hello from Sonny",
				replyToMessageId: "message-allowed-user",
			},
		]);

		abort.abort();
		await run;
	});
});
