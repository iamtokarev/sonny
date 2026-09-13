import type { RuntimeConfigurationResult } from "../../runtime";
import type { SlashCommand } from "../command";

function formatReloadResult(result: RuntimeConfigurationResult): string {
	switch (result.status) {
		case "unchanged":
			return `Configuration is already current at revision ${result.revision}.`;

		case "reloaded":
			if (result.changedSections.includes("channels")) {
				const channelRestartNotice = "Channel changes require gateway restart.";

				if (!result.runtimeRebuilt) {
					return `Configuration reloaded to revision ${result.revision}. ${channelRestartNotice}`;
				}

				return [
					`Configuration reloaded to revision ${result.revision}.`,
					`Model: ${result.info.model}.`,
					`Tools: ${result.info.toolNames.join(", ")}.`,
					channelRestartNotice,
				].join(" ");
			}

			if (result.runtimeRebuilt) {
				return [
					`Configuration reloaded to revision ${result.revision}.`,
					`Model: ${result.info.model}.`,
					`Tools: ${result.info.toolNames.join(", ")}.`,
				].join(" ");
			}

			return `Configuration reloaded to revision ${result.revision}. Changes apply to future sessions.`;

		case "rejected":
			return `Configuration reload failed. Continuing with revision ${result.retainedRevision}. ${result.error.message}`;
	}
}

export function createReloadCommand(): SlashCommand {
	return {
		name: "reload",
		description: "Reload configuration files.",
		execute: async (_args, context) => ({
			type: "message",
			content: formatReloadResult(await context.reloadConfiguration()),
		}),
	};
}
