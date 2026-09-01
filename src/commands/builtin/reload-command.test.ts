import { describe, expect, test } from "bun:test";
import { ConfigReloadError } from "../../config";
import type { RuntimeConfigurationResult } from "../../runtime";
import type { SlashCommandContext } from "../command";
import { createReloadCommand } from "./reload-command";

function createContext(
	result: RuntimeConfigurationResult,
): SlashCommandContext {
	return {
		historySession: {
			id: "session-1",
			agentId: "sonny",
			title: "Test session",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		skills: [],
		getMessageCount: () => 0,
		getContextUsage: () => ({
			tokenCount: 0,
			contextWindowTokens: 200_000,
			thresholdTokens: 150_000,
			thresholdRatio: 0.75,
		}),
		compactContext: async () => ({
			messages: [],
			tokenCountBefore: 0,
			tokenCountAfter: 0,
			thresholdTokens: 150_000,
			changed: false,
			compactedToolResultCount: 0,
			summaryCompactedMessageCount: 0,
		}),
		reloadConfiguration: async () => result,
	};
}

describe("createReloadCommand", () => {
	test("formats an unchanged result", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "unchanged",
					revision: 2,
					info: { model: "openai/model-a", toolNames: [] },
				}),
			),
		).resolves.toEqual({
			type: "message",
			content: "Configuration is already current at revision 2.",
		});
	});

	test("formats a rebuilt runtime", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "reloaded",
					revision: 3,
					changedSections: ["llm", "web"],
					runtimeRebuilt: true,
					info: {
						model: "anthropic/model-b",
						toolNames: ["bash", "webSearch"],
					},
				}),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Configuration reloaded to revision 3. Model: anthropic/model-b. Tools: bash, webSearch.",
		});
	});

	test("formats changes that only affect future sessions", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "reloaded",
					revision: 4,
					changedSections: ["sessionDefaults"],
					runtimeRebuilt: false,
					info: { model: "openai/model-a", toolNames: [] },
				}),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Configuration reloaded to revision 4. Changes apply to future sessions.",
		});
	});

	test("requires a gateway restart for channel changes", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "reloaded",
					revision: 5,
					changedSections: ["channels"],
					runtimeRebuilt: false,
					info: { model: "openai/model-a", toolNames: [] },
				}),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Configuration reloaded to revision 5. Channel changes require gateway restart.",
		});
	});

	test("includes the gateway restart notice when runtime settings also change", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "reloaded",
					revision: 6,
					changedSections: ["llm", "channels"],
					runtimeRebuilt: true,
					info: {
						model: "anthropic/model-b",
						toolNames: ["bash"],
					},
				}),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Configuration reloaded to revision 6. Model: anthropic/model-b. Tools: bash. Channel changes require gateway restart.",
		});
	});

	test("formats a rejected reload with the retained revision", async () => {
		const command = createReloadCommand();

		await expect(
			command.execute(
				"",
				createContext({
					status: "rejected",
					retainedRevision: 4,
					phase: "load",
					error: new ConfigReloadError("Configuration is invalid."),
				}),
			),
		).resolves.toEqual({
			type: "message",
			content:
				"Configuration reload failed. Continuing with revision 4. Configuration is invalid.",
		});
	});
});
