import type { RuntimeEvent } from "./runtime-event";

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export interface RuntimeEventPublisher {
	publish(event: RuntimeEvent): void;
}

export interface RuntimeEventBus extends RuntimeEventPublisher {
	subscribe(handler: RuntimeEventHandler): () => void;
}
