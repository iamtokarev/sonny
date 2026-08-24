import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tavily } from "@tavily/core";
import { AgentSession, buildSystemPrompt, SessionState } from "../agent";
import { loadAgentDefinition } from "../agents/agents-loader";
import {
	ContextManager,
	LlmContextSummarizer,
	RoughTokenCounter,
} from "../context";
import type { ChatMessage } from "../domain";
import type { RuntimeEventPublisher } from "../events";
import { HistoryRecorder, type HistorySession, HistoryStore } from "../history";
import { LLMProvider } from "../llm";
import { buildSkillsPrompt } from "../skills/build-skills-prompt";
import { loadSkills } from "../skills/load-skills";
import type { Skill } from "../skills/skill";
import { createDefaultToolRegistry } from "../tools/create-tool-registry";
import { createDefaultToolHooks } from "../tools/hooks/default-tool-hooks";
import type { PermissionHook } from "../tools/hooks/tool-hooks";
import { ToolExecutor } from "../tools/tool-executor";
import { createLogger } from "../utils/logger";
import { TavilyWebProvider } from "../web/tavily-web-provider";
import { AgentRuntime } from "./agent-runtime";
import {
	type AgentSessionBuilder,
	ReloadableAgentSession,
	type RuntimeConfigStore,
} from "./reloadable-agent-session";

export type CreateAgentSessionMode = "new" | "resume" | "continue";

export type CreateAgentSessionResult = {
	runtime: AgentRuntime;
	historySession: HistorySession;
	restoredMessageCount: number;
	restoredMessages: ChatMessage[];
	skills: Skill[];
	mode: CreateAgentSessionMode;
	/** Which tools this session actually got — web tools need an API key. */
	toolNames: string[];
	model: string;
};

export type CreateAgentSessionOptions = {
	configStore: RuntimeConfigStore;
	approveToolCall: PermissionHook;
	events: RuntimeEventPublisher;
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

	const initialRefresh = await options.configStore.refresh();
	if (initialRefresh.status === "rejected") {
		logger.warn("config.refresh.rejected", {
			errorName: initialRefresh.error.name,
			errorMessage: initialRefresh.error.message,
		});
	}

	const initialSnapshot = options.configStore.current;
	const initialConfig = initialSnapshot.config;
	const skillsResult = await loadSkills(
		join(initialConfig.workspace, "skills"),
	);

	for (const error of skillsResult.errors) {
		logger.warn("skill.load.failed", { error });
	}

	const historyStore = new HistoryStore(
		join(initialConfig.workspace, ".history"),
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
		const agentsPath = join(initialConfig.workspace, initialConfig.agentsPath);
		const agentDefinition = await loadAgentDefinition(
			agentsPath,
			initialConfig.defaultAgent,
		);
		const systemPrompt = buildSystemPrompt({
			stable: [
				agentDefinition.instructions,
				buildSkillsPrompt(skillsResult.skills),
			],
		});
		historySession = historyStore.createSession({
			id: randomUUID(),
			agentId: initialConfig.defaultAgent,
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

	const buildSession: AgentSessionBuilder = (config) => {
		const llm = new LLMProvider(config.llm);
		const webProvider = config.tavilyApiKey
			? new TavilyWebProvider(tavily({ apiKey: config.tavilyApiKey }))
			: undefined;
		const tools = createDefaultToolRegistry({
			skills: skillsResult.skills,
			webSearchProvider: webProvider,
			webReadProvider: webProvider,
		});
		const hooks = createDefaultToolHooks(options.approveToolCall);
		const toolExecutor = new ToolExecutor(tools, hooks);
		const contextManager = new ContextManager({
			tokenCounter: new RoughTokenCounter(),
			summarizer: new LlmContextSummarizer(llm),
			...config.contextCompaction,
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
			info: {
				model: config.llm.model,
				toolNames: tools.list().map((tool) => tool.name),
			},
		};
	};

	const initial = buildSession(initialConfig);
	const reloadableSession = new ReloadableAgentSession(
		options.configStore,
		buildSession,
		initialSnapshot,
		initial,
	);

	const runtime = new AgentRuntime({
		sessionId: historySession.id,
		session: reloadableSession,
		events: options.events,
	});

	return {
		runtime,
		historySession,
		restoredMessageCount,
		restoredMessages,
		toolNames: [...initial.info.toolNames],
		model: initial.info.model,
		skills: skillsResult.skills,
		mode,
	};
}
