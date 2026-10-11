import type { ToolApprovalThresholds } from "../../config";
import {
	type ApprovalQuestion,
	requestedByUserQuestionId,
} from "./approval-questions";

export type ApprovalOutcome = "allow" | "deny" | "ask";

export interface CombinedApproval {
	readonly outcome: ApprovalOutcome;
	/**
	 * Danger questions at or above `deny.minDanger`, plus `requested_by_user`
	 * when at or below `deny.maxRequested`, in question order.
	 */
	readonly failedChecks: readonly ApprovalQuestion[];
}

/**
 * Turns the decision model's probabilities into an outcome. Danger is the
 * highest danger-role probability and requested is `requested_by_user`;
 * informational answers never count.
 */
export function combineApprovalAnswers(
	probabilities: Readonly<Record<string, number>>,
	questions: readonly ApprovalQuestion[],
	/** Probability bands; every boundary is inclusive. */
	thresholds: ToolApprovalThresholds,
): CombinedApproval {
	const answerOf = (question: ApprovalQuestion): number => {
		const probability = probabilities[question.id];

		if (probability === undefined) {
			throw new Error(`No answer for approval question ${question.id}`);
		}

		return probability;
	};

	let danger = 0;
	let requested = 0;
	const failedChecks: ApprovalQuestion[] = [];

	for (const question of questions) {
		const probability = answerOf(question);

		if (question.role === "danger") {
			danger = Math.max(danger, probability);

			if (probability >= thresholds.deny.minDanger) {
				failedChecks.push(question);
			}
		} else if (question.id === requestedByUserQuestionId) {
			requested = probability;

			if (probability <= thresholds.deny.maxRequested) {
				failedChecks.push(question);
			}
		}
	}

	if (
		danger >= thresholds.deny.minDanger &&
		requested <= thresholds.deny.maxRequested
	) {
		return { outcome: "deny", failedChecks };
	}

	if (
		danger <= thresholds.allow.maxDanger &&
		requested >= thresholds.allow.minRequested
	) {
		return { outcome: "allow", failedChecks };
	}

	return { outcome: "ask", failedChecks };
}
