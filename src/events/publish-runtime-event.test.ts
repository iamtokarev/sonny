import { describe, expect, mock, test } from "bun:test";
import type { RuntimeEventPublisher } from "./event-bus";
import { publishRuntimeEvent } from "./publish-runtime-event";
import type { TurnStartedEvent } from "./runtime-event";

function createEvent(): TurnStartedEvent {
	return {
		type: "turn.started",
		eventId: "event-1",
		sessionId: "session-1",
		turnId: "turn-1",
		source: { kind: "cli" },
		occurredAt: "2026-08-04T10:00:00.000Z",
		inputLength: 5,
	};
}

describe("publishRuntimeEvent", () => {
	test("forwards the event to the publisher", async () => {
		const publish = mock(async () => {});
		const publisher: RuntimeEventPublisher = { publish };
		const event = createEvent();

		await publishRuntimeEvent(publisher, event);

		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenCalledWith(event);
	});

	test("resolves when the publisher throws synchronously", async () => {
		const publisher: RuntimeEventPublisher = {
			publish() {
				throw new Error("publisher failed");
			},
		};

		await expect(
			publishRuntimeEvent(publisher, createEvent()),
		).resolves.toBeUndefined();
	});

	test("resolves when the publisher rejects asynchronously", async () => {
		const publisher: RuntimeEventPublisher = {
			async publish() {
				throw new Error("publisher failed asynchronously");
			},
		};

		await expect(
			publishRuntimeEvent(publisher, createEvent()),
		).resolves.toBeUndefined();
	});
});
