import { join } from "node:path";
import { Command } from "commander";
import { config } from "../config";
import { createAgentSession } from "../runtime";
import { configureLogger, createLogger } from "../utils/logger";
import { ChatLoop } from "./chat-loop";
import {
	type ChatCommandOptions,
	type ChatSessionSelection,
	resolveChatSessionSelection,
} from "./chat-options";

configureLogger({
	logDir: join(process.cwd(), "logs"),
	level: "debug",
});

const logger = createLogger("cli.main");
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
		let sessionSelection: ChatSessionSelection;

		try {
			sessionSelection = resolveChatSessionSelection(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
			return;
		}

		logger.info("chat.command.started", sessionSelection);

		const chatLoop = new ChatLoop((approveToolCall, onToolEvent) =>
			createAgentSession({
				config,
				approveToolCall,
				onToolEvent,
				skillsDirectory: join(config.workspace, "skills"),
				...sessionSelection,
			}),
		);

		await chatLoop.run();
	});

await program.parseAsync();
