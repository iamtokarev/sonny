import { describe, expect, test } from "bun:test";
import { HistoryRecorder } from "./history-recorder";
import type { ChatMessage } from "./message";

class FakeHistoryStore {
	readonly appendedMessages: ChatMessage[] = [];
	readonly replacedMessageLists: ChatMessage[][] = [];
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

	replaceMessages(_sessionId: string, messages: ChatMessage[]): void {
		this.replacedMessageLists.push([...messages]);
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

	test("initial flushed message count skips restored messages", () => {
		const historyStore = new FakeHistoryStore();
		const recorder = new HistoryRecorder(historyStore, "session-id", {
			flushedMessageCount: 2,
		});

		recorder.flush([
			{ role: "user", content: "Restored question" },
			{ role: "assistant", content: "Restored answer" },
			{ role: "user", content: "New question" },
		]);

		expect(historyStore.appendedMessages).toEqual([
			{ role: "user", content: "New question" },
		]);
	});

	test("replaceMessages resets cursor to rewritten message count", () => {
		const historyStore = new FakeHistoryStore();
		const recorder = new HistoryRecorder(historyStore, "session-id");
		const compactedMessages: ChatMessage[] = [
			{ role: "user", content: "Question" },
			{
				role: "tool",
				toolCallId: "call-1",
				content: "compacted output",
			},
		];

		recorder.replaceMessages(compactedMessages);
		recorder.flush([
			...compactedMessages,
			{ role: "assistant", content: "Final answer" },
		]);

		expect(historyStore.replacedMessageLists).toEqual([compactedMessages]);
		expect(historyStore.appendedMessages).toEqual([
			{ role: "assistant", content: "Final answer" },
		]);
	});
});
