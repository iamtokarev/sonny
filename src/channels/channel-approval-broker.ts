import { randomUUID } from "node:crypto";
import type { RuntimeSource } from "../events";
import type {
	ToolPermissionDecision,
	ToolPermissionRequest,
} from "../tools/hooks/tool-hooks";
import { describeToolApproval } from "../tools/tool-approval-description";
import type { ChannelEvent, ChannelOutput } from "./channel";
import { toChannelTarget } from "./channel";
import { createChannelSessionKey } from "./channel-session-binding-store";

export type DeliverChannelOutput = (
	output: ChannelOutput,
	signal?: AbortSignal,
) => Promise<void>;

type ChannelRuntimeSource = Extract<RuntimeSource, { kind: "channel" }>;
type ApprovalAction = Extract<ChannelEvent, { type: "action" }>;
type ApprovalDecision = "allow" | "deny";

interface PendingApproval {
	readonly sourceKey: string;
	readonly userId: string;
	readonly resolve: (decision: ToolPermissionDecision) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
	readonly signal?: AbortSignal;
	readonly abortListener?: () => void;
}

interface PendingDelivery {
	readonly sourceKey: string;
	readonly abort: AbortController;
}

const approvalActionPattern =
	/^approval:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(allow|deny)$/i;

const nonChannelReason =
	"Remote approval is only available for channel-originated tool calls.";
const timeoutReason = "Tool approval timed out.";
const cancellationReason =
	"Tool approval was cancelled because the turn ended.";
const deliveryFailureReason = "The approval request could not be delivered.";
const channelDenialReason = "Tool call was denied through the channel.";

function formatChannelApproval(request: ToolPermissionRequest): string {
	const description = describeToolApproval(request);
	const lines = description.lines.map((line) =>
		line.kind === "field" ? `${line.label}: ${line.value}` : line.text,
	);

	return [
		`Approve ${description.verb}: ${description.toolName}?`,
		description.description,
		...lines,
	].join("\n");
}

function approvalOutput(
	request: ToolPermissionRequest,
	source: ChannelRuntimeSource,
	id: string,
): ChannelOutput {
	return {
		target: toChannelTarget(source),
		text: formatChannelApproval(request),
		actions: [
			{ label: "Approve", value: `approval:${id}:allow` },
			{ label: "Deny", value: `approval:${id}:deny` },
		],
	};
}

export class ChannelApprovalBroker {
	private readonly pending = new Map<string, PendingApproval>();
	private readonly deliveries = new Map<Promise<void>, PendingDelivery>();

	constructor(
		private readonly deliver: DeliverChannelOutput,
		private readonly timeoutMs = 5 * 60_000,
	) {}

	request(request: ToolPermissionRequest): Promise<ToolPermissionDecision> {
		const source = request.turn.source;

		if (source.kind !== "channel") {
			return Promise.resolve({ approved: false, reason: nonChannelReason });
		}

		if (request.turn.signal?.aborted) {
			return Promise.resolve({ approved: false, reason: cancellationReason });
		}

		const id = randomUUID();

		return new Promise((resolve) => {
			const sourceKey = createChannelSessionKey(source);
			const timeout = setTimeout(() => {
				this.settle(id, { approved: false, reason: timeoutReason });
			}, this.timeoutMs);
			const abortListener = request.turn.signal
				? () => {
						this.settle(id, {
							approved: false,
							reason: cancellationReason,
						});
					}
				: undefined;

			this.pending.set(id, {
				sourceKey,
				userId: source.userId,
				resolve,
				timeout,
				signal: request.turn.signal,
				abortListener,
			});

			if (abortListener) {
				request.turn.signal?.addEventListener("abort", abortListener, {
					once: true,
				});
			}

			let delivery: Promise<void>;
			const deliveryAbort = new AbortController();
			const abortDeliveryFromTurn = request.turn.signal
				? () => deliveryAbort.abort()
				: undefined;
			if (abortDeliveryFromTurn) {
				request.turn.signal?.addEventListener("abort", abortDeliveryFromTurn, {
					once: true,
				});
			}

			try {
				delivery = this.deliver(
					approvalOutput(request, source, id),
					deliveryAbort.signal,
				);
			} catch {
				if (abortDeliveryFromTurn) {
					request.turn.signal?.removeEventListener(
						"abort",
						abortDeliveryFromTurn,
					);
				}
				this.settle(id, { approved: false, reason: deliveryFailureReason });
				return;
			}

			const tracked = delivery.catch(() => {
				this.settle(id, { approved: false, reason: deliveryFailureReason });
			});
			this.deliveries.set(tracked, {
				sourceKey,
				abort: deliveryAbort,
			});
			void tracked.finally(() => {
				this.deliveries.delete(tracked);
				if (abortDeliveryFromTurn) {
					request.turn.signal?.removeEventListener(
						"abort",
						abortDeliveryFromTurn,
					);
				}
			});
		});
	}

	resolve(event: ApprovalAction): boolean {
		const match = approvalActionPattern.exec(event.value);

		if (!match) {
			return false;
		}

		const [, id, decision] = match as RegExpExecArray & {
			readonly 1: string;
			readonly 2: ApprovalDecision;
		};
		const pending = this.pending.get(id);

		if (!pending) {
			return true;
		}

		if (
			pending.sourceKey !== createChannelSessionKey(event.source) ||
			pending.userId !== event.source.userId
		) {
			return true;
		}

		this.settle(
			id,
			decision === "allow"
				? { approved: true }
				: { approved: false, reason: channelDenialReason },
		);

		return true;
	}

	cancelAll(reason: string): void {
		for (const id of [...this.pending.keys()]) {
			this.settle(id, { approved: false, reason });
		}

		for (const delivery of this.deliveries.values()) {
			delivery.abort.abort();
		}
	}

	cancelConversation(sourceKey: string, reason: string): void {
		for (const [id, pending] of this.pending) {
			if (pending.sourceKey === sourceKey) {
				this.settle(id, { approved: false, reason });
			}
		}

		for (const delivery of this.deliveries.values()) {
			if (delivery.sourceKey === sourceKey) {
				delivery.abort.abort();
			}
		}
	}

	async drain(): Promise<void> {
		while (this.deliveries.size > 0) {
			await Promise.allSettled(this.deliveries.keys());
		}
	}

	async drainConversation(sourceKey: string): Promise<void> {
		while (true) {
			const deliveries = [...this.deliveries]
				.filter(([, delivery]) => delivery.sourceKey === sourceKey)
				.map(([promise]) => promise);

			if (deliveries.length === 0) {
				return;
			}

			await Promise.allSettled(deliveries);
		}
	}

	private settle(id: string, decision: ToolPermissionDecision): boolean {
		const pending = this.pending.get(id);

		if (!pending) {
			return false;
		}

		this.pending.delete(id);
		clearTimeout(pending.timeout);

		if (pending.signal && pending.abortListener) {
			pending.signal.removeEventListener("abort", pending.abortListener);
		}

		pending.resolve(decision);

		return true;
	}
}
