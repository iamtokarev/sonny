import { join } from "node:path";
import { Command } from "commander";
import { config } from "../config";
import { createAgentSession } from "../core/create-agent-session";
import { configureLogger, createLogger } from "../utils/logger";
import { ChatLoop } from "./chat-loop";

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
	.action(async () => {
		logger.info("chat.command.started");

		const chatLoop = new ChatLoop((approveToolCall, onToolEvent) =>
			createAgentSession({
				config,
				approveToolCall,
				onToolEvent,
				skillsDirectory: join(config.workspace, "skills"),
			}),
		);

		await chatLoop.run();
	});

await program.parseAsync();
