import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config";
import { AgentSession } from "./agent-session";
import { createAgentSession } from "./create-agent-session";

describe("createAgentSession", () => {
	async function createTestConfig(): Promise<Config> {
		const workspace = await mkdtemp(join(tmpdir(), "sonny-session-"));
		const agentPath = join(workspace, "agents", "sonny");

		await mkdir(agentPath, { recursive: true });
		await writeFile(
			join(agentPath, "AGENT.md"),
			`---
name: Sonny
description: Test assistant
---
You are Sonny.
`,
		);

		return {
			workspace,
			defaultAgent: "sonny",
			agentsPath: "agents",
			llm: {
				provider: "openai",
				model: "gpt-test",
				apiKey: "test-key",
				apiBase: null,
				temperature: 0.7,
				maxTokens: 2048,
			},
		};
	}

	test("creates an agent session from config", async () => {
		const config = await createTestConfig();

		const session = await createAgentSession({
			config,
			approveToolCall: async () => ({
				approved: true,
			}),
		});

		expect(session).toBeInstanceOf(AgentSession);
	});

	test("accepts a tool event callback", async () => {
		const config = await createTestConfig();

		const session = await createAgentSession({
			config,
			approveToolCall: async () => ({
				approved: true,
			}),
			onToolEvent: () => {},
		});

		expect(session).toBeInstanceOf(AgentSession);
	});
});
