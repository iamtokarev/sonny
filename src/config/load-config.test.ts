import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./load-config";

const originalLlmApiKey = process.env.LLM_API_KEY;
const originalTavilyApiKey = process.env.TAVILY_API_KEY;
const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

afterEach(() => {
	if (originalLlmApiKey === undefined) {
		delete process.env.LLM_API_KEY;
	} else {
		process.env.LLM_API_KEY = originalLlmApiKey;
	}

	if (originalTavilyApiKey === undefined) {
		delete process.env.TAVILY_API_KEY;
	} else {
		process.env.TAVILY_API_KEY = originalTavilyApiKey;
	}

	if (originalTelegramBotToken === undefined) {
		delete process.env.TELEGRAM_BOT_TOKEN;
	} else {
		process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
	}
});

async function createConfigFiles(environment = ""): Promise<{
	configPath: string;
	envPath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "sonny-load-config-"));
	const configPath = join(directory, "config.yaml");
	const envPath = join(directory, ".env");

	await writeFile(
		configPath,
		[
			"llm:",
			"  model: openai/gpt-test",
			"  apiKey: yaml-key",
			"  maxTokens: 4096",
			"  reasoningEffort: high",
			"defaultAgent: sonny",
			"channels:",
			"  telegram:",
			"    enabled: true",
			"    botToken: yaml-telegram-token",
			'    allowedUserIds: ["123"]',
		].join("\n"),
	);
	await writeFile(envPath, environment);

	return { configPath, envPath };
}

describe("loadConfig", () => {
	test("uses process environment before the env file and YAML", async () => {
		process.env.LLM_API_KEY = "process-key";
		process.env.TAVILY_API_KEY = "process-tavily-key";
		process.env.TELEGRAM_BOT_TOKEN = "process-telegram-token";
		const paths = await createConfigFiles(
			"LLM_API_KEY=file-key\nTAVILY_API_KEY=file-tavily-key\nTELEGRAM_BOT_TOKEN=file-telegram-token\n",
		);

		const config = await loadConfig(paths.configPath, paths.envPath);

		expect(config.llm.apiKey).toBe("process-key");
		expect(config.tavilyApiKey).toBe("process-tavily-key");
		expect(config.channels.telegram.botToken).toBe("process-telegram-token");
	});

	test("loads OpenRouter settings and env file overrides without mutation", async () => {
		delete process.env.LLM_API_KEY;
		delete process.env.TAVILY_API_KEY;
		delete process.env.TELEGRAM_BOT_TOKEN;
		const paths = await createConfigFiles(
			"LLM_API_KEY=file-key\nTAVILY_API_KEY=file-tavily-key\nTELEGRAM_BOT_TOKEN=file-telegram-token\n",
		);

		const config = await loadConfig(paths.configPath, paths.envPath);

		expect(config.llm).toMatchObject({
			model: "openai/gpt-test",
			apiKey: "file-key",
			maxTokens: 4096,
			reasoningEffort: "high",
		});
		expect(config.tavilyApiKey).toBe("file-tavily-key");
		expect(config.channels.telegram.botToken).toBe("file-telegram-token");
		expect(process.env.LLM_API_KEY).toBeUndefined();
		expect(process.env.TAVILY_API_KEY).toBeUndefined();
		expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined();
	});

	test("accepts a missing optional env file", async () => {
		delete process.env.LLM_API_KEY;
		delete process.env.TELEGRAM_BOT_TOKEN;
		const { configPath } = await createConfigFiles();

		const config = await loadConfig(
			configPath,
			join(tmpdir(), `missing-sonny-env-${crypto.randomUUID()}`),
		);

		expect(config.llm.apiKey).toBe("yaml-key");
	});
});
