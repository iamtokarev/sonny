import { join } from "node:path";
import { Command } from "commander";
import { ConfigStore, DEFAULT_CONFIG_PATH, DEFAULT_ENV_PATH } from "../config";
import { InMemoryRuntimeEventBus } from "../events";
import { createAgentSession, type RuntimeConfigStore } from "../runtime";
import { configureLogger, createLogger } from "../utils/logger";
import { ChatLoop } from "./chat-loop";
import {
	type ChatCommandOptions,
	type ChatSessionSelection,
	resolveChatSessionSelection,
} from "./chat-options";
import { runGatewayCommand } from "./gateway-command";

configureLogger({
	logDir: join(process.cwd(), "logs"),
	level: "debug",
});

const logger = createLogger("cli.main");

export interface CreateProgramDependencies {
	readonly runGateway: (options: {
		readonly configStore: RuntimeConfigStore;
	}) => Promise<void>;
}

const defaultDependencies: CreateProgramDependencies = {
	runGateway: runGatewayCommand,
};

export function createProgram(
	configStore: RuntimeConfigStore,
	dependencies: Partial<CreateProgramDependencies> = {},
): Command {
	const resolvedDependencies = { ...defaultDependencies, ...dependencies };
	const program = new Command();

	program
		.name("Sonny")
		.description("Your personal lightweight assistant")
		.version("0.1.0");

	program
		.command("chat")
		.description("Start an interactive chat session")
		.option("--resume <session-id>", "Resume a previous chat session")
		.option("--continue", "Continue the latest non-empty chat session")
		.action(async (options: ChatCommandOptions) => {
			const sessionSelection: ChatSessionSelection =
				resolveChatSessionSelection(options);

			logger.info("chat.command.started", sessionSelection);

			const eventBus = new InMemoryRuntimeEventBus();
			const chatLoop = new ChatLoop(eventBus, (approveToolCall) =>
				createAgentSession({
					configStore,
					approveToolCall,
					events: eventBus,
					...sessionSelection,
				}),
			);

			await chatLoop.run();
		});

	program
		.command("gateway")
		.description("Run configured messaging channels")
		.action(async () => {
			await resolvedDependencies.runGateway({ configStore });
		});

	return program;
}

export async function main(): Promise<void> {
	const configStore = await ConfigStore.open({
		configPath: DEFAULT_CONFIG_PATH,
		envPath: DEFAULT_ENV_PATH,
	});
	const program = createProgram(configStore);

	await program.parseAsync();
}
