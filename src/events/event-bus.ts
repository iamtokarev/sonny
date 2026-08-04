import type { RuntimeEvent } from "./runtime-event";

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface RuntimeEventPublisher {
	publish(event: RuntimeEvent): Promise<void>;
}

export interface RuntimeEventBus extends RuntimeEventPublisher {
	subscribe(handler: RuntimeEventHandler): () => void;
}
