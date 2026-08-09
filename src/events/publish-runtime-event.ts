import { createLogger } from "../utils/logger";
import type { RuntimeEventPublisher } from "./event-bus";
import type { RuntimeEvent } from "./runtime-event";

const logger = createLogger("events.publisher");

export function publishRuntimeEvent(
	publisher: RuntimeEventPublisher,
	event: RuntimeEvent,
): void {
	try {
		const result = publisher.publish(event) as unknown;

		if (result instanceof Promise) {
			void result.catch((error) => {
				logPublishFailure(event, error);
			});
		}
	} catch (error) {
		logPublishFailure(event, error);
	}
}

function logPublishFailure(event: RuntimeEvent, error: unknown): void {
	logger.warn("event.publish.failed", {
		eventType: event.type,
		error: error instanceof Error ? error.message : String(error),
	});
}
