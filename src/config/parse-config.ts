import { z } from "zod";

import { type Config, ConfigSchema } from "./schemas";

type UnknownRecord = Record<string, unknown>;

export type ParseConfigOptions = {
	llmApiKey?: string;
	tavilyApiKey?: string;
	telegramBotToken?: string;
};

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyEnvOverrides(
	data: unknown,
	options: ParseConfigOptions,
): unknown {
	if (
		(!options.llmApiKey &&
			!options.tavilyApiKey &&
			!options.telegramBotToken) ||
		!isRecord(data)
	) {
		return data;
	}

	const llm = isRecord(data.llm) ? data.llm : {};
	const channels = isRecord(data.channels) ? data.channels : {};
	const telegram = isRecord(channels.telegram) ? channels.telegram : {};

	return {
		...data,
		channels: {
			...channels,
			telegram: {
				...telegram,
				...(options.telegramBotToken
					? { botToken: options.telegramBotToken }
					: {}),
			},
		},
		...(options.tavilyApiKey ? { tavilyApiKey: options.tavilyApiKey } : {}),
		llm: {
			...llm,
			...(options.llmApiKey ? { apiKey: options.llmApiKey } : {}),
		},
	};
}

/**
 * Parses config
 * @param data - provided configuration to be parse
 * @returns - Config object
 */
export function parseConfig(
	data: unknown,
	options: ParseConfigOptions = {},
): Config {
	const result = ConfigSchema.safeParse(applyEnvOverrides(data, options));

	if (!result.success) {
		const formattedError = JSON.stringify(
			z.treeifyError(result.error),
			null,
			2,
		);

		throw new Error(`Invalid configuration:\n${formattedError}`);
	}

	return result.data;
}
