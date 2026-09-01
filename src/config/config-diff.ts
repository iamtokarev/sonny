import type { Config } from "./schemas";

export type ConfigSection =
	| "llm"
	| "contextCompaction"
	| "web"
	| "channels"
	| "sessionDefaults";

export function diffConfigSections(
	previous: Config,
	next: Config,
): ConfigSection[] {
	const changed: ConfigSection[] = [];

	if (JSON.stringify(previous.llm) !== JSON.stringify(next.llm)) {
		changed.push("llm");
	}

	if (
		JSON.stringify(previous.contextCompaction) !==
		JSON.stringify(next.contextCompaction)
	) {
		changed.push("contextCompaction");
	}

	if (previous.tavilyApiKey !== next.tavilyApiKey) {
		changed.push("web");
	}

	if (JSON.stringify(previous.channels) !== JSON.stringify(next.channels)) {
		changed.push("channels");
	}

	if (
		previous.workspace !== next.workspace ||
		previous.agentsPath !== next.agentsPath ||
		previous.defaultAgent !== next.defaultAgent
	) {
		changed.push("sessionDefaults");
	}

	return changed;
}
