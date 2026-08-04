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
	test("delivers an event to one subscriber", async () => {
		const handler = mock(() => {});

		bus.subscribe(handler);
		await bus.publish(event);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(event);
	});

	test("delivers an event to multiple subscribers", async () => {
		const firstHandler = mock(() => {});
		const secondHandler = mock(() => {});

		bus.subscribe(firstHandler);
		bus.subscribe(secondHandler);
		await bus.publish(event);

		expect(firstHandler).toHaveBeenCalledTimes(1);
		expect(firstHandler).toHaveBeenCalledWith(event);
		expect(secondHandler).toHaveBeenCalledTimes(1);
		expect(secondHandler).toHaveBeenCalledWith(event);
	});

	test("stops delivery after unsubscribe", async () => {
		const handler = mock(() => {});

		const unsubscribe = bus.subscribe(handler);
		unsubscribe();
		await bus.publish(event);

		expect(handler).not.toHaveBeenCalled();
	});

	test("allows unsubscribe to be called more than once", async () => {
		const handler = mock(() => {});
		const unsubscribe = bus.subscribe(handler);

		unsubscribe();
		unsubscribe();
		await bus.publish(event);

		expect(handler).not.toHaveBeenCalled();
	});

	test("keeps duplicate handler subscriptions independent", async () => {
		const handler = mock(() => {});
		const unsubscribeFirst = bus.subscribe(handler);
		bus.subscribe(handler);

		unsubscribeFirst();
		await bus.publish(event);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(event);
	});

	test("continues delivery when one subscriber throws", async () => {
		const workingHandler = mock(() => {});

		bus.subscribe(() => {
			throw new Error("subscriber failed");
		});
		bus.subscribe(workingHandler);
		await bus.publish(event);

		expect(workingHandler).toHaveBeenCalledTimes(1);
		expect(workingHandler).toHaveBeenCalledWith(event);
	});

	test("resolves when an asynchronous subscriber rejects", async () => {
		bus.subscribe(async () => {
			throw new Error("asynchronous subscriber failed");
		});

		await expect(bus.publish(event)).resolves.toBeUndefined();
	});

	test("does not notify a subscriber added during the current publication", async () => {
		const lateHandler = mock(() => {});

		bus.subscribe(() => {
			bus.subscribe(lateHandler);
		});

		await bus.publish(event);
		expect(lateHandler).not.toHaveBeenCalled();

		await bus.publish(event);
		expect(lateHandler).toHaveBeenCalledTimes(1);
		expect(lateHandler).toHaveBeenCalledWith(event);
	});
});
