import { type RunnerHandle, run } from "@grammyjs/runner";
import { Bot, type Context, type Filter, InlineKeyboard } from "grammy";
import type { TelegramChannelConfig } from "../../config";
import { createLogger } from "../../utils/logger";
import type {
	ChannelAction,
	ChannelAdapter,
	ChannelConversationKind,
	ChannelEvent,
	ChannelEventHandler,
	ChannelOutput,
	ChannelSource,
} from "../channel";
import { ChannelDeliveryError } from "../channel-errors";
import { splitTelegramText } from "./telegram-text";

const logger = createLogger("channels.telegram");

type TelegramTextContext = Filter<Context, "message:text">;
type TelegramCallbackContext = Filter<Context, "callback_query:data">;
type StartTelegramRunner = (bot: Bot) => RunnerHandle;

export type EnabledTelegramChannelConfig = TelegramChannelConfig & {
	readonly enabled: true;
	readonly botToken: string;
};

function conversationKind(type: string): ChannelConversationKind | undefined {
	if (type === "private") {
		return "direct";
	}

	if (type === "group" || type === "supergroup") {
		return "group";
	}

	if (type === "channel") {
		return "channel";
	}

	return undefined;
}

function toTelegramSource(context: TelegramTextContext): ChannelSource | null {
	const chat = context.chat;
	const from = context.from;
	const message = context.message;

	if (
		chat?.type !== "private" ||
		from === undefined ||
		from.is_bot ||
		typeof message?.text !== "string" ||
		message.text.trim().length === 0
	) {
		return null;
	}

	return {
		channel: "telegram",
		conversationId: String(chat.id),
		conversationKind: "direct",
		userId: String(from.id),
		messageId: String(message.message_id),
	};
}

function toTelegramCallbackSource(
	context: TelegramCallbackContext,
): ChannelSource | null {
	const callback = context.callbackQuery;
	const message = callback?.message;
	const from = context.from;
	const kind = message ? conversationKind(message.chat.type) : undefined;

	if (
		message === undefined ||
		from === undefined ||
		kind === undefined ||
		typeof callback?.data !== "string"
	) {
		return null;
	}

	return {
		channel: "telegram",
		conversationId: String(message.chat.id),
		conversationKind: kind,
		userId: String(from.id),
		messageId: String(message.message_id),
	};
}

function buildInlineKeyboard(
	actions: readonly ChannelAction[] | undefined,
): InlineKeyboard | undefined {
	return actions?.reduce(
		(keyboard, action) => keyboard.text(action.label, action.value),
		new InlineKeyboard(),
	);
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "Error";
}

export class TelegramAdapter implements ChannelAdapter {
	readonly name = "telegram";
	private hasRun = false;

	constructor(
		config: EnabledTelegramChannelConfig,
		private readonly bot: Bot = new Bot(config.botToken),
		private readonly startRunner: StartTelegramRunner = run,
	) {}

	async run(handler: ChannelEventHandler, signal: AbortSignal): Promise<void> {
		if (this.hasRun) {
			throw new Error("Telegram adapter instances can only be run once.");
		}
		this.hasRun = true;

		this.bot.on("message:text", async (context) => {
			const source = toTelegramSource(context);

			if (source === null) {
				return;
			}

			await this.dispatch(handler, {
				type: "message",
				source,
				text: context.message.text,
			});
		});

		this.bot.on("callback_query:data", async (context) => {
			try {
				await context.answerCallbackQuery();
			} catch (error) {
				logger.warn("telegram.callback.answer_failed", {
					errorName: errorName(error),
				});
			}

			const source = toTelegramCallbackSource(context);

			if (source === null) {
				return;
			}

			await this.dispatch(handler, {
				type: "action",
				source,
				value: context.callbackQuery.data,
			});
		});

		const runner = this.startRunner(this.bot);
		let stopPromise: Promise<void> | undefined;
		const stop = () => {
			if (stopPromise === undefined && runner.isRunning()) {
				stopPromise = runner.stop();
				void stopPromise.catch(() => {});
			}

			return stopPromise;
		};

		if (signal.aborted) {
			stop();
		} else {
			signal.addEventListener("abort", stop, { once: true });
		}

		try {
			await runner.task();
		} finally {
			signal.removeEventListener("abort", stop);
			await stop();
		}
	}

	async send(output: ChannelOutput): Promise<void> {
		if (output.target.channel !== this.name) {
			throw new Error("Telegram adapter cannot send to another channel.");
		}

		const chunks = splitTelegramText(output.text);

		try {
			for (const [index, chunk] of chunks.entries()) {
				const isFirst = index === 0;
				const isLast = index === chunks.length - 1;
				const keyboard = isLast
					? buildInlineKeyboard(output.actions)
					: undefined;
				const replyMessageId = Number(output.replyToMessageId);
				const replyParameters =
					isFirst &&
					output.replyToMessageId !== undefined &&
					output.replyToMessageId.trim().length > 0 &&
					Number.isSafeInteger(replyMessageId) &&
					replyMessageId > 0
						? {
								message_id: replyMessageId,
								allow_sending_without_reply: true,
							}
						: undefined;

				await this.bot.api.sendMessage(output.target.conversationId, chunk, {
					...(keyboard === undefined ? {} : { reply_markup: keyboard }),
					...(replyParameters === undefined
						? {}
						: { reply_parameters: replyParameters }),
				});
			}
		} catch (cause) {
			throw new ChannelDeliveryError(this.name, { cause });
		}
	}

	private async dispatch(
		handler: ChannelEventHandler,
		event: ChannelEvent,
	): Promise<void> {
		try {
			await handler(event);
		} catch (error) {
			logger.error("telegram.message.failed", {
				eventType: event.type,
				errorName: errorName(error),
			});
		}
	}
}
