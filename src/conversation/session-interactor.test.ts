import { describe, expect, test } from "bun:test";
import { CommandRegistry } from "../commands/command-registry";
import { createDefaultCommandRegistry } from "../commands/create-command-registry";
import type { RuntimeSource } from "../events";
import type {
	AgentTurnInput,
	AgentTurnResult,
	CreateAgentSessionResult,
} from "../runtime";
import {
	type InteractorSession,
	SessionInteractor,
} from "./session-interactor";

const cliSource = { kind: "cli" } as const;

function createDeferred<T>() {
	let resolve: ((value: T) => void) | undefined;
	let reject: ((reason?: unknown) => void) | undefined;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {
		promise,
		resolve: (value: T) => resolve?.(value),
		reject: (reason?: unknown) => reject?.(reason),
	};
}

function createSession(
	overrides: Partial<CreateAgentSessionResult["runtime"]> = {},
): InteractorSession {
	const runtime = {
		runTurn: async (input: AgentTurnInput): Promise<AgentTurnResult> => ({
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
		...overrides,
	} as unknown as CreateAgentSessionResult["runtime"];

	return {
		runtime,
		historySession: {
			id: "session-1",
			agentId: "sonny",
			title: "Test session",
			messageCount: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			systemPrompt: "system",
		},
		skills: [],
	};
}

describe("SessionInteractor", () => {
	test("runs plain input exactly once with its source and signal", async () => {
		const abort = new AbortController();
		const source: RuntimeSource = {
			kind: "channel",
			channel: "telegram",
			conversationId: "conversation-1",
			conversationKind: "direct",
			userId: "user-1",
		};
		const inputs: AgentTurnInput[] = [];
		const session = createSession({
			runTurn: async (input) => {
				inputs.push(input);
				return { turnId: "turn-1", content: "Hello back" };
			},
		});
		const interactor = new SessionInteractor(session, new CommandRegistry());

		await expect(
			interactor.handle({ content: "  Hello  ", source, signal: abort.signal }),
		).resolves.toEqual({
			messages: [{ kind: "assistant", content: "Hello back" }],
			exitRequested: false,
		});
		expect(inputs).toEqual([
			{ content: "Hello", source, signal: abort.signal },
		]);
	});

	test("returns command output without running an agent turn", async () => {
		let turnCount = 0;
		const registry = new CommandRegistry();
		registry.register({
			name: "echo",
			description: "Echo text.",
			execute: (args) => ({ type: "message", content: args }),
		});
		const interactor = new SessionInteractor(
			createSession({
				runTurn: async () => {
					turnCount += 1;
					return { turnId: "turn-1", content: "Unexpected" };
				},
			}),
			registry,
		);

		await expect(
			interactor.handle({ content: "/echo hello", source: cliSource }),
		).resolves.toEqual({
			messages: [{ kind: "command", commandName: "echo", content: "hello" }],
			exitRequested: false,
		});
		expect(turnCount).toBe(0);
	});

	test("uses registry behavior for an unknown command", async () => {
		const interactor = new SessionInteractor(
			createSession(),
			new CommandRegistry(),
		);

		await expect(
			interactor.handle({ content: "/missing", source: cliSource }),
		).resolves.toEqual({
			messages: [
				{
					kind: "command",
					commandName: "missing",
					content: "Unknown command: /missing",
				},
			],
			exitRequested: false,
		});
	});

	test("preserves a submit notice and sends content directly to the runtime", async () => {
		const inputs: AgentTurnInput[] = [];
		const registry = new CommandRegistry();
		registry.register({
			name: "draft",
			description: "Submit a draft.",
			execute: () => ({
				type: "submit",
				notice: "Draft expanded.",
				content: "/literal model input",
			}),
		});
		registry.register({
			name: "literal",
			description: "Must not run.",
			execute: () => ({ type: "message", content: "Wrong path" }),
		});
		const interactor = new SessionInteractor(
			createSession({
				runTurn: async (input) => {
					inputs.push(input);
					return { turnId: "turn-1", content: "Model response" };
				},
			}),
			registry,
		);

		await expect(
			interactor.handle({ content: "/draft", source: cliSource }),
		).resolves.toEqual({
			messages: [
				{ kind: "notice", content: "Draft expanded." },
				{ kind: "assistant", content: "Model response" },
			],
			exitRequested: false,
		});
		expect(inputs[0]?.content).toBe("/literal model input");
	});

	test("resolves command aliases inside the active queue operation", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "shortcut",
			description: "Resolve another command.",
			execute: () => ({ type: "alias", input: "/echo resolved" }),
		});
		registry.register({
			name: "echo",
			description: "Echo text.",
			execute: (args) => ({ type: "message", content: args }),
		});
		const interactor = new SessionInteractor(createSession(), registry);

		await expect(
			interactor.handle({ content: "/shortcut", source: cliSource }),
		).resolves.toEqual({
			messages: [{ kind: "command", commandName: "echo", content: "resolved" }],
			exitRequested: false,
		});
	});

	test("fails clearly after five alias resolutions", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "loop",
			description: "Loop forever.",
			execute: () => ({ type: "alias", input: "/loop" }),
		});
		const interactor = new SessionInteractor(createSession(), registry);

		await expect(
			interactor.handle({ content: "/loop", source: cliSource }),
		).rejects.toThrow("Command alias resolution exceeded 5 resolutions.");
	});

	test("returns exit requests instead of terminating the process", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "bye",
			description: "Exit.",
			execute: () => ({ type: "exit", content: "Goodbye" }),
		});
		const interactor = new SessionInteractor(createSession(), registry);

		await expect(
			interactor.handle({ content: "/bye", source: cliSource }),
		).resolves.toEqual({
			messages: [{ kind: "command", commandName: "bye", content: "Goodbye" }],
			exitRequested: true,
		});
	});

	test("binds context, compaction, and reload to the originating source", async () => {
		const source: RuntimeSource = {
			kind: "channel",
			channel: "telegram",
			conversationId: "conversation-1",
			conversationKind: "direct",
			userId: "user-1",
		};
		const inspected: RuntimeSource[] = [];
		const compacted: RuntimeSource[] = [];
		const reloaded: RuntimeSource[] = [];
		const session = createSession({
			getContextUsage: (inputSource) => {
				if (inputSource === undefined) {
					throw new Error("Expected an originating source.");
				}

				inspected.push(inputSource);
				return {
					tokenCount: 0,
					contextWindowTokens: 200_000,
					thresholdTokens: 150_000,
					thresholdRatio: 0.75,
				};
			},
			compactContext: async (options) => {
				if (options?.source === undefined) {
					throw new Error("Expected an originating source.");
				}

				compacted.push(options.source);
				return {
					messages: [],
					tokenCountBefore: 0,
					tokenCountAfter: 0,
					thresholdTokens: 150_000,
					changed: false,
					compactedToolResultCount: 0,
					summaryCompactedMessageCount: 0,
				};
			},
			reloadConfiguration: async (options) => {
				if (options?.source === undefined) {
					throw new Error("Expected an originating source.");
				}

				reloaded.push(options.source);
				return {
					status: "unchanged",
					revision: 1,
					info: { model: "openai/model-a", toolNames: [] },
				};
			},
		});
		const interactor = new SessionInteractor(
			session,
			createDefaultCommandRegistry(),
		);

		await interactor.handle({ content: "/context", source });
		await interactor.handle({ content: "/compact", source });
		await interactor.handle({ content: "/reload", source });

		expect(inspected).toEqual([source]);
		expect(compacted).toEqual([source]);
		expect(reloaded).toEqual([source]);
	});

	test("handles concurrent inputs in arrival order", async () => {
		const firstStarted = createDeferred<void>();
		const releaseFirst = createDeferred<void>();
		const activity: string[] = [];
		const interactor = new SessionInteractor(
			createSession({
				runTurn: async (input) => {
					activity.push(`start:${input.content}`);
					if (input.content === "first") {
						firstStarted.resolve();
						await releaseFirst.promise;
					}
					activity.push(`finish:${input.content}`);
					return { turnId: input.content, content: input.content };
				},
			}),
			new CommandRegistry(),
		);

		const first = interactor.handle({ content: "first", source: cliSource });
		await firstStarted.promise;
		const second = interactor.handle({ content: "second", source: cliSource });
		await Promise.resolve();

		expect(activity).toEqual(["start:first"]);
		releaseFirst.resolve();
		await Promise.all([first, second]);
		expect(activity).toEqual([
			"start:first",
			"finish:first",
			"start:second",
			"finish:second",
		]);
	});

	test("does not dispatch an aborted input after waiting in its own queue", async () => {
		const firstStarted = createDeferred<void>();
		const releaseFirst = createDeferred<void>();
		let commandRuns = 0;
		const registry = new CommandRegistry();
		registry.register({
			name: "inspect",
			description: "Inspect state.",
			execute: () => {
				commandRuns += 1;
				return { type: "message", content: "inspected" };
			},
		});
		const interactor = new SessionInteractor(
			createSession({
				runTurn: async () => {
					firstStarted.resolve(undefined);
					await releaseFirst.promise;
					return { turnId: "turn-1", content: "done" };
				},
			}),
			registry,
		);
		const first = interactor.handle({ content: "first", source: cliSource });
		await firstStarted.promise;
		const controller = new AbortController();
		const queued = interactor.handle({
			content: "/inspect",
			source: cliSource,
			signal: controller.signal,
		});

		controller.abort();
		await expect(queued).resolves.toEqual({
			messages: [],
			exitRequested: false,
		});
		expect(commandRuns).toBe(0);
		releaseFirst.resolve(undefined);
		await first;
	});

	test("continues the queue after a failed input", async () => {
		const interactor = new SessionInteractor(
			createSession({
				runTurn: async (input) => {
					if (input.content === "fail") {
						throw new Error("Turn failed");
					}

					return { turnId: "turn-2", content: "Recovered" };
				},
			}),
			new CommandRegistry(),
		);

		const failed = interactor.handle({ content: "fail", source: cliSource });
		const recovered = interactor.handle({ content: "next", source: cliSource });

		await expect(failed).rejects.toThrow("Turn failed");
		await expect(recovered).resolves.toEqual({
			messages: [{ kind: "assistant", content: "Recovered" }],
			exitRequested: false,
		});
	});
});
