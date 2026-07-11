import type { ChatMessage } from "../domain";
import type { HistoryStore } from "./history-store";

type HistoryMessageStore = Pick<
	HistoryStore,
	"appendMessage" | "replaceMessages"
>;

export type HistoryRecorderSink = {
	flush(messages: ChatMessage[]): void;
	replaceMessages(messages: ChatMessage[]): void;
};

export type HistoryRecorderOptions = {
	flushedMessageCount?: number;
};

export class HistoryRecorder implements HistoryRecorderSink {
	private flushedMessageCount: number;

	constructor(
		private readonly historyStore: HistoryMessageStore,
		private readonly sessionId: string,
		options: HistoryRecorderOptions = {},
	) {
		this.flushedMessageCount = options.flushedMessageCount ?? 0;
	}

	flush(messages: ChatMessage[]): void {
		for (
			let index = this.flushedMessageCount;
			index < messages.length;
			index++
		) {
			const message = messages[index];
			if (message === undefined) {
				continue;
			}

			this.historyStore.appendMessage(this.sessionId, message);
			this.flushedMessageCount = index + 1;
		}
	}

	replaceMessages(messages: ChatMessage[]): void {
		this.historyStore.replaceMessages(this.sessionId, messages);
		this.flushedMessageCount = messages.length;
	}
}
