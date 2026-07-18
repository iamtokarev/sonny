import { config as loadEnv } from "dotenv";
import YAML from "yaml";

import { parseConfig } from "./parse-config";
import type { Config } from "./schemas";

loadEnv();

/**
 * Loads config and merges with env variables
 * @param path - Path to yaml config
 * @returns - `Config` object
 */
export async function loadConfig(path: string): Promise<Config> {
	const configFile = await Bun.file(path).text();
	const yamlConfig = YAML.parse(configFile);

	return parseConfig(yamlConfig, {
		llmApiKey: process.env.LLM_API_KEY,
		tavilyApiKey: process.env.TAVILY_API_KEY,
	});
}
