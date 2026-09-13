import type { RuntimeSource } from "../events";

export function buildChannelPrompt(source: RuntimeSource): string {
	if (source.kind !== "channel") {
		return "";
	}

	return [
		`You are responding through the ${source.channel} channel.`,
		`The current conversation is a ${source.conversationKind} conversation.`,
		"Keep the response suitable for plain messaging text.",
		"Do not expose internal channel, conversation, user, or message identifiers.",
	].join("\n");
}
