import type { CommandRegistry } from "../commands/command-registry";
import { SessionInteractor } from "../conversation";
import type {
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
} from "../runtime";
import type { ChannelSource } from "./channel";
import {
	type ChannelSessionBindingStore,
	createChannelSessionKey,
} from "./channel-session-binding-store";

export interface ChannelConversationSession {
	readonly sessionId: string;
	readonly interactor: SessionInteractor;
}

export type CreateChannelSession = (
	options: Pick<CreateAgentSessionOptions, "resumeSessionId">,
) => Promise<CreateAgentSessionResult>;

export class ChannelSessionDirectory {
	private readonly byBindingKey = new Map<
		string,
		Promise<ChannelConversationSession>
	>();
	private readonly bySessionId = new Map<
		string,
		Promise<ChannelConversationSession>
	>();
	private readonly bindingKeysBySessionId = new Map<string, Set<string>>();

	constructor(
		private readonly bindings: ChannelSessionBindingStore,
		private readonly createSession: CreateChannelSession,
		private readonly commands: CommandRegistry,
	) {}

	getOrCreate(source: ChannelSource): Promise<ChannelConversationSession> {
		const bindingKey = createChannelSessionKey(source);
		const existing = this.byBindingKey.get(bindingKey);

		if (existing !== undefined) {
			return existing;
		}

		const acquisition = this.acquire(source).then((session) => {
			this.rememberBinding(bindingKey, session.sessionId);
			return session;
		});
		this.byBindingKey.set(bindingKey, acquisition);
		void acquisition.catch(() => {
			if (this.byBindingKey.get(bindingKey) === acquisition) {
				this.byBindingKey.delete(bindingKey);
			}
		});

		return acquisition;
	}

	evict(sessionId: string): void {
		this.bySessionId.delete(sessionId);

		for (const bindingKey of this.bindingKeysBySessionId.get(sessionId) ?? []) {
			this.byBindingKey.delete(bindingKey);
		}

		this.bindingKeysBySessionId.delete(sessionId);
	}

	private async acquire(
		source: ChannelSource,
	): Promise<ChannelConversationSession> {
		const binding = await this.bindings.get(source);

		if (binding !== undefined) {
			return this.acquirePersistedSession(binding.sessionId);
		}

		const created = this.toConversationSession(await this.createSession({}));
		const createdPromise = Promise.resolve(created);
		const existing = this.bySessionId.get(created.sessionId);

		if (existing === undefined) {
			this.bySessionId.set(created.sessionId, createdPromise);
		}

		try {
			const session = await (existing ?? createdPromise);
			await this.bindings.bind(source, session.sessionId);
			return session;
		} catch (error) {
			if (
				existing === undefined &&
				this.bySessionId.get(created.sessionId) === createdPromise
			) {
				this.bySessionId.delete(created.sessionId);
			}

			throw error;
		}
	}

	private acquirePersistedSession(
		sessionId: string,
	): Promise<ChannelConversationSession> {
		const existing = this.bySessionId.get(sessionId);

		if (existing !== undefined) {
			return existing;
		}

		const acquisition = this.resumePersistedSession(sessionId);
		this.bySessionId.set(sessionId, acquisition);
		void acquisition.catch(() => {
			if (this.bySessionId.get(sessionId) === acquisition) {
				this.bySessionId.delete(sessionId);
			}
		});

		return acquisition;
	}

	private async resumePersistedSession(
		sessionId: string,
	): Promise<ChannelConversationSession> {
		let created: CreateAgentSessionResult;

		try {
			created = await this.createSession({ resumeSessionId: sessionId });
		} catch (error) {
			throw new Error(
				"Failed to resume the Sonny session referenced by a channel binding.",
				{ cause: error },
			);
		}

		if (created.historySession.id !== sessionId) {
			throw new Error(
				"Channel binding resumed a different Sonny session than requested.",
			);
		}

		return this.toConversationSession(created);
	}

	private toConversationSession(
		created: CreateAgentSessionResult,
	): ChannelConversationSession {
		return {
			sessionId: created.historySession.id,
			interactor: new SessionInteractor(created, this.commands),
		};
	}

	private rememberBinding(bindingKey: string, sessionId: string): void {
		const keys =
			this.bindingKeysBySessionId.get(sessionId) ?? new Set<string>();
		keys.add(bindingKey);
		this.bindingKeysBySessionId.set(sessionId, keys);
	}
}
