import { describe, expect, test } from "bun:test";
import { parseConfig } from "../config";
import type { RuntimeConfigStore } from "../runtime";
import { createProgram } from "./main";

function createConfigStore(): RuntimeConfigStore {
	const snapshot = {
		revision: 1,
		loadedAt: new Date("2026-01-01T00:00:00.000Z"),
		config: parseConfig({
			workspace: "/tmp/sonny-main-test",
			llm: { model: "openai/model-a", apiKey: "test-key" },
			defaultAgent: "sonny",
		}),
	};

	return {
		current: snapshot,
		refresh: async () => ({ status: "unchanged", snapshot }),
	};
}

describe("createProgram", () => {
	test("registers the gateway command with the active config store", async () => {
		const configStore = createConfigStore();
		const received: RuntimeConfigStore[] = [];
		const program = createProgram(configStore, {
			runGateway: async (options) => {
				received.push(options.configStore);
			},
		});

		await program.parseAsync(["node", "sonny", "gateway"]);

		expect(received).toEqual([configStore]);
	});
});
