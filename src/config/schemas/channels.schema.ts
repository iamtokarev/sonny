import { z } from "zod";

export const TelegramChannelConfigSchema = z
	.object({
		enabled: z.boolean().default(false),
		botToken: z.string().min(1).optional(),
		allowedUserIds: z.array(z.string().min(1)).default([]),
	})
	.superRefine((value, context) => {
		if (!value.enabled) {
			return;
		}

		if (value.botToken === undefined) {
			context.addIssue({
				code: "custom",
				path: ["botToken"],
				message: "TELEGRAM_BOT_TOKEN is required when Telegram is enabled.",
			});
		}

		if (value.allowedUserIds.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["allowedUserIds"],
				message: "At least one Telegram user must be allowed.",
			});
		}
	});

export const ChannelsConfigSchema = z.object({
	telegram: TelegramChannelConfigSchema.default({
		enabled: false,
		allowedUserIds: [],
	}),
});

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
export type TelegramChannelConfig = z.infer<typeof TelegramChannelConfigSchema>;
