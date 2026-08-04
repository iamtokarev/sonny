import { createLogger } from "../utils/logger";
import type { RuntimeEventPublisher } from "./event-bus";
import type { RuntimeEvent } from "./runtime-event";

const logger = createLogger("events.publisher");

export async function publishRuntimeEvent(
	publisher: RuntimeEventPublisher,
	event: RuntimeEvent,
): Promise<void> {
	try {
		await publisher.publish(event);
	} catch (error) {
		logger.warn("event.publish.failed", {
			eventType: event.type,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
