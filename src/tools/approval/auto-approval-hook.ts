import type { ToolApprovalConfig } from "../../config";
import { createLogger } from "../../utils/logger";
import type {
	PostToolHook,
	PreToolContext,
	PreToolDecision,
	PreToolHook,
} from "../hooks/tool-hooks";
import {
	type ApprovalQuestion,
	approvalQuestionsForTool,
} from "./approval-questions";
import { capStringPayload } from "./cap-payload";
import {
	type CombinedApproval,
	combineApprovalAnswers,
} from "./combine-approval-answers";
import type { DecisionModel } from "./decision-model";

const logger = createLogger("tools.approval.auto-approval-hook");

export type AutoApprovalHookOptions = {
	decisionModel: DecisionModel;
	config: ToolApprovalConfig;
};

function joinPhrases(phrases: readonly string[]): string {
	if (phrases.length <= 1) {
		return phrases.join("");
	}

	return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

/**
 * Unlike a human denial, an automatic one is recoverable: the agent learns
 * which checks failed, in plain words and without scores, and may try a
 * safer route within the user's request.
 */
function createAutoDenialMessage(
	failedChecks: readonly ApprovalQuestion[],
): string {
	const reasons =
		failedChecks.length === 0
			? ""
			: ` because it ${joinPhrases(failedChecks.map((check) => check.denialPhrase))}`;

	return (
		`Sonny's automatic safety check refused this tool call${reasons}. ` +
		"This exact call will not run. You may continue with a safer approach " +
		"that stays within the user's request, or ask the user to confirm " +
		"before trying this action."
	);
}

function buildState(
	context: PreToolContext,
	config: ToolApprovalConfig,
): Record<string, unknown> {
	const previousCall = context.approval?.previousCall ?? null;

	return {
		user_messages:
			context.approval?.recentUserMessages(config.userMessageWindow) ?? [],
		previous_call:
			previousCall === null
				? null
				: {
						tool: previousCall.name,
						parameters: capStringPayload(
							previousCall.parameters,
							config.maxPayloadChars,
						),
						status: previousCall.status,
					},
		pending_call: {
			tool: context.toolName,
			description: context.description,
			parameters: capStringPayload(context.parameters, config.maxPayloadChars),
		},
	};
}

export type AutoApprovalHooks = {
	/** Asks the decision model to allow, deny or escalate the pending call. */
	preTool: PreToolHook;
	/** Runs only for calls that were allowed, so it ends a denial streak. */
	postTool: PostToolHook;
};

/**
 * Lets Jev (or another decision model) judge each call. The pair shares one
 * session's denial streak: once `maxConsecutiveDenials` automatic denials
 * happen in a row, a would-be deny goes to the user instead, until any call
 * runs again — whether the model or the user allowed it.
 */
export function createAutoApprovalHooks({
	decisionModel,
	config,
}: AutoApprovalHookOptions): AutoApprovalHooks {
	let consecutiveDenials = 0;

	const postTool: PostToolHook = () => {
		consecutiveDenials = 0;
	};

	const preTool: PreToolHook = async (context): Promise<PreToolDecision> => {
		const questions = approvalQuestionsForTool(context.toolName);
		let combined: CombinedApproval;

		try {
			const probabilities = await decisionModel.decide({
				state: buildState(context, config),
				questions: Object.fromEntries(
					questions.map((question) => [question.id, question.instructions]),
				),
				signal: context.signal,
			});
			combined = combineApprovalAnswers(
				probabilities,
				questions,
				config.thresholds,
			);
		} catch (error) {
			if (context.signal?.aborted) {
				throw error;
			}

			// A broken judge must never approve anything: fall back to the user.
			logger.warn("tool.auto_approval.unavailable", {
				toolName: context.toolName,
				toolCallId: context.toolCallId,
				error: error instanceof Error ? error.message : String(error),
			});
			return { action: "ask" };
		}

		const { outcome, failedChecks } = combined;

		if (outcome === "allow") {
			return { action: "allow", origin: "auto" };
		}

		if (outcome === "deny") {
			if (consecutiveDenials >= config.maxConsecutiveDenials) {
				return { action: "ask" };
			}

			consecutiveDenials += 1;
			return {
				action: "deny",
				origin: "auto",
				message: createAutoDenialMessage(failedChecks),
			};
		}

		return { action: "ask" };
	};

	return { preTool, postTool };
}
