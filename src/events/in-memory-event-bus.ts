import { createLogger } from "../utils/logger";
import type { RuntimeEventBus, RuntimeEventHandler } from "./event-bus";
import type { RuntimeEvent } from "./runtime-event";

const logger = createLogger("events.in-memory-event-bus");

type RuntimeEventSubscription = {
	readonly handler: RuntimeEventHandler;
};

export class InMemoryRuntimeEventBus implements RuntimeEventBus {
	private readonly subscriptions = new Set<RuntimeEventSubscription>();

	subscribe(handler: RuntimeEventHandler): () => void {
		const subscription = { handler };
		this.subscriptions.add(subscription);

		return () => {
			this.subscriptions.delete(subscription);
		};
	}

	publish(event: RuntimeEvent): void {
		const subscriptions = [...this.subscriptions];

		for (const subscription of subscriptions) {
			try {
				const result = subscription.handler(event) as unknown;

				if (result instanceof Promise) {
					void result.catch((error) => {
						this.logSubscriberFailure(event, error);
					});
				}
			} catch (error) {
				this.logSubscriberFailure(event, error);
			}
		}
	}

	private logSubscriberFailure(event: RuntimeEvent, error: unknown): void {
		logger.warn("event.subscriber.failed", {
			eventType: event.type,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
