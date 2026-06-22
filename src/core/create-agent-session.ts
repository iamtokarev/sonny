import { join } from "node:path";
import { loadAgentDefinition } from "../agents/agents-loader";
import type { Config } from "../config";
import { LLMProvider } from "../providers/llm-provider";
import { buildSkillsPrompt } from "../skills/build-skills-prompt";
import { loadSkills } from "../skills/load-skills";
import { createDefaultToolRegistry } from "../tools/create-tool-registry";
import { createDefaultToolHooks } from "../tools/hooks/default-tool-hooks";
import type { PermissionHook } from "../tools/hooks/tool-hooks";
import { type ToolEventHandler, ToolExecutor } from "../tools/tool-executor";
import { createLogger } from "../utils/logger";
import { AgentSession } from "./agent-session";
import { SessionState } from "./session-state";
import { buildSystemPrompt } from "./system-prompt-builder";

export type CreateAgentSessionOptions = {
	config: Config;
	approveToolCall: PermissionHook;
	onToolEvent?: ToolEventHandler;
	skillsDirectory?: string;
};

const logger = createLogger("core.create-agent-session");

export async function createAgentSession(
	options: CreateAgentSessionOptions,
): Promise<AgentSession> {
	const agentsPath = join(options.config.workspace, options.config.agentsPath);
	const agentDefinition = await loadAgentDefinition(
		agentsPath,
		options.config.defaultAgent,
	);

	const skillsResult = options.skillsDirectory
		? await loadSkills(options.skillsDirectory)
		: { skills: [], errors: [] };

	for (const error of skillsResult.errors) {
		logger.warn("skill.load.failed", { error });
	}

	const systemPrompt = buildSystemPrompt({
		stable: [
			agentDefinition.instructions,
			buildSkillsPrompt(skillsResult.skills),
		],
	});

	const state = new SessionState();
	const llm = new LLMProvider(options.config.llm);
	const tools = createDefaultToolRegistry({
		skills: skillsResult.skills,
	});
	const hooks = createDefaultToolHooks(options.approveToolCall);
	const toolExecutor = new ToolExecutor(tools, hooks, options.onToolEvent);

	return new AgentSession(systemPrompt, state, llm, tools, toolExecutor);
}
