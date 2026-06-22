import type { ChatMessage } from "./message";

export class SessionState {
	private readonly messages: ChatMessage[] = [];

	addMessage(message: ChatMessage): void {
		this.messages.push(message);
	}

	buildMessages(systemPrompt: string): ChatMessage[] {
		return [{ role: "system", content: systemPrompt }, ...this.messages];
	}

	get messageCount(): number {
		return this.messages.length;
	}
}
