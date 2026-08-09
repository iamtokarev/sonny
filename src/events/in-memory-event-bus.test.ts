import { beforeEach, describe, expect, mock, test } from "bun:test";
import { InMemoryRuntimeEventBus } from "./in-memory-event-bus";
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

let bus: InMemoryRuntimeEventBus;
let event: TurnStartedEvent;

beforeEach(() => {
	bus = new InMemoryRuntimeEventBus();
	event = createEvent();
});

describe("InMemoryEventBus", () => {
	test("delivers an event to one subscriber", () => {
		const handler = mock(() => {});

		bus.subscribe(handler);
		bus.publish(event);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(event);
	});

	test("delivers an event to multiple subscribers", () => {
		const firstHandler = mock(() => {});
		const secondHandler = mock(() => {});

		bus.subscribe(firstHandler);
		bus.subscribe(secondHandler);
		bus.publish(event);

		expect(firstHandler).toHaveBeenCalledTimes(1);
		expect(firstHandler).toHaveBeenCalledWith(event);
		expect(secondHandler).toHaveBeenCalledTimes(1);
		expect(secondHandler).toHaveBeenCalledWith(event);
	});

	test("stops delivery after unsubscribe", () => {
		const handler = mock(() => {});

		const unsubscribe = bus.subscribe(handler);
		unsubscribe();
		bus.publish(event);

		expect(handler).not.toHaveBeenCalled();
	});

	test("allows unsubscribe to be called more than once", () => {
		const handler = mock(() => {});
		const unsubscribe = bus.subscribe(handler);

		unsubscribe();
		unsubscribe();
		bus.publish(event);

		expect(handler).not.toHaveBeenCalled();
	});

	test("keeps duplicate handler subscriptions independent", () => {
		const handler = mock(() => {});
		const unsubscribeFirst = bus.subscribe(handler);
		bus.subscribe(handler);

		unsubscribeFirst();
		bus.publish(event);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(event);
	});

	test("continues delivery when one subscriber throws", () => {
		const workingHandler = mock(() => {});

		bus.subscribe(() => {
			throw new Error("subscriber failed");
		});
		bus.subscribe(workingHandler);
		bus.publish(event);

		expect(workingHandler).toHaveBeenCalledTimes(1);
		expect(workingHandler).toHaveBeenCalledWith(event);
	});

	test("does not wait for an asynchronous subscriber", () => {
		let completed = false;
		bus.subscribe(async () => {
			await Promise.resolve();
			completed = true;
		});

		bus.publish(event);

		expect(completed).toBe(false);
	});

	test("observes an accidental asynchronous subscriber rejection", async () => {
		const workingHandler = mock(() => {});
		bus.subscribe(async () => {
			throw new Error("asynchronous subscriber failed");
		});
		bus.subscribe(workingHandler);

		bus.publish(event);
		await Promise.resolve();

		expect(workingHandler).toHaveBeenCalledWith(event);
	});

	test("does not notify a subscriber added during the current publication", () => {
		const lateHandler = mock(() => {});

		bus.subscribe(() => {
			bus.subscribe(lateHandler);
		});

		bus.publish(event);
		expect(lateHandler).not.toHaveBeenCalled();

		bus.publish(event);
		expect(lateHandler).toHaveBeenCalledTimes(1);
		expect(lateHandler).toHaveBeenCalledWith(event);
	});
});
