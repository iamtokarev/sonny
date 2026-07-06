import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadAgentDefinition } from "../agents/agents-loader";
import type { Config } from "../config";
import { LLMProvider } from "../providers/llm-provider";
import { buildSkillsPrompt } from "../skills/build-skills-prompt";
import { loadSkills } from "../skills/load-skills";
import type { Skill } from "../skills/skill";
import { createDefaultToolRegistry } from "../tools/create-tool-registry";
import { createDefaultToolHooks } from "../tools/hooks/default-tool-hooks";
import type { PermissionHook } from "../tools/hooks/tool-hooks";
import { type ToolEventHandler, ToolExecutor } from "../tools/tool-executor";
import { createLogger } from "../utils/logger";
import { AgentSession } from "./agent-session";
import { ContextManager } from "./context-manager";
import { HistoryRecorder } from "./history-recorder";
import { type HistorySession, HistoryStore } from "./history-store";
import { LlmContextSummarizer } from "./llm-context-summarizer";
import type { ChatMessage } from "./message";
import { SessionState } from "./session-state";
import { buildSystemPrompt } from "./system-prompt-builder";
import { GptTokenizerTokenCounter } from "./token-counter";

export type CreateAgentSessionMode = "new" | "resume" | "continue";

export type CreateAgentSessionResult = {
	session: AgentSession;
	historySession: HistorySession;
	restoredMessageCount: number;
	restoredMessages: ChatMessage[];
	skills: Skill[];
	mode: CreateAgentSessionMode;
};

export type CreateAgentSessionOptions = {
	config: Config;
	approveToolCall: PermissionHook;
	onToolEvent?: ToolEventHandler;
	skillsDirectory?: string;
	resumeSessionId?: string;
	continueLatest?: boolean;
};

const logger = createLogger("core.create-agent-session");

export async function createAgentSession(
	options: CreateAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
	if (options.resumeSessionId && options.continueLatest) {
		throw new Error("Use either resumeSessionId or continueLatest, not both.");
	}

	const skillsResult = options.skillsDirectory
		? await loadSkills(options.skillsDirectory)
		: { skills: [], errors: [] };

	for (const error of skillsResult.errors) {
		logger.warn("skill.load.failed", { error });
	}

	const historyStore = new HistoryStore(
		join(options.config.workspace, ".history"),
	);
	let mode: CreateAgentSessionMode = "new";
	let historySession: HistorySession;
	let restoredMessages: ChatMessage[] = [];

	if (options.resumeSessionId) {
		mode = "resume";
		const existingSession = historyStore.getSession(options.resumeSessionId);
		if (existingSession === undefined) {
			throw new Error(`Session not found: ${options.resumeSessionId}`);
		}
		historySession = existingSession;
		restoredMessages = historyStore.readMessages(historySession.id);
	} else if (options.continueLatest) {
		mode = "continue";
		const latestSession = historyStore.getLatestSession();
		if (latestSession === undefined) {
			throw new Error("No previous session found to continue");
		}
		historySession = latestSession;
		restoredMessages = historyStore.readMessages(historySession.id);
	} else {
		const agentsPath = join(
			options.config.workspace,
			options.config.agentsPath,
		);
		const agentDefinition = await loadAgentDefinition(
			agentsPath,
			options.config.defaultAgent,
		);
		const systemPrompt = buildSystemPrompt({
			stable: [
				agentDefinition.instructions,
				buildSkillsPrompt(skillsResult.skills),
			],
		});
		historySession = historyStore.createSession({
			id: randomUUID(),
			agentId: options.config.defaultAgent,
			systemPrompt,
		});
	}

	const systemPrompt = historySession.systemPrompt;
	const restoredMessageCount = restoredMessages.length;
	const historyRecorder = new HistoryRecorder(historyStore, historySession.id, {
		flushedMessageCount: restoredMessageCount,
	});

	const state = new SessionState({
		initialMessages: restoredMessages,
	});
	const llm = new LLMProvider(options.config.llm);
	const tools = createDefaultToolRegistry({
		skills: skillsResult.skills,
	});
	const hooks = createDefaultToolHooks(options.approveToolCall);
	const toolExecutor = new ToolExecutor(tools, hooks, options.onToolEvent);
	const contextManager = new ContextManager({
		tokenCounter: new GptTokenizerTokenCounter(),
		summarizer: new LlmContextSummarizer(llm),
		...options.config.contextCompaction,
	});

	return {
		session: new AgentSession(
			systemPrompt,
			state,
			llm,
			tools,
			toolExecutor,
			historyRecorder,
			contextManager,
		),
		historySession,
		restoredMessageCount,
		restoredMessages,
		skills: skillsResult.skills,
		mode,
	};
}
