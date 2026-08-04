import { describe, expect, test } from "bun:test";
import { createEventMetadata } from "./runtime-event";
import type { TurnContext } from "./turn-context";

function createContext(): TurnContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" },
		events: {
			async publish() {},
		},
	};
}

describe("createEventMetadata", () => {
	test("copies turn correlation metadata", () => {
		const context = createContext();

		const metadata = createEventMetadata(context);

		expect(metadata.sessionId).toBe(context.sessionId);
		expect(metadata.turnId).toBe(context.turnId);
		expect(metadata.source).toBe(context.source);
	});

	test("creates a unique event id for every event", () => {
		const context = createContext();

		const first = createEventMetadata(context);
		const second = createEventMetadata(context);

		expect(first.eventId).not.toBe("");
		expect(second.eventId).not.toBe(first.eventId);
	});

	test("creates an ISO timestamp", () => {
		const metadata = createEventMetadata(createContext());

		expect(new Date(metadata.occurredAt).toISOString()).toBe(
			metadata.occurredAt,
		);
	});
});
