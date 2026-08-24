import { readFile } from "node:fs/promises";
import { parse as parseDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";

import { type ParseConfigOptions, parseConfig } from "./parse-config";
import type { Config } from "./schemas";

type EnvironmentFile = Readonly<Record<string, string | undefined>>;

async function readEnvironmentFile(path?: string): Promise<EnvironmentFile> {
	if (path === undefined) {
		return {};
	}

	try {
		return parseDotenv(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}

		throw error;
	}
}

function resolveOverrides(
	fileEnvironment: EnvironmentFile,
): ParseConfigOptions {
	return {
		llmApiKey: process.env.LLM_API_KEY ?? fileEnvironment.LLM_API_KEY,
		tavilyApiKey: process.env.TAVILY_API_KEY ?? fileEnvironment.TAVILY_API_KEY,
	};
}

/**
 * Loads config and merges with env variables
 * @param configPath - Path to YAML config
 * @param envPath - Optional path to a dotenv file
 * @returns - `Config` object
 */
export async function loadConfig(
	configPath: string,
	envPath?: string,
): Promise<Config> {
	const [source, fileEnvironment] = await Promise.all([
		readFile(configPath, "utf8"),
		readEnvironmentFile(envPath),
	]);

	return parseConfig(parseYaml(source), resolveOverrides(fileEnvironment));
}
