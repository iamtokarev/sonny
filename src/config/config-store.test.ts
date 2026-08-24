import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "./config-store";

const originalLlmApiKey = process.env.LLM_API_KEY;
const originalTavilyApiKey = process.env.TAVILY_API_KEY;

beforeEach(() => {
	delete process.env.LLM_API_KEY;
	delete process.env.TAVILY_API_KEY;
});

afterEach(() => {
	if (originalLlmApiKey !== undefined) {
		process.env.LLM_API_KEY = originalLlmApiKey;
	}

	if (originalTavilyApiKey !== undefined) {
		process.env.TAVILY_API_KEY = originalTavilyApiKey;
	}
});

function configSource(model = "openai/model-a"): string {
	return [
		"llm:",
		`  model: ${model}`,
		"  apiKey: test-key",
		"defaultAgent: sonny",
	].join("\n");
}

async function createStoreFiles(): Promise<{
	configPath: string;
	envPath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "sonny-config-store-"));
	const configPath = join(directory, "config.yaml");
	const envPath = join(directory, ".env");
	await writeFile(configPath, configSource());
	await writeFile(envPath, "");
	return { configPath, envPath };
}

describe("ConfigStore", () => {
	test("opens with an immutable revision one snapshot", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);

		expect(store.current.revision).toBe(1);
		expect(store.current.config.llm.model).toBe("openai/model-a");
		expect(Object.isFrozen(store.current.config)).toBe(true);
		expect(Object.isFrozen(store.current.config.llm)).toBe(true);
	});

	test("increments revisions only for semantic changes", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);
		const original = store.current;

		await writeFile(paths.configPath, `${configSource()}\n# comment\n`);
		const equivalent = await store.refresh({ force: true });

		expect(equivalent.status).toBe("unchanged");
		expect(store.current).toBe(original);

		await writeFile(paths.configPath, configSource("openai/model-b"));
		const changed = await store.refresh({ force: true });

		expect(changed).toMatchObject({
			status: "reloaded",
			changedSections: ["llm"],
		});
		expect(store.current.revision).toBe(2);
		expect(store.current.config.llm.model).toBe("openai/model-b");
	});

	test("detects changed source fingerprints without a forced read", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);
		await writeFile(paths.configPath, configSource("openai/model-much-longer"));

		const changed = await store.refresh();

		expect(changed.status).toBe("reloaded");
		expect(store.current.config.llm.model).toBe("openai/model-much-longer");
	});

	test("retains the last valid snapshot after an invalid edit", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);
		const original = store.current;

		await writeFile(
			paths.configPath,
			"llm:\n  model: openai/model-b\n  apiKey: exposed-secret\n  temperature: invalid\n",
		);
		const rejected = await store.refresh({ force: true });

		expect(rejected.status).toBe("rejected");
		expect(
			rejected.status === "rejected" && rejected.error.message,
		).not.toContain("exposed-secret");
		expect(store.current).toBe(original);
	});

	test("detects env creation, changes, and deletion", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);

		await writeFile(paths.envPath, "LLM_API_KEY=file-key\n");
		const added = await store.refresh({ force: true });
		expect(added.status).toBe("reloaded");
		expect(store.current.config.llm.apiKey).toBe("file-key");

		await writeFile(paths.envPath, "LLM_API_KEY=next-key\n");
		await store.refresh({ force: true });
		expect(store.current.config.llm.apiKey).toBe("next-key");

		await unlink(paths.envPath);
		await store.refresh({ force: true });
		expect(store.current.config.llm.apiKey).toBe("test-key");
	});

	test("serializes concurrent refreshes", async () => {
		const paths = await createStoreFiles();
		const store = await ConfigStore.open(paths);
		await writeFile(paths.configPath, configSource("openai/model-b"));

		const results = await Promise.all([
			store.refresh({ force: true }),
			store.refresh({ force: true }),
		]);

		expect(
			results.filter((result) => result.status === "reloaded"),
		).toHaveLength(1);
		expect(store.current.revision).toBe(2);
	});
});
