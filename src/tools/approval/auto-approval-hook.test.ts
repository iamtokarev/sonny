import { beforeEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_TOOL_APPROVAL_CONFIG,
	type ToolApprovalConfig,
} from "../../config";
import type { ToolCall } from "../../domain";
import {
	InMemoryRuntimeEventBus,
	type RuntimeEvent,
	type TurnContext,
} from "../../events";
import { createDefaultToolHooks } from "../hooks/default-tool-hooks";
import type {
	ApprovalContext,
	ToolPermissionRequest,
} from "../hooks/tool-hooks";
import type { Tool } from "../tool";
import { ToolExecutor } from "../tool-executor";
import { ToolRegistry } from "../tool-registry";
import {
	type DecisionModel,
	DecisionModelError,
	type DecisionModelRequest,
	type DecisionProbabilities,
} from "./decision-model";

type Script =
	| DecisionProbabilities
	| ((request: DecisionModelRequest) => Promise<DecisionProbabilities>);

/** Answers every asked question with 0 unless the script says otherwise. */
class FakeDecisionModel implements DecisionModel {
	readonly requests: DecisionModelRequest[] = [];
	private readonly scripts: Script[] = [];

	answer(...scripts: Script[]): void {
		this.scripts.push(...scripts);
	}

	async decide(request: DecisionModelRequest): Promise<DecisionProbabilities> {
		this.requests.push(request);
		const script = this.scripts.shift() ?? {};

		if (typeof script === "function") {
			return script(request);
		}

		return Object.fromEntries(
			Object.keys(request.questions).map((id) => [id, script[id] ?? 0]),
		);
	}
}

const harmless = { requested_by_user: 0.95 };
const dangerousUnrequested = { requested_by_user: 0.05, destructive: 0.95 };
const requestedButRisky = { requested_by_user: 0.95, destructive: 0.95 };

function createTool(name: string, onExecute: () => void): Tool {
	return {
		name,
		description: `The ${name} tool`,
		parameters: { type: "object", properties: {} },
		execute: async () => {
			onExecute();
			return { ok: true, content: `${name} output` };
		},
	};
}

describe("auto approval through the tool executor", () => {
	let decisionModel: FakeDecisionModel;
	let permissionRequests: ToolPermissionRequest[];
	let userApproves: boolean;
	let executed: string[];
	let events: RuntimeEvent[];
	let turnContext: TurnContext;
	let registry: ToolRegistry;

	beforeEach(() => {
		decisionModel = new FakeDecisionModel();
		permissionRequests = [];
		userApproves = true;
		executed = [];
		events = [];
		const eventBus = new InMemoryRuntimeEventBus();
		eventBus.subscribe((event) => {
			events.push(event);
		});
		turnContext = {
			sessionId: "session-1",
			turnId: "turn-1",
			source: { kind: "cli" },
			events: eventBus,
		};
		registry = new ToolRegistry();
		for (const name of ["bash", "readFile", "writeFile", "webRead"]) {
			registry.register(createTool(name, () => executed.push(name)));
		}
	});

	function createExecutor(
		overrides: Partial<ToolApprovalConfig> = {},
	): ToolExecutor {
		return new ToolExecutor(
			registry,
			createDefaultToolHooks({
				permission: async (request) => {
					permissionRequests.push(request);
					return userApproves
						? { approved: true }
						: { approved: false, reason: "not now" };
				},
				toolApproval: { ...DEFAULT_TOOL_APPROVAL_CONFIG, ...overrides },
				decisionModel,
			}),
		);
	}

	let callCount = 0;
	function bash(command: string): ToolCall {
		callCount += 1;
		return { id: `call_${callCount}`, name: "bash", parameters: { command } };
	}

	function approvalOutcomes(): Array<string | undefined> {
		return events.flatMap((event) =>
			event.type === "tool.completed" ? [event.approval] : [],
		);
	}

	test("auto-allows a requested, harmless call without asking", async () => {
		decisionModel.answer(harmless);

		const result = await createExecutor().execute(bash("ls"), turnContext);

		expect(result).toEqual({ ok: true, content: "bash output" });
		expect(permissionRequests).toHaveLength(0);
		expect(executed).toEqual(["bash"]);
		expect(approvalOutcomes()).toEqual(["auto-approved"]);
	});

	test("auto-denies a dangerous, unrequested call with a recoverable message", async () => {
		decisionModel.answer({ ...dangerousUnrequested, involves_secrets: 0.9 });

		const result = await createExecutor().execute(
			bash("rm -rf ~"),
			turnContext,
		);

		expect(permissionRequests).toHaveLength(0);
		expect(executed).toEqual([]);
		expect(approvalOutcomes()).toEqual(["auto-denied"]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("denied");
		expect(result.error).not.toContain("BLOCKED");
		expect(result.error).not.toMatch(/\d/);
		expect(result.error).toContain("was not requested by the user");
		expect(result.error).toContain("involves secrets or credentials");
		expect(result.error).toContain("looks destructive");
		expect(result.error).not.toContain("sends local data to a remote host");
		expect(result.error).toContain("This exact call will not run");
		expect(result.error).toContain("safer approach");
		expect(result.error).toContain("ask the user");
	});

	test("asks the user about a requested but risky call", async () => {
		decisionModel.answer(requestedButRisky);

		await createExecutor().execute(bash("rm -rf build"), turnContext);

		expect(permissionRequests).toHaveLength(1);
		expect(executed).toEqual(["bash"]);
		expect(approvalOutcomes()).toEqual(["user-approved"]);
	});

	test("keeps the strict BLOCKED message when the user denies an asked call", async () => {
		decisionModel.answer(requestedButRisky);
		userApproves = false;

		const result = await createExecutor().execute(
			bash("rm -rf build"),
			turnContext,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toStartWith("BLOCKED:");
		expect(approvalOutcomes()).toEqual(["user-denied"]);
	});

	test("treats the threshold boundaries as inclusive", async () => {
		const executor = createExecutor();
		decisionModel.answer(
			{ requested_by_user: 0.6, destructive: 0.3 },
			{ requested_by_user: 0.3, destructive: 0.8 },
			{ requested_by_user: 0.59, destructive: 0.3 },
		);

		for (let i = 0; i < 3; i++) {
			await executor.execute(bash("ls"), turnContext);
		}

		expect(approvalOutcomes()).toEqual([
			"auto-approved",
			"auto-denied",
			"user-approved",
		]);
	});

	test("applies custom thresholds from config", async () => {
		const executor = createExecutor({
			thresholds: {
				allow: { maxDanger: 0.1, minRequested: 0.99 },
				deny: { minDanger: 0.5, maxRequested: 0.5 },
			},
		});
		decisionModel.answer(harmless, {
			requested_by_user: 0.5,
			destructive: 0.5,
		});

		await executor.execute(bash("ls"), turnContext);
		await executor.execute(bash("ls"), turnContext);

		expect(approvalOutcomes()).toEqual(["user-approved", "auto-denied"]);
	});

	test("file and URL policies deny before the decision model is asked", async () => {
		const executor = createExecutor();

		await executor.execute(
			{ id: "call_env", name: "readFile", parameters: { path: ".env" } },
			turnContext,
		);
		await executor.execute(
			{
				id: "call_url",
				name: "webRead",
				parameters: { url: "http://169.254.169.254/latest/meta-data" },
			},
			turnContext,
		);

		expect(decisionModel.requests).toHaveLength(0);
		expect(permissionRequests).toHaveLength(0);
		expect(executed).toEqual([]);
		expect(approvalOutcomes()).toEqual(["policy-blocked", "policy-blocked"]);
	});

	test("manual mode asks about every call and never consults the model", async () => {
		const executor = createExecutor({ mode: "manual" });

		await executor.execute(bash("ls"), turnContext);
		await executor.execute(
			{ id: "call_read", name: "readFile", parameters: { path: "a.txt" } },
			turnContext,
		);

		expect(decisionModel.requests).toHaveLength(0);
		expect(permissionRequests.map((request) => request.toolName)).toEqual([
			"bash",
			"readFile",
		]);
		expect(approvalOutcomes()).toEqual(["user-approved", "user-approved"]);
	});

	describe("the request sent to the decision model", () => {
		const approvalContext: ApprovalContext = {
			recentUserMessages: (limit) =>
				["first", "second", "third", "fourth"].slice(-limit),
			previousCall: {
				name: "readFile",
				parameters: { path: "notes.md" },
				status: "succeeded",
			},
		};

		test("holds the user's recent messages, the previous call and the pending call", async () => {
			decisionModel.answer(harmless);

			await createExecutor({ userMessageWindow: 2 }).execute(
				bash("ls -la"),
				turnContext,
				approvalContext,
			);

			const [request] = decisionModel.requests;
			expect(request?.state).toEqual({
				user_messages: ["third", "fourth"],
				previous_call: {
					tool: "readFile",
					parameters: { path: "notes.md" },
					status: "succeeded",
				},
				pending_call: {
					tool: "bash",
					description: "The bash tool",
					parameters: { command: "ls -la" },
				},
			});
		});

		test("starts empty without a conversation", async () => {
			decisionModel.answer(harmless);

			await createExecutor().execute(bash("ls"), turnContext);

			expect(decisionModel.requests[0]?.state).toMatchObject({
				user_messages: [],
				previous_call: null,
			});
		});

		test("asks the question set for the pending tool", async () => {
			decisionModel.answer(harmless, harmless);
			const executor = createExecutor();

			await executor.execute(bash("ls"), turnContext);
			await executor.execute(
				{ id: "call_read", name: "readFile", parameters: { path: "a.txt" } },
				turnContext,
			);

			expect(
				decisionModel.requests.map((request) => Object.keys(request.questions)),
			).toEqual([
				[
					"requested_by_user",
					"involves_secrets",
					"sends_local_data_out",
					"modifies_state",
					"destructive",
					"elevates_privileges",
					"executes_remote_code",
				],
				["requested_by_user", "involves_secrets", "sends_local_data_out"],
			]);
			expect(decisionModel.requests[0]?.questions.destructive).toContain(
				"`pending_call`",
			);
		});
	});

	describe("large payloads", () => {
		const omissionMarker = /\[(\d+) characters omitted\]/;

		function sentParameters(index = 0): Record<string, string> {
			const state = decisionModel.requests[index]?.state as {
				pending_call: { parameters: Record<string, string> };
			};
			return state.pending_call.parameters;
		}

		test("arrive capped with head, tail and an omission marker, and are still judged", async () => {
			decisionModel.answer(harmless);
			const content = `HEAD${"x".repeat(20_000)}TAIL`;

			const result = await createExecutor({ maxPayloadChars: 1000 }).execute(
				{
					id: "call_write",
					name: "writeFile",
					parameters: { path: "big.txt", content },
				},
				turnContext,
			);

			const sent = sentParameters();
			expect(sent.path).toEndWith("big.txt");
			expect(sent.content).toStartWith("HEAD");
			expect(sent.content).toEndWith("TAIL");
			const omitted = Number(sent.content?.match(omissionMarker)?.[1]);
			const kept =
				(sent.content?.length ?? 0) -
				(sent.content?.match(omissionMarker)?.[0].length ?? 0);
			expect(kept + omitted).toBe(content.length);
			expect(kept + (sent.path?.length ?? 0)).toBeLessThanOrEqual(1000);
			expect(permissionRequests).toHaveLength(0);
			expect(result.ok).toBe(true);
			expect(approvalOutcomes()).toEqual(["auto-approved"]);
		});

		test("share the cap across every large string parameter", async () => {
			decisionModel.answer(harmless);

			await createExecutor({ maxPayloadChars: 2000 }).execute(
				{
					id: "call_edit",
					name: "writeFile",
					parameters: {
						path: "a.ts",
						oldText: "o".repeat(5000),
						newText: "n".repeat(3000),
					},
				},
				turnContext,
			);

			const sent = sentParameters();
			expect(sent.oldText).toMatch(omissionMarker);
			expect(sent.newText).toMatch(omissionMarker);
			const keptTotal = Object.values(sent)
				.map((value) => value.replace(omissionMarker, "").length)
				.reduce((sum, length) => sum + length, 0);
			expect(keptTotal).toBeLessThanOrEqual(2000);
		});

		test("pass through unchanged when within the cap", async () => {
			decisionModel.answer(harmless);
			const parameters = { path: "a.txt", content: "y".repeat(500) };

			await createExecutor({ maxPayloadChars: 1000 }).execute(
				{ id: "call_small", name: "writeFile", parameters },
				turnContext,
			);

			expect(sentParameters().content).toBe(parameters.content);
		});
	});

	describe("denial streak", () => {
		async function run(
			executor: ToolExecutor,
			...scripts: Script[]
		): Promise<void> {
			for (const script of scripts) {
				decisionModel.answer(script);
				await executor.execute(bash("rm -rf /"), turnContext);
			}
		}

		test("asks the user instead of a fourth consecutive auto deny", async () => {
			const executor = createExecutor();
			userApproves = false;

			await run(
				executor,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
			);

			expect(approvalOutcomes()).toEqual([
				"auto-denied",
				"auto-denied",
				"auto-denied",
				"user-denied",
				"user-denied",
			]);
		});

		test("an auto-allowed call resets the streak", async () => {
			const executor = createExecutor();

			await run(
				executor,
				dangerousUnrequested,
				dangerousUnrequested,
				harmless,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
			);

			expect(approvalOutcomes()).toEqual([
				"auto-denied",
				"auto-denied",
				"auto-approved",
				"auto-denied",
				"auto-denied",
				"auto-denied",
				"user-approved",
			]);
		});

		test("a user-approved call resets the streak", async () => {
			const executor = createExecutor();

			await run(
				executor,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
				dangerousUnrequested,
			);

			expect(approvalOutcomes()).toEqual([
				"auto-denied",
				"auto-denied",
				"auto-denied",
				"user-approved",
				"auto-denied",
			]);
		});

		test("honours a configured streak limit", async () => {
			const executor = createExecutor({ maxConsecutiveDenials: 1 });

			await run(executor, dangerousUnrequested, dangerousUnrequested);

			expect(approvalOutcomes()).toEqual(["auto-denied", "user-approved"]);
		});
	});

	describe("when the decision model cannot answer", () => {
		const failures: Array<[string, Script]> = [
			[
				"throws",
				async () => {
					throw new DecisionModelError("Decision model request failed");
				},
			],
			[
				"times out",
				async () => {
					throw new DecisionModelError("Decision model timed out after 5000ms");
				},
			],
			["returns a malformed answer", async () => ({ requested_by_user: 1 })],
		];

		for (const [name, script] of failures) {
			test(`asks the user when it ${name}`, async () => {
				decisionModel.answer(script);

				await createExecutor().execute(bash("ls"), turnContext);

				expect(decisionModel.requests).toHaveLength(1);
				expect(permissionRequests).toHaveLength(1);
				expect(executed).toEqual(["bash"]);
				expect(approvalOutcomes()).toEqual(["user-approved"]);
			});
		}

		test("propagates a turn cancellation instead of asking", async () => {
			const controller = new AbortController();
			const cancelled = new Error("turn cancelled");
			decisionModel.answer(async (request) => {
				controller.abort(cancelled);
				throw request.signal?.reason;
			});

			const execution = createExecutor().execute(bash("ls"), {
				...turnContext,
				signal: controller.signal,
			});

			await expect(execution).rejects.toBe(cancelled);
			expect(permissionRequests).toHaveLength(0);
			expect(executed).toEqual([]);
		});
	});
});
