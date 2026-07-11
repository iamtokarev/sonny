export type SystemPromptParts = {
	stable?: string[];
	context?: string[];
	volatile?: string[];
};

export function buildSystemPrompt(parts: SystemPromptParts): string {
	return [
		...(parts.stable ?? []),
		...(parts.context ?? []),
		...(parts.volatile ?? []),
	]
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n\n");
}
