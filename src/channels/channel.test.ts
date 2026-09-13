import { describe, expect, test } from "bun:test";

import {
	type ChannelEvent,
	type ChannelSource,
	toChannelTarget,
} from "./channel";

function readEventValue(event: ChannelEvent): string {
	switch (event.type) {
		case "message":
			return event.text;
		case "action":
			return event.value;
	}

	const exhaustive: never = event;
	return exhaustive;
}

describe("toChannelTarget", () => {
	test("preserves channel conversation and thread routing", () => {
		const source: ChannelSource = {
			channel: "test",
			conversationId: "conversation-1",
			conversationKind: "group",
			threadId: "thread-1",
			userId: "user-1",
			messageId: "message-1",
		};

		expect(toChannelTarget(source)).toEqual({
			channel: "test",
			conversationId: "conversation-1",
			threadId: "thread-1",
		});
	});

	test("supports conversations without a thread", () => {
		const source: ChannelSource = {
			channel: "test",
			conversationId: "conversation-1",
			conversationKind: "direct",
			userId: "user-1",
			messageId: "message-1",
		};

		expect(toChannelTarget(source)).toEqual({
			channel: "test",
			conversationId: "conversation-1",
			threadId: undefined,
		});
	});
});

describe("ChannelEvent", () => {
	test("narrows message and action variants exhaustively", () => {
		const source: ChannelSource = {
			channel: "test",
			conversationId: "conversation-1",
			conversationKind: "direct",
			userId: "user-1",
			messageId: "message-1",
		};

		expect(readEventValue({ type: "message", source, text: "hello" })).toBe(
			"hello",
		);
		expect(readEventValue({ type: "action", source, value: "approve" })).toBe(
			"approve",
		);
	});
});
