import { OpenRouter } from "@openrouter/sdk";
import type {
	DecisionsNoulQuestion,
	DecisionsRequest,
	DecisionsResponse,
} from "@openrouter/sdk/models";

/** Question ID mapped to a short true/false proposition about the state. */
export type DecisionQuestions = Record<string, string>;

/** Question ID mapped to the probability (0–1) that its proposition is true. */
export type DecisionProbabilities = Record<string, number>;

export type DecisionModelRequest = {
	state: Record<string, unknown>;
	questions: DecisionQuestions;
	signal?: AbortSignal;
};

/**
 * Judges a JSON state by answering a set of true/false questions about it.
 * Implementations reject rather than fabricate an answer.
 */
export interface DecisionModel {
	decide(request: DecisionModelRequest): Promise<DecisionProbabilities>;
}

export type DecisionsCreateRequest = { decisionsRequest: DecisionsRequest };

export type DecisionsCreateOptions = {
	signal?: AbortSignal;
};

/** The slice of the OpenRouter SDK the adapter needs; injectable for tests. */
export type DecisionsClient = {
	alpha: {
		decisions: {
			create: (
				request: DecisionsCreateRequest,
				options?: DecisionsCreateOptions,
			) => PromiseLike<DecisionsResponse>;
		};
	};
};

export type OpenRouterDecisionModelOptions = {
	model: string;
	apiKey: string;
	timeoutMs: number;
	client?: DecisionsClient;
};

export class DecisionModelError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "DecisionModelError";
	}
}

function toNoulQuestions(
	questions: DecisionQuestions,
): Record<string, DecisionsNoulQuestion> {
	return Object.fromEntries(
		Object.entries(questions).map(([id, instructions]) => [
			id,
			{ type: "noul", instructions },
		]),
	);
}

function toProbabilities(
	response: DecisionsResponse,
	questions: DecisionQuestions,
): DecisionProbabilities {
	const probabilities: DecisionProbabilities = {};

	for (const id of Object.keys(questions)) {
		const answer = response.answers[id];

		if (answer === undefined) {
			throw new DecisionModelError(`Decision model did not answer "${id}"`);
		}

		if (answer.type !== "noul" || !("noul" in answer)) {
			throw new DecisionModelError(
				`Decision model gave a non-noul answer for "${id}"`,
			);
		}

		const probability = answer.noul;

		if (
			typeof probability !== "number" ||
			!(probability >= 0 && probability <= 1)
		) {
			throw new DecisionModelError(
				`Decision model gave an out-of-range probability for "${id}"`,
			);
		}

		probabilities[id] = probability;
	}

	return probabilities;
}

/** Rejects when the signal aborts, so a client that ignores it cannot hang. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

function createDefaultClient(apiKey: string): DecisionsClient {
	return new OpenRouter({ apiKey });
}

/** Asks Jev (or a compatible model) through OpenRouter's Decisions API. */
export class OpenRouterDecisionModel implements DecisionModel {
	private readonly client: DecisionsClient;
	private readonly model: string;
	private readonly timeoutMs: number;

	constructor(options: OpenRouterDecisionModelOptions) {
		this.model = options.model;
		this.timeoutMs = options.timeoutMs;
		this.client = options.client ?? createDefaultClient(options.apiKey);
	}

	async decide({
		state,
		questions,
		signal,
	}: DecisionModelRequest): Promise<DecisionProbabilities> {
		signal?.throwIfAborted();

		const controller = new AbortController();
		const timeoutError = new DecisionModelError(
			`Decision model timed out after ${this.timeoutMs}ms`,
		);
		const timer = setTimeout(
			() => controller.abort(timeoutError),
			this.timeoutMs,
		);
		const forwardAbort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", forwardAbort, { once: true });

		try {
			const response = await Promise.race([
				this.client.alpha.decisions.create(
					{
						decisionsRequest: {
							model: this.model,
							state,
							questions: toNoulQuestions(questions),
						},
					},
					{ signal: controller.signal },
				),
				rejectOnAbort(controller.signal),
			]);

			return toProbabilities(response, questions);
		} catch (error) {
			if (controller.signal.aborted) {
				throw controller.signal.reason;
			}

			if (error instanceof DecisionModelError) {
				throw error;
			}

			throw new DecisionModelError("Decision model request failed", {
				cause: error,
			});
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", forwardAbort);
		}
	}
}
