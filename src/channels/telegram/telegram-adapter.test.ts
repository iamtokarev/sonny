import { describe, expect, test } from "bun:test";
import type { RunnerHandle } from "@grammyjs/runner";
import type { Bot } from "grammy";
import type { ChannelEvent, ChannelOutput } from "../channel";
import { ChannelDeliveryError } from "../channel-errors";
import {
	type EnabledTelegramChannelConfig,
	TelegramAdapter,
} from "./telegram-adapter";

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

interface SendCall {
	readonly chatId: number | string;
	readonly text: string;
	readonly options: Record<string, unknown> | undefined;
}

class FakeBot {
	readonly sends: SendCall[] = [];
	readonly api = {
		sendMessage: async (
			chatId: number | string,
			text: string,
			options?: Record<string, unknown>,
		) => {
			this.sends.push({ chatId, text, options });
			return {};
		},
	};
	private readonly handlers = new Map<
		string,
		(context: never) => Promise<void>
	>();

	on(filter: string, handler: (context: never) => Promise<void>): this {
		this.handlers.set(filter, handler);
		return this;
	}

	emit(filter: string, context: unknown): Promise<void> {
		const handler = this.handlers.get(filter);

		if (!handler) {
			throw new Error(`No handler registered for ${filter}.`);
		}

		return handler(context as never);
	}

	hasHandler(filter: string): boolean {
		return this.handlers.has(filter);
	}
}

class FakeRunner implements RunnerHandle {
	private readonly completion = deferred<void>();
	private running = true;
	stopCount = 0;

	start(): void {
		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running) {
			return;
		}

		this.stopCount += 1;
		this.running = false;
		this.completion.resolve(undefined);
	}

	size(): number {
		return 0;
	}

	task(): Promise<void> | undefined {
		return this.running ? this.completion.promise : undefined;
	}

	isRunning(): boolean {
		return this.running;
	}

	fail(error: Error): void {
		this.running = false;
		this.completion.reject(error);
	}
}

const config: EnabledTelegramChannelConfig = {
	enabled: true,
	botToken: "123:secret-token",
	allowedUserIds: ["7"],
};

function createAdapter(
	options: { readonly bot?: FakeBot; readonly runner?: FakeRunner } = {},
): {
	readonly adapter: TelegramAdapter;
	readonly bot: FakeBot;
	readonly runner: FakeRunner;
} {
	const bot = options.bot ?? new FakeBot();
	const runner = options.runner ?? new FakeRunner();
	const adapter = new TelegramAdapter(
		config,
		bot as unknown as Bot,
		() => runner,
	);

	return { adapter, bot, runner };
}

function privateTextContext(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		chat: { id: 42, type: "private" },
		from: { id: 7, is_bot: false },
		message: { message_id: 9, text: "Hello" },
		...overrides,
	};
}

function callbackContext(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		from: { id: 7, is_bot: false },
		callbackQuery: {
			data: "approval:id:allow",
			message: {
				message_id: 11,
				chat: { id: 42, type: "private" },
			},
		},
		answerCallbackQuery: async () => {},
		...overrides,
	};
}

async function startAdapter(
	handler: (event: ChannelEvent) => Promise<void> = async () => {},
): Promise<{
	readonly adapter: TelegramAdapter;
	readonly bot: FakeBot;
	readonly runner: FakeRunner;
	readonly controller: AbortController;
	readonly run: Promise<void>;
}> {
	const { adapter, bot, runner } = createAdapter();
	const controller = new AbortController();
	const run = adapter.run(handler, controller.signal);
	await Promise.resolve();

	return { adapter, bot, runner, controller, run };
}

describe("TelegramAdapter update normalization", () => {
	test("emits normalized private human text", async () => {
		const events: ChannelEvent[] = [];
		const running = await startAdapter(async (event) => {
			events.push(event);
		});

		await running.bot.emit("message:text", privateTextContext());

		expect(events).toEqual([
			{
				type: "message",
				source: {
					channel: "telegram",
					conversationId: "42",
					conversationKind: "direct",
					userId: "7",
					messageId: "9",
				},
				text: "Hello",
			},
		]);
		running.controller.abort();
		await running.run;
	});

	test.each([
		privateTextContext({ chat: { id: 42, type: "group" } }),
		privateTextContext({ chat: { id: 42, type: "channel" } }),
		privateTextContext({ from: { id: 7, is_bot: true } }),
		privateTextContext({ from: undefined }),
		privateTextContext({ message: undefined }),
		privateTextContext({ message: { message_id: 9, text: "   " } }),
	] as const)("ignores unsupported or malformed text updates", async (context) => {
		const events: ChannelEvent[] = [];
		const running = await startAdapter(async (event) => {
			events.push(event);
		});

		await running.bot.emit("message:text", context);

		expect(events).toHaveLength(0);
		running.controller.abort();
		await running.run;
	});

	test("registers only the supported text and callback update filters", async () => {
		const running = await startAdapter();

		expect(running.bot.hasHandler("message:text")).toBe(true);
		expect(running.bot.hasHandler("callback_query:data")).toBe(true);
		expect(running.bot.hasHandler("channel_post")).toBe(false);
		expect(running.bot.hasHandler("edited_message")).toBe(false);
		running.controller.abort();
		await running.run;
	});

	test("contains gateway handler failures without stopping polling", async () => {
		const running = await startAdapter(async () => {
			throw new Error("gateway failure with private message data");
		});

		await expect(
			running.bot.emit("message:text", privateTextContext()),
		).resolves.toBeUndefined();
		expect(running.runner.isRunning()).toBe(true);
		running.controller.abort();
		await running.run;
	});
});

describe("TelegramAdapter callback actions", () => {
	test("acknowledges a callback before waiting for gateway work", async () => {
		const order: string[] = [];
		const release = deferred<void>();
		const running = await startAdapter(async () => {
			order.push("handler");
			await release.promise;
		});
		const emitted = running.bot.emit(
			"callback_query:data",
			callbackContext({
				answerCallbackQuery: async () => {
					order.push("acknowledged");
				},
			}),
		);
		await Promise.resolve();

		expect(order).toEqual(["acknowledged", "handler"]);
		release.resolve(undefined);
		await emitted;
		running.controller.abort();
		await running.run;
	});

	test("emits a normalized message-backed action", async () => {
		const events: ChannelEvent[] = [];
		const running = await startAdapter(async (event) => {
			events.push(event);
		});

		await running.bot.emit("callback_query:data", callbackContext());

		expect(events).toEqual([
			{
				type: "action",
				source: {
					channel: "telegram",
					conversationId: "42",
					conversationKind: "direct",
					userId: "7",
					messageId: "11",
				},
				value: "approval:id:allow",
			},
		]);
		running.controller.abort();
		await running.run;
	});

	test("dispatches a valid action even when acknowledgement fails", async () => {
		const events: ChannelEvent[] = [];
		const running = await startAdapter(async (event) => {
			events.push(event);
		});

		await running.bot.emit(
			"callback_query:data",
			callbackContext({
				answerCallbackQuery: async () => {
					throw new Error("acknowledgement failed");
				},
			}),
		);

		expect(events).toHaveLength(1);
		running.controller.abort();
		await running.run;
	});

	test("acknowledges but ignores inline-only callbacks", async () => {
		let acknowledged = 0;
		const events: ChannelEvent[] = [];
		const running = await startAdapter(async (event) => {
			events.push(event);
		});

		await running.bot.emit(
			"callback_query:data",
			callbackContext({
				callbackQuery: { data: "approval:id:allow" },
				answerCallbackQuery: async () => {
					acknowledged += 1;
				},
			}),
		);

		expect(acknowledged).toBe(1);
		expect(events).toHaveLength(0);
		running.controller.abort();
		await running.run;
	});
});

describe("TelegramAdapter delivery", () => {
	test("sends plain text to the target conversation", async () => {
		const { adapter, bot } = createAdapter();

		await adapter.send({
			target: { channel: "telegram", conversationId: "42" },
			text: "Hello *without parsing*",
		});

		expect(bot.sends).toEqual([
			{
				chatId: "42",
				text: "Hello *without parsing*",
				options: {},
			},
		]);
	});

	test("puts reply context only on the first chunk and actions only on the last", async () => {
		const { adapter, bot } = createAdapter();
		const output: ChannelOutput = {
			target: { channel: "telegram", conversationId: "42" },
			text: "a".repeat(4_001),
			replyToMessageId: "9",
			actions: [
				{ label: "Approve", value: "approval:id:allow" },
				{ label: "Deny", value: "approval:id:deny" },
			],
		};

		await adapter.send(output);

		expect(bot.sends).toHaveLength(2);
		expect(bot.sends[0]).toMatchObject({
			chatId: "42",
			options: {
				reply_parameters: {
					message_id: 9,
					allow_sending_without_reply: true,
				},
			},
		});
		expect(bot.sends[0]?.options).not.toHaveProperty("reply_markup");
		expect(bot.sends[1]?.options).not.toHaveProperty("reply_parameters");
		expect(bot.sends[1]?.options).toMatchObject({
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Approve", callback_data: "approval:id:allow" },
						{ text: "Deny", callback_data: "approval:id:deny" },
					],
				],
			},
		});
	});

	test.each([
		undefined,
		"",
		"not-a-number",
		"0",
		"-1",
		"1.5",
	])("omits invalid reply metadata", async (replyToMessageId) => {
		const { adapter, bot } = createAdapter();

		await adapter.send({
			target: { channel: "telegram", conversationId: "42" },
			text: "Hello",
			replyToMessageId,
		});

		expect(bot.sends[0]?.options).not.toHaveProperty("reply_parameters");
	});

	test("delivers oversized Unicode text in ordered bounded chunks", async () => {
		const { adapter, bot } = createAdapter();
		const text = "🙂".repeat(8_001);

		await adapter.send({
			target: { channel: "telegram", conversationId: "42" },
			text,
		});

		expect(bot.sends.map((send) => send.text).join("")).toBe(text);
		expect(bot.sends.map((send) => Array.from(send.text).length)).toEqual([
			4_000, 4_000, 1,
		]);
	});

	test("rejects wrong-channel output without sending", async () => {
		const { adapter, bot } = createAdapter();

		await expect(
			adapter.send({
				target: { channel: "slack", conversationId: "42" },
				text: "Hello",
			}),
		).rejects.toThrow("Telegram adapter cannot send to another channel.");
		expect(bot.sends).toHaveLength(0);
	});

	test("wraps delivery failures without exposing the bot token", async () => {
		const bot = new FakeBot();
		bot.api.sendMessage = async () => {
			throw new Error(`request failed for ${config.botToken}`);
		};
		const { adapter } = createAdapter({ bot });

		try {
			await adapter.send({
				target: { channel: "telegram", conversationId: "42" },
				text: "Hello",
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ChannelDeliveryError);
			expect((error as Error).message).toBe(
				"Failed to deliver message through telegram.",
			);
			expect((error as Error).message).not.toContain(config.botToken);
		}
	});
});

describe("TelegramAdapter lifecycle", () => {
	test("aborting stops concurrent polling exactly once", async () => {
		const running = await startAdapter();

		running.controller.abort();
		running.controller.abort();
		await running.run;

		expect(running.runner.stopCount).toBe(1);
		expect(running.runner.isRunning()).toBe(false);
	});

	test("polling or authentication failure rejects run", async () => {
		const running = await startAdapter();
		const failure = new Error("authentication failed");

		running.runner.fail(failure);

		await expect(running.run).rejects.toBe(failure);
	});

	test("an adapter instance has only one lifecycle", async () => {
		const running = await startAdapter();
		running.controller.abort();
		await running.run;

		await expect(
			running.adapter.run(async () => {}, new AbortController().signal),
		).rejects.toThrow("Telegram adapter instances can only be run once.");
	});
});
