import type { SlashCommand } from "../command";

export function createNewSessionCommand(): SlashCommand {
	return {
		name: "new",
		description: "Start a fresh session and preserve previous history.",
		aliases: ["reset"],
		usage: "/new",
		channelControl: (args) => (args.length === 0 ? "new-session" : undefined),
		execute: (args) =>
			args.length === 0
				? { type: "channel-control", intent: "new-session" }
				: { type: "message", content: "Usage: /new" },
	};
}
