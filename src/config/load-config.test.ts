import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./load-config";

const originalLlmApiKey = process.env.LLM_API_KEY;
const originalTavilyApiKey = process.env.TAVILY_API_KEY;

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
		].join("\n"),
	);
	await writeFile(envPath, environment);

	return { configPath, envPath };
}

describe("loadConfig", () => {
	test("uses process environment before the env file and YAML", async () => {
		process.env.LLM_API_KEY = "process-key";
		process.env.TAVILY_API_KEY = "process-tavily-key";
		const paths = await createConfigFiles(
			"LLM_API_KEY=file-key\nTAVILY_API_KEY=file-tavily-key\n",
		);

		const config = await loadConfig(paths.configPath, paths.envPath);

		expect(config.llm.apiKey).toBe("process-key");
		expect(config.tavilyApiKey).toBe("process-tavily-key");
	});

	test("loads OpenRouter settings and env file overrides without mutation", async () => {
		delete process.env.LLM_API_KEY;
		delete process.env.TAVILY_API_KEY;
		const paths = await createConfigFiles(
			"LLM_API_KEY=file-key\nTAVILY_API_KEY=file-tavily-key\n",
		);

		const config = await loadConfig(paths.configPath, paths.envPath);

		expect(config.llm).toMatchObject({
			model: "openai/gpt-test",
			apiKey: "file-key",
			maxTokens: 4096,
			reasoningEffort: "high",
		});
		expect(config.tavilyApiKey).toBe("file-tavily-key");
		expect(process.env.LLM_API_KEY).toBeUndefined();
		expect(process.env.TAVILY_API_KEY).toBeUndefined();
	});

	test("accepts a missing optional env file", async () => {
		delete process.env.LLM_API_KEY;
		const { configPath } = await createConfigFiles();

		const config = await loadConfig(
			configPath,
			join(tmpdir(), `missing-sonny-env-${crypto.randomUUID()}`),
		);

		expect(config.llm.apiKey).toBe("yaml-key");
	});
});
