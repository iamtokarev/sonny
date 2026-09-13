import { describe, expect, test } from "bun:test";
import type { RuntimeSource } from "../events";
import { buildChannelPrompt } from "./channel-prompt";

describe("buildChannelPrompt", () => {
	test.each([
		{ kind: "cli" } as const,
		{ kind: "system", name: "config-poll" } as const,
	])("adds no guidance for a $kind source", (source) => {
		expect(buildChannelPrompt(source)).toBe("");
	});

	test("describes a channel turn without exposing runtime identifiers", () => {
		const source: RuntimeSource = {
			kind: "channel",
			channel: "telegram",
			conversationId: "conversation-secret-123",
			conversationKind: "direct",
			threadId: "thread-secret-456",
			userId: "user-secret-789",
		};

		const prompt = buildChannelPrompt(source);

		expect(prompt).toContain(
			"You are responding through the telegram channel.",
		);
		expect(prompt).toContain(
			"The current conversation is a direct conversation.",
		);
		expect(prompt).toContain("suitable for plain messaging text");
		expect(prompt).not.toContain(source.conversationId);
		expect(prompt).not.toContain(source.threadId as string);
		expect(prompt).not.toContain(source.userId);
	});
});
