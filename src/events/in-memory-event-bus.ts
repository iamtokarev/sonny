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

	async publish(event: RuntimeEvent): Promise<void> {
		const subscriptions = [...this.subscriptions];
		const results = await Promise.allSettled(
			subscriptions.map(async (subscription) => {
				await subscription.handler(event);
			}),
		);

		for (const result of results) {
			if (result.status === "rejected") {
				logger.warn("event.subscriber.failed", {
					eventType: event.type,
					error:
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason),
				});
			}
		}
	}
}
