import { describe, expect, test } from "bun:test";
import { parseConfig, type ResolvedConfig } from "../config";
import { InMemoryRuntimeEventBus } from "../events";
import type { RuntimeConfigStore } from "../runtime";
import type { LogFields, Logger } from "../utils/logger";
import { type GatewaySignalSource, runGatewayCommand } from "./gateway-command";

type GatewaySignal = "SIGINT" | "SIGTERM";

function deferred<T>() {
	let resolve: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return {
		promise,
		resolve: (value: T) => resolve?.(value),
	};
}

class FakeSignals implements GatewaySignalSource {
	private readonly listeners = new Map<GatewaySignal, Set<() => void>>();
	readonly removed: GatewaySignal[] = [];

	once(signal: GatewaySignal, listener: () => void): void {
		const listeners = this.listeners.get(signal) ?? new Set();
		listeners.add(listener);
		this.listeners.set(signal, listeners);
	}

	off(signal: GatewaySignal, listener: () => void): void {
		this.listeners.get(signal)?.delete(listener);
		this.removed.push(signal);
	}

	emit(signal: GatewaySignal): void {
		const listeners = [...(this.listeners.get(signal) ?? [])];
		this.listeners.delete(signal);

		for (const listener of listeners) {
			listener();
		}
	}

	listenerCount(signal: GatewaySignal): number {
		return this.listeners.get(signal)?.size ?? 0;
	}
}

function createConfig(): ResolvedConfig {
	return parseConfig({
		workspace: "/tmp/sonny-gateway-command-test",
		llm: { model: "openai/model-a", apiKey: "test-llm-key" },
		defaultAgent: "sonny",
		channels: {
			telegram: {
				enabled: true,
				botToken: "sensitive-telegram-token",
				allowedUserIds: ["sensitive-telegram-user"],
			},
		},
	});
}

function createConfigStore(): RuntimeConfigStore {
	const config = createConfig();
	const snapshot = {
		revision: 1,
		loadedAt: new Date("2026-01-01T00:00:00.000Z"),
		config,
	};

	return {
		current: snapshot,
		refresh: async () => ({ status: "unchanged", snapshot }),
	};
}

describe("runGatewayCommand", () => {
	test.each([
		"SIGINT",
		"SIGTERM",
	] as const)("aborts on %s and removes both signal handlers", async (signal) => {
		const configStore = createConfigStore();
		const events = new InMemoryRuntimeEventBus();
		const signals = new FakeSignals();
		const started = deferred<AbortSignal>();
		let constructionOptions: unknown;
		const execution = runGatewayCommand({
			configStore,
			events,
			signals,
			createGateway: async (options) => {
				constructionOptions = options;
				return {
					run: async (abortSignal) => {
						started.resolve(abortSignal);
						if (!abortSignal.aborted) {
							await new Promise<void>((resolve) =>
								abortSignal.addEventListener("abort", () => resolve(), {
									once: true,
								}),
							);
						}
					},
				};
			},
		});
		const abortSignal = await started.promise;

		expect(constructionOptions).toEqual({ configStore, events });
		expect(signals.listenerCount("SIGINT")).toBe(1);
		expect(signals.listenerCount("SIGTERM")).toBe(1);
		signals.emit(signal);
		await execution;

		expect(abortSignal.aborted).toBe(true);
		expect(signals.listenerCount("SIGINT")).toBe(0);
		expect(signals.listenerCount("SIGTERM")).toBe(0);
		expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
	});

	test("removes signal handlers when the gateway fails", async () => {
		const failure = new Error("polling failed");
		const signals = new FakeSignals();

		await expect(
			runGatewayCommand({
				configStore: createConfigStore(),
				signals,
				createGateway: async () => ({
					run: async () => {
						throw failure;
					},
				}),
			}),
		).rejects.toBe(failure);
		expect(signals.listenerCount("SIGINT")).toBe(0);
		expect(signals.listenerCount("SIGTERM")).toBe(0);
	});

	test("logs only safe startup metadata", async () => {
		const records: Array<{ message: string; fields?: LogFields }> = [];
		const logger: Logger = {
			debug: () => {},
			info: (message, fields) => records.push({ message, fields }),
			warn: () => {},
			error: () => {},
		};

		await runGatewayCommand({
			configStore: createConfigStore(),
			signals: new FakeSignals(),
			createGateway: async () => ({ run: async () => {} }),
			logger,
		});

		expect(records).toEqual([
			{
				message: "channel.gateway.started",
				fields: {
					enabledChannels: ["telegram"],
					mode: "long-polling",
					telegramAllowlistCount: 1,
					channelConfiguration: "restart-required",
				},
			},
			{
				message: "channel.gateway.stopped",
				fields: { enabledChannels: ["telegram"] },
			},
		]);
		const serializedRecords = JSON.stringify(records);
		expect(serializedRecords).not.toContain("sensitive-telegram-token");
		expect(serializedRecords).not.toContain("sensitive-telegram-user");
	});
});
