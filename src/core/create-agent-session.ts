import { join } from "node:path";
import { loadAgentDefinition } from "../agents/agents-loader";
import type { Config } from "../config";
import { LLMProvider } from "../providers/llm-provider";
import { createDefaultToolRegistry } from "../tools/create-tool-registry";
import { type ToolApprover, ToolExecutor } from "../tools/tool-executor";
import { AgentSession } from "./agent-session";
import { SessionState } from "./session-state";

export async function createAgentSession(
	config: Config,
	approveToolCall: ToolApprover,
): Promise<AgentSession> {
	const agentsPath = join(config.workspace, config.agentsPath);
	const agent = await loadAgentDefinition(agentsPath, config.defaultAgent);

	const state = new SessionState(agent);
	const llm = new LLMProvider(config.llm);
	const tools = createDefaultToolRegistry();
	const toolExecutor = new ToolExecutor(tools, approveToolCall);

	return new AgentSession(state, llm, tools, toolExecutor);
}
