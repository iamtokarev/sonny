import { describe, expect, test } from "bun:test";
import type { DecisionsResponse } from "@openrouter/sdk/models";
import {
	DecisionModelError,
	type DecisionsClient,
	type DecisionsCreateOptions,
	type DecisionsCreateRequest,
	OpenRouterDecisionModel,
} from "./decision-model";

type RecordedCall = {
	request: DecisionsCreateRequest;
	options?: DecisionsCreateOptions;
};

function createFakeClient(
	respond: (
		request: DecisionsCreateRequest,
		options?: DecisionsCreateOptions,
	) => Promise<DecisionsResponse>,
): { client: DecisionsClient; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];

	return {
		calls,
		client: {
			alpha: {
				decisions: {
					create: (request, options) => {
						calls.push({ request, options });
						return respond(request, options);
					},
				},
			},
		},
	};
}

function response(answers: DecisionsResponse["answers"]): DecisionsResponse {
	return {
		answers,
		model: "typesafe/jev-1.13",
		usage: { inputTokens: 10, outputTokens: 2 },
	};
}

function hangUntilAborted(
	_request: DecisionsCreateRequest,
	options?: DecisionsCreateOptions,
): Promise<DecisionsResponse> {
	return new Promise((_resolve, reject) => {
		options?.signal?.addEventListener("abort", () =>
			reject(new Error("request aborted")),
		);
	});
}

const state = {
	user_messages: ["delete the build folder"],
	pending_call: { tool: "bash", parameters: { command: "rm -rf build" } },
};

const questions = {
	requested_by_user: "`pending_call` does what `user_messages` ask for.",
	destructive: "`pending_call` irreversibly deletes data.",
};

describe("OpenRouterDecisionModel", () => {
	test("asks the pinned model noul questions about the state and returns probabilities", async () => {
		const { client, calls } = createFakeClient(async () =>
			response({
				requested_by_user: { type: "noul", noul: 0.92 },
				destructive: { type: "noul", noul: 0.85 },
			}),
		);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});

		const probabilities = await model.decide({ state, questions });

		expect(probabilities).toEqual({
			requested_by_user: 0.92,
			destructive: 0.85,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.request).toEqual({
			decisionsRequest: {
				model: "typesafe/jev-1.13",
				state,
				questions: {
					requested_by_user: {
						type: "noul",
						instructions: questions.requested_by_user,
					},
					destructive: {
						type: "noul",
						instructions: questions.destructive,
					},
				},
			},
		});
	});

	test("ignores answers to questions that were not asked", async () => {
		const { client } = createFakeClient(async () =>
			response({
				requested_by_user: { type: "noul", noul: 1 },
				destructive: { type: "noul", noul: 0 },
				extra: { type: "noul", noul: 0.5 },
			}),
		);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});

		expect(await model.decide({ state, questions })).toEqual({
			requested_by_user: 1,
			destructive: 0,
		});
	});

	test.each([
		[
			"an answer is missing",
			{ requested_by_user: { type: "noul" as const, noul: 0.9 } },
		],
		[
			"an answer is not noul",
			{
				requested_by_user: { type: "noul" as const, noul: 0.9 },
				destructive: { type: "score" as const, score: 0.4 },
			},
		],
		[
			"a probability is above 1",
			{
				requested_by_user: { type: "noul" as const, noul: 1.2 },
				destructive: { type: "noul" as const, noul: 0.1 },
			},
		],
		[
			"a probability is negative",
			{
				requested_by_user: { type: "noul" as const, noul: 0.9 },
				destructive: { type: "noul" as const, noul: -0.1 },
			},
		],
		[
			"a probability is not a number",
			{
				requested_by_user: { type: "noul" as const, noul: Number.NaN },
				destructive: { type: "noul" as const, noul: 0.1 },
			},
		],
	])("rejects when %s", async (_label, answers) => {
		const { client } = createFakeClient(async () =>
			response(answers as DecisionsResponse["answers"]),
		);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});

		await expect(model.decide({ state, questions })).rejects.toBeInstanceOf(
			DecisionModelError,
		);
	});

	test("rejects when the SDK call fails", async () => {
		const { client } = createFakeClient(async () => {
			throw new Error("502 Bad Gateway");
		});
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});

		await expect(model.decide({ state, questions })).rejects.toBeInstanceOf(
			DecisionModelError,
		);
	});

	test("aborts the request and rejects after timeoutMs", async () => {
		const { client, calls } = createFakeClient(hangUntilAborted);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 20,
			client,
		});

		await expect(model.decide({ state, questions })).rejects.toThrow(
			"timed out",
		);
		expect(calls[0]?.options?.signal?.aborted).toBe(true);
	});

	test("times out even when the client ignores the abort signal", async () => {
		const { client } = createFakeClient(() => new Promise(() => {}));
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 20,
			client,
		});

		await expect(model.decide({ state, questions })).rejects.toThrow(
			"timed out",
		);
	});

	test("honours an external abort signal with its own reason", async () => {
		const { client, calls } = createFakeClient(hangUntilAborted);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});
		const controller = new AbortController();
		const cancelled = new Error("turn cancelled");

		const decision = model.decide({
			state,
			questions,
			signal: controller.signal,
		});
		controller.abort(cancelled);

		await expect(decision).rejects.toBe(cancelled);
		expect(calls[0]?.options?.signal?.aborted).toBe(true);
	});

	test("does not call the model when the signal is already aborted", async () => {
		const { client, calls } = createFakeClient(hangUntilAborted);
		const model = new OpenRouterDecisionModel({
			model: "typesafe/jev-1.13",
			apiKey: "test-key",
			timeoutMs: 5000,
			client,
		});
		const cancelled = new Error("turn cancelled");

		await expect(
			model.decide({
				state,
				questions,
				signal: AbortSignal.abort(cancelled),
			}),
		).rejects.toBe(cancelled);
		expect(calls).toHaveLength(0);
	});
});
