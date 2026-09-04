import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRegistry } from "../commands/command-registry";
import type { AgentTurnInput, CreateAgentSessionResult } from "../runtime";
import type { ChannelSource } from "./channel";
import { ChannelSessionBindingStore } from "./channel-session-binding-store";
import {
	ChannelSessionDirectory,
	type CreateChannelSession,
} from "./channel-session-directory";

function source(conversationId: string): ChannelSource {
	return {
		channel: "telegram",
		conversationId,
		conversationKind: "direct",
		userId: "user-1",
		messageId: "message-1",
	};
}

function createDeferred<T>() {
	let resolve: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return {
		promise,
		resolve: (value: T) => resolve?.(value),
	};
}

function sessionResult(sessionId: string): CreateAgentSessionResult {
	return {
		runtime: {
			runTurn: async (input: AgentTurnInput) => ({
				turnId: "turn-1",
				content: `Reply to ${input.content}`,
			}),
			getMessageCount: () => 0,
			getContextUsage: () => ({
				tokenCount: 0,
				contextWindowTokens: 200_000,
				thresholdTokens: 150_000,
				thresholdRatio: 0.75,
			}),
			compactContext: async () => ({
				messages: [],
				tokenCountBefore: 0,
				tokenCountAfter: 0,
				thresholdTokens: 150_000,
				changed: false,
				compactedToolResultCount: 0,
				summaryCompactedMessageCount: 0,
			}),
			reloadConfiguration: async () => ({
				status: "unchanged" as const,
				revision: 1,
				info: { model: "openai/model-a", toolNames: [] },
			}),
		} as unknown as CreateAgentSessionResult["runtime"],
		historySession: {
			id: sessionId,
			agentId: "sonny",
			title: "Test session",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		restoredMessageCount: 0,
		restoredMessages: [],
		skills: [],
		mode: "new",
		toolNames: [],
		model: "openai/model-a",
	};
}

async function createBindingStore(): Promise<ChannelSessionBindingStore> {
	const workspace = await mkdtemp(join(tmpdir(), "sonny-channel-directory-"));
	return new ChannelSessionBindingStore(
		join(workspace, ".history", "channels", "bindings.json"),
	);
}

describe("ChannelSessionDirectory", () => {
	test("creates and binds the first session for a conversation", async () => {
		const bindings = await createBindingStore();
		const input = source("conversation-1");
		const calls: Array<{ resumeSessionId?: string }> = [];
		const createSession: CreateChannelSession = async (options) => {
			calls.push(options);
			return sessionResult("session-1");
		};
		const directory = new ChannelSessionDirectory(
			bindings,
			createSession,
			new CommandRegistry(),
		);

		const acquired = await directory.getOrCreate(input);

		expect(acquired.sessionId).toBe("session-1");
		expect(calls).toEqual([{}]);
		expect((await bindings.get(input))?.sessionId).toBe("session-1");
	});

	test("reuses one live interactor for repeated interactions", async () => {
		const bindings = await createBindingStore();
		let createCount = 0;
		const directory = new ChannelSessionDirectory(
			bindings,
			async () => {
				createCount += 1;
				return sessionResult("session-1");
			},
			new CommandRegistry(),
		);
		const input = source("conversation-1");

		const first = await directory.getOrCreate(input);
		const second = await directory.getOrCreate(input);

		expect(second).toBe(first);
		expect(second.interactor).toBe(first.interactor);
		expect(createCount).toBe(1);
	});

	test("a fresh directory resumes the persisted session", async () => {
		const bindings = await createBindingStore();
		const input = source("conversation-1");
		const first = new ChannelSessionDirectory(
			bindings,
			async () => sessionResult("session-1"),
			new CommandRegistry(),
		);
		await first.getOrCreate(input);
		const calls: Array<{ resumeSessionId?: string }> = [];
		const reopened = new ChannelSessionDirectory(
			bindings,
			async (options) => {
				calls.push(options);
				return sessionResult(options.resumeSessionId ?? "unexpected-new");
			},
			new CommandRegistry(),
		);

		const resumed = await reopened.getOrCreate(input);

		expect(resumed.sessionId).toBe("session-1");
		expect(calls).toEqual([{ resumeSessionId: "session-1" }]);
	});

	test("simultaneous first interactions create one session and binding", async () => {
		const bindings = await createBindingStore();
		const started = createDeferred<void>();
		const release = createDeferred<void>();
		let createCount = 0;
		const directory = new ChannelSessionDirectory(
			bindings,
			async () => {
				createCount += 1;
				started.resolve();
				await release.promise;
				return sessionResult("session-1");
			},
			new CommandRegistry(),
		);
		const input = source("conversation-1");

		const first = directory.getOrCreate(input);
		const second = directory.getOrCreate(input);
		await started.promise;

		expect(createCount).toBe(1);
		release.resolve();
		const [firstSession, secondSession] = await Promise.all([first, second]);
		expect(secondSession).toBe(firstSession);
		expect((await bindings.get(input))?.sessionId).toBe("session-1");
	});

	test("two bindings to one session share one live runtime", async () => {
		const bindings = await createBindingStore();
		const firstSource = source("conversation-1");
		const secondSource = source("conversation-2");
		await bindings.bind(firstSource, "shared-session");
		await bindings.bind(secondSource, "shared-session");
		let createCount = 0;
		const directory = new ChannelSessionDirectory(
			bindings,
			async (options) => {
				createCount += 1;
				return sessionResult(options.resumeSessionId ?? "unexpected-new");
			},
			new CommandRegistry(),
		);

		const [first, second] = await Promise.all([
			directory.getOrCreate(firstSource),
			directory.getOrCreate(secondSource),
		]);

		expect(createCount).toBe(1);
		expect(second).toBe(first);
		expect(second.interactor).toBe(first.interactor);
	});

	test("different persisted sessions can be acquired concurrently", async () => {
		const bindings = await createBindingStore();
		const firstSource = source("conversation-1");
		const secondSource = source("conversation-2");
		await bindings.bind(firstSource, "session-1");
		await bindings.bind(secondSource, "session-2");
		const bothStarted = createDeferred<void>();
		const release = createDeferred<void>();
		const started: string[] = [];
		const directory = new ChannelSessionDirectory(
			bindings,
			async (options) => {
				const sessionId = options.resumeSessionId ?? "unexpected-new";
				started.push(sessionId);
				if (started.length === 2) {
					bothStarted.resolve();
				}
				await release.promise;
				return sessionResult(sessionId);
			},
			new CommandRegistry(),
		);

		const first = directory.getOrCreate(firstSource);
		const second = directory.getOrCreate(secondSource);
		await bothStarted.promise;

		expect(started).toEqual(["session-1", "session-2"]);
		release.resolve();
		await Promise.all([first, second]);
	});

	test("clears a failed acquisition so a later interaction can retry", async () => {
		const bindings = await createBindingStore();
		let createCount = 0;
		const directory = new ChannelSessionDirectory(
			bindings,
			async () => {
				createCount += 1;
				if (createCount === 1) {
					throw new Error("Session creation failed");
				}

				return sessionResult("session-1");
			},
			new CommandRegistry(),
		);
		const input = source("conversation-1");

		await expect(directory.getOrCreate(input)).rejects.toThrow(
			"Session creation failed",
		);
		await expect(directory.getOrCreate(input)).resolves.toMatchObject({
			sessionId: "session-1",
		});
		expect(createCount).toBe(2);
	});

	test("fails clearly when bound history cannot be resumed", async () => {
		const bindings = await createBindingStore();
		const input = source("conversation-1");
		await bindings.bind(input, "missing-session");
		const calls: Array<{ resumeSessionId?: string }> = [];
		const directory = new ChannelSessionDirectory(
			bindings,
			async (options) => {
				calls.push(options);
				throw new Error("Session not found: missing-session");
			},
			new CommandRegistry(),
		);

		await expect(directory.getOrCreate(input)).rejects.toThrow(
			"Failed to resume the Sonny session referenced by a channel binding.",
		);
		expect(calls).toEqual([{ resumeSessionId: "missing-session" }]);
	});

	test("eviction makes the next acquisition resume persisted state", async () => {
		const bindings = await createBindingStore();
		const input = source("conversation-1");
		const calls: Array<{ resumeSessionId?: string }> = [];
		const directory = new ChannelSessionDirectory(
			bindings,
			async (options) => {
				calls.push(options);
				return sessionResult(options.resumeSessionId ?? "session-1");
			},
			new CommandRegistry(),
		);

		const initial = await directory.getOrCreate(input);
		directory.evict(initial.sessionId);
		const resumed = await directory.getOrCreate(input);

		expect(resumed).not.toBe(initial);
		expect(resumed.sessionId).toBe(initial.sessionId);
		expect(calls).toEqual([{}, { resumeSessionId: "session-1" }]);
	});
});
