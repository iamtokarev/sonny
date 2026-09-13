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
	private readonly sessionIdByBindingKey = new Map<string, string>();

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

	async replace(
		source: ChannelSource,
		signal?: AbortSignal,
	): Promise<ChannelConversationSession> {
		if (signal?.aborted) {
			throw replacementAborted();
		}

		const bindingKey = createChannelSessionKey(source);
		const previousSessionId = this.sessionIdByBindingKey.get(bindingKey);
		const replacement = this.toConversationSession(
			await this.createSession({}),
		);

		if (signal?.aborted) {
			throw replacementAborted();
		}

		await this.bindings.bind(source, replacement.sessionId);

		if (
			previousSessionId !== undefined &&
			previousSessionId !== replacement.sessionId
		) {
			this.forgetBinding(bindingKey, previousSessionId);
		}

		const published = Promise.resolve(replacement);
		this.bySessionId.set(replacement.sessionId, published);
		this.byBindingKey.set(bindingKey, published);
		this.rememberBinding(bindingKey, replacement.sessionId);

		return replacement;
	}

	evict(sessionId: string): void {
		this.bySessionId.delete(sessionId);

		for (const bindingKey of this.bindingKeysBySessionId.get(sessionId) ?? []) {
			this.byBindingKey.delete(bindingKey);
			this.sessionIdByBindingKey.delete(bindingKey);
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
		this.sessionIdByBindingKey.set(bindingKey, sessionId);
	}

	private forgetBinding(bindingKey: string, sessionId: string): void {
		const keys = this.bindingKeysBySessionId.get(sessionId);

		if (keys === undefined) {
			return;
		}

		keys.delete(bindingKey);
		if (keys.size === 0) {
			this.bindingKeysBySessionId.delete(sessionId);
			this.bySessionId.delete(sessionId);
		}
	}
}

function replacementAborted(): Error {
	const error = new Error("Channel session replacement was cancelled.");
	error.name = "AbortError";
	return error;
}
