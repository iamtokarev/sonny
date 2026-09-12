import { describe, expect, test } from "bun:test";
import type { ToolPermissionRequest } from "../tools/hooks/tool-hooks";
import type { ChannelOutput, ChannelSource } from "./channel";
import {
	ChannelApprovalBroker,
	type DeliverChannelOutput,
} from "./channel-approval-broker";

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

const channelSource = {
	kind: "channel",
	channel: "telegram",
	conversationId: "conversation-1",
	conversationKind: "direct",
	userId: "user-1",
} as const;

function request(
	overrides: Partial<ToolPermissionRequest> = {},
): ToolPermissionRequest {
	return {
		toolCallId: "call-1",
		toolName: "bash",
		description: "Run a shell command",
		parameters: {
			command: "bun test",
			credential: "must-not-leak",
		},
		turn: {
			sessionId: "session-1",
			turnId: "turn-1",
			source: channelSource,
		},
		...overrides,
	};
}

function actionSource(overrides: Partial<ChannelSource> = {}): ChannelSource {
	return {
		channel: channelSource.channel,
		conversationId: channelSource.conversationId,
		conversationKind: channelSource.conversationKind,
		userId: channelSource.userId,
		messageId: "action-1",
		...overrides,
	};
}

function captureDelivery(): {
	readonly outputs: ChannelOutput[];
	readonly deliver: DeliverChannelOutput;
} {
	const outputs: ChannelOutput[] = [];

	return {
		outputs,
		deliver: async (output) => {
			outputs.push(output);
		},
	};
}

function actionValue(output: ChannelOutput, label: "Approve" | "Deny"): string {
	const action = output.actions?.find((candidate) => candidate.label === label);

	if (!action) {
		throw new Error(`Missing ${label} action.`);
	}

	return action.value;
}

function trackedAbortSignal(): {
	readonly signal: AbortSignal;
	abort(): void;
	readonly addCount: () => number;
	readonly removeCount: () => number;
} {
	let listener: (() => void) | undefined;
	let additions = 0;
	let removals = 0;
	const signal = {
		aborted: false,
		addEventListener(type: string, candidate: () => void) {
			if (type === "abort") {
				additions += 1;
				listener = candidate;
			}
		},
		removeEventListener(type: string) {
			if (type === "abort") {
				removals += 1;
				listener = undefined;
			}
		},
	} as unknown as AbortSignal;

	return {
		signal,
		abort: () => listener?.(),
		addCount: () => additions,
		removeCount: () => removals,
	};
}

describe("ChannelApprovalBroker", () => {
	test("delivers one bounded semantic preview with opaque actions", () => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);

		void broker.request(
			request({
				parameters: {
					command: `bun test ${"x".repeat(100)}`,
					credential: "must-not-leak",
				},
			}),
		);

		expect(delivery.outputs).toHaveLength(1);
		const output = delivery.outputs[0] as ChannelOutput;
		expect(output).toMatchObject({
			target: {
				channel: "telegram",
				conversationId: "conversation-1",
			},
		});
		expect(output.text).toStartWith(
			"Approve run: bash?\nRun a shell command\n$ bun test ",
		);
		expect(output.text).not.toContain("must-not-leak");
		expect(output.text.split("\n").at(-1)?.length).toBeLessThanOrEqual(64);
		expect(output.actions?.map(({ label }) => label)).toEqual([
			"Approve",
			"Deny",
		]);

		for (const channelAction of output.actions ?? []) {
			expect(channelAction.value).toMatch(
				/^approval:[0-9a-f-]{36}:(allow|deny)$/,
			);
			expect(channelAction.value).not.toContain("bun test");
			expect(channelAction.value).not.toContain("must-not-leak");
		}

		broker.cancelAll("test cleanup");
	});

	test.each([
		["Approve", { approved: true }],
		[
			"Deny",
			{ approved: false, reason: "Tool call was denied through the channel." },
		],
	] as const)("resolves a matching %s action", async (label, expected) => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);
		const decision = broker.request(request());
		const value = actionValue(delivery.outputs[0] as ChannelOutput, label);

		expect(
			broker.resolve({ type: "action", source: actionSource(), value }),
		).toBe(true);
		await expect(decision).resolves.toEqual(expected);
	});

	test.each([
		{ channel: "other-channel" },
		{ conversationId: "other-conversation" },
		{ userId: "other-user" },
	] satisfies readonly Partial<ChannelSource>[])("keeps an approval pending after a wrong-source action", async (sourceOverride) => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);
		const decision = broker.request(request());
		const value = actionValue(delivery.outputs[0] as ChannelOutput, "Approve");
		let settled = false;
		void decision.then(() => {
			settled = true;
		});

		expect(
			broker.resolve({
				type: "action",
				source: actionSource(sourceOverride),
				value,
			}),
		).toBe(true);
		await Promise.resolve();
		expect(settled).toBe(false);

		broker.resolve({ type: "action", source: actionSource(), value });
		await expect(decision).resolves.toEqual({ approved: true });
	});

	test("consumes duplicate and expired approval actions harmlessly", async () => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);
		const decision = broker.request(request());
		const value = actionValue(delivery.outputs[0] as ChannelOutput, "Approve");
		const event = { type: "action", source: actionSource(), value } as const;

		expect(broker.resolve(event)).toBe(true);
		await expect(decision).resolves.toEqual({ approved: true });
		expect(broker.resolve(event)).toBe(true);
		expect(
			broker.resolve({
				...event,
				value: "approval:00000000-0000-4000-8000-000000000000:deny",
			}),
		).toBe(true);
	});

	test("reports unrelated actions as unhandled", () => {
		const broker = new ChannelApprovalBroker(async () => {});

		expect(
			broker.resolve({
				type: "action",
				source: actionSource(),
				value: "settings:open",
			}),
		).toBe(false);
		expect(
			broker.resolve({
				type: "action",
				source: actionSource(),
				value: "approval:not-a-uuid:allow",
			}),
		).toBe(false);
	});

	test("denies non-channel requests without delivery", async () => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);

		await expect(
			broker.request(
				request({
					turn: {
						sessionId: "session-1",
						turnId: "turn-1",
						source: { kind: "cli" },
					},
				}),
			),
		).resolves.toEqual({
			approved: false,
			reason:
				"Remote approval is only available for channel-originated tool calls.",
		});
		expect(delivery.outputs).toHaveLength(0);
	});

	test("denies and removes a timed-out approval", async () => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver, 1);
		const decision = broker.request(request());
		const value = actionValue(delivery.outputs[0] as ChannelOutput, "Approve");

		await expect(decision).resolves.toEqual({
			approved: false,
			reason: "Tool approval timed out.",
		});
		expect(
			broker.resolve({ type: "action", source: actionSource(), value }),
		).toBe(true);
	});

	test("denies cancellation and removes its abort listener once", async () => {
		const delivery = captureDelivery();
		const tracked = trackedAbortSignal();
		const broker = new ChannelApprovalBroker(delivery.deliver);
		const decision = broker.request(
			request({
				turn: {
					sessionId: "session-1",
					turnId: "turn-1",
					source: channelSource,
					signal: tracked.signal,
				},
			}),
		);

		expect(tracked.addCount()).toBe(1);
		tracked.abort();
		await expect(decision).resolves.toEqual({
			approved: false,
			reason: "Tool approval was cancelled because the turn ended.",
		});
		expect(tracked.removeCount()).toBe(1);
		tracked.abort();
		expect(tracked.removeCount()).toBe(1);
	});

	test("denies delivery failure and cleans up the pending request", async () => {
		const broker = new ChannelApprovalBroker(async () => {
			throw new Error("transport included a secret");
		});

		await expect(broker.request(request())).resolves.toEqual({
			approved: false,
			reason: "The approval request could not be delivered.",
		});
	});

	test("cancelAll denies and clears every pending request", async () => {
		const delivery = captureDelivery();
		const broker = new ChannelApprovalBroker(delivery.deliver);
		const first = broker.request(request());
		const second = broker.request(
			request({ toolCallId: "call-2", description: "Run another command" }),
		);

		expect(delivery.outputs).toHaveLength(2);
		broker.cancelAll("Approval broker stopped.");
		await expect(first).resolves.toEqual({
			approved: false,
			reason: "Approval broker stopped.",
		});
		await expect(second).resolves.toEqual({
			approved: false,
			reason: "Approval broker stopped.",
		});

		for (const output of delivery.outputs) {
			expect(
				broker.resolve({
					type: "action",
					source: actionSource(),
					value: actionValue(output, "Approve"),
				}),
			).toBe(true);
		}
	});

	test("drain waits for a detached approval delivery after cancellation", async () => {
		const delivery = deferred<void>();
		const broker = new ChannelApprovalBroker(() => delivery.promise);
		const decision = broker.request(request());
		let drained = false;

		broker.cancelAll("Gateway stopped.");
		await expect(decision).resolves.toEqual({
			approved: false,
			reason: "Gateway stopped.",
		});
		const drain = broker.drain().then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);

		delivery.resolve(undefined);
		await drain;
		expect(drained).toBe(true);
	});
});
