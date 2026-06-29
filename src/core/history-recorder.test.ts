import { describe, expect, test } from "bun:test";
import { HistoryRecorder } from "./history-recorder";
import type { ChatMessage } from "./message";

class FakeHistoryStore {
	readonly appendedMessages: ChatMessage[] = [];
	private failureIndex: number | undefined;

	failOnAppend(index: number): void {
		this.failureIndex = index;
	}

	clearFailure(): void {
		this.failureIndex = undefined;
	}

	appendMessage(_sessionId: string, message: ChatMessage): void {
		if (this.failureIndex === this.appendedMessages.length) {
			throw new Error("write failed");
		}

		this.appendedMessages.push(message);
	}
}

describe("HistoryRecorder", () => {
	test("flushes only new messages", () => {
		const historyStore = new FakeHistoryStore();
		const recorder = new HistoryRecorder(historyStore, "session-id");
		const messages: ChatMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		];

		recorder.flush(messages);
		recorder.flush([...messages, { role: "user", content: "Second message" }]);

		expect(historyStore.appendedMessages).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
			{ role: "user", content: "Second message" },
		]);
	});

	test("does not duplicate already flushed messages after a later failure", () => {
		const historyStore = new FakeHistoryStore();
		const recorder = new HistoryRecorder(historyStore, "session-id");
		const messages: ChatMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		];

		historyStore.failOnAppend(1);

		expect(() => recorder.flush(messages)).toThrow("write failed");
		expect(historyStore.appendedMessages).toEqual([
			{ role: "user", content: "Hello" },
		]);

		historyStore.clearFailure();
		recorder.flush(messages);

		expect(historyStore.appendedMessages).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		]);
	});

	test("flushing an empty list writes nothing", () => {
		const historyStore = new FakeHistoryStore();
		const recorder = new HistoryRecorder(historyStore, "session-id");

		recorder.flush([]);

		expect(historyStore.appendedMessages).toEqual([]);
	});
});
