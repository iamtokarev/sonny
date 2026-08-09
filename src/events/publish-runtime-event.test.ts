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
	test("forwards the event to the publisher", () => {
		const publish = mock(() => {});
		const publisher: RuntimeEventPublisher = { publish };
		const event = createEvent();

		publishRuntimeEvent(publisher, event);

		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenCalledWith(event);
	});

	test("does not throw when the publisher throws synchronously", () => {
		const publisher: RuntimeEventPublisher = {
			publish() {
				throw new Error("publisher failed");
			},
		};

		expect(() => publishRuntimeEvent(publisher, createEvent())).not.toThrow();
	});

	test("does not wait when a publisher returns a promise", () => {
		let completed = false;
		const publisher: RuntimeEventPublisher = {
			async publish() {
				await Promise.resolve();
				completed = true;
			},
		};

		publishRuntimeEvent(publisher, createEvent());

		expect(completed).toBe(false);
	});

	test("observes an accidental asynchronous publisher rejection", async () => {
		const publisher: RuntimeEventPublisher = {
			async publish() {
				throw new Error("publisher failed asynchronously");
			},
		};

		expect(() => publishRuntimeEvent(publisher, createEvent())).not.toThrow();
		await Promise.resolve();
	});
});
