import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "./message";

export type HistorySession = {
	id: string;
	agentId: string;
	title: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
	systemPrompt: string;
};

export type CreateHistorySessionInput = {
	id: string;
	agentId: string;
	systemPrompt: string;
};

export type HistoryMessage = ChatMessage & {
	timestamp: string;
};

export class HistoryStore {
	private readonly sessionsDirectory: string;

	constructor(private readonly historyDirectory: string) {
		this.sessionsDirectory = join(this.historyDirectory, "sessions");

		mkdirSync(this.historyDirectory, { recursive: true });
		mkdirSync(this.sessionsDirectory, { recursive: true });
	}

	private get indexPath(): string {
		return join(this.historyDirectory, "index.jsonl");
	}

	private getSessionPath(sessionId: string): string {
		return join(this.sessionsDirectory, `${sessionId}.jsonl`);
	}

	private readSessions(): HistorySession[] {
		if (!existsSync(this.indexPath)) {
			return [];
		}

		return readFileSync(this.indexPath, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as HistorySession);
	}

	private writeSessions(sessions: HistorySession[]): void {
		const content = sessions
			.map((session) => JSON.stringify(session))
			.join("\n");
		writeFileSync(this.indexPath, content ? `${content}\n` : "", "utf8");
	}

	private createTitleFromMessage(content: string): string {
		const title = content.trim().replace(/\s+/g, " ");
		return title.length > 60 ? `${title.slice(0, 57)}...` : title;
	}

	createSession(input: CreateHistorySessionInput): HistorySession {
		const now = new Date().toISOString();

		const session: HistorySession = {
			id: input.id,
			agentId: input.agentId,
			title: "Untitled session",
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
			systemPrompt: input.systemPrompt,
		};

		this.writeSessions([...this.readSessions(), session]);
		writeFileSync(this.getSessionPath(session.id), "", "utf8");

		return session;
	}

	appendMessage(sessionId: string, message: ChatMessage): void {
		const timestamp = new Date().toISOString();
		const historyMessage: HistoryMessage = {
			...message,
			timestamp,
		};

		appendFileSync(
			this.getSessionPath(sessionId),
			`${JSON.stringify(historyMessage)}\n`,
			"utf8",
		);

		const sessions = this.readSessions();
		const updatedSessions = sessions.map((session) => {
			if (session.id !== sessionId) {
				return session;
			}

			return {
				...session,
				title:
					session.title === "Untitled session" && message.role === "user"
						? this.createTitleFromMessage(message.content)
						: session.title,
				messageCount: session.messageCount + 1,
				updatedAt: timestamp,
			};
		});

		this.writeSessions(updatedSessions);
	}

	replaceMessages(sessionId: string, messages: ChatMessage[]): void {
		const timestamp = new Date().toISOString();
		const historyMessages = messages.map((message) => ({
			...message,
			timestamp,
		}));
		const content = historyMessages
			.map((message) => JSON.stringify(message))
			.join("\n");

		writeFileSync(
			this.getSessionPath(sessionId),
			content ? `${content}\n` : "",
			"utf8",
		);

		const firstUserMessage = messages.find(
			(message) => message.role === "user",
		);
		const sessions = this.readSessions();
		const updatedSessions = sessions.map((session) => {
			if (session.id !== sessionId) {
				return session;
			}

			return {
				...session,
				title:
					session.title === "Untitled session" && firstUserMessage !== undefined
						? this.createTitleFromMessage(firstUserMessage.content)
						: session.title,
				messageCount: messages.length,
				updatedAt: timestamp,
			};
		});

		this.writeSessions(updatedSessions);
	}

	listSessions(): HistorySession[] {
		return this.readSessions().toSorted((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		);
	}

	getSession(sessionId: string): HistorySession | undefined {
		return this.readSessions().find((session) => session.id === sessionId);
	}

	getLatestSession(): HistorySession | undefined {
		return this.listSessions().find((session) => session.messageCount > 0);
	}

	readMessages(sessionId: string): ChatMessage[] {
		const sessionPath = this.getSessionPath(sessionId);
		if (!existsSync(sessionPath)) {
			return [];
		}

		return readFileSync(sessionPath, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const { timestamp: _timestamp, ...message } = JSON.parse(
					line,
				) as HistoryMessage;
				return message;
			});
	}
}
