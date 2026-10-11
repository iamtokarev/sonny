import { describe, expect, test } from "bun:test";
import { approvalQuestionsForTool } from "./approval-questions";
import {
	type ApprovalThresholds,
	combineApprovalAnswers,
} from "./combine-approval-answers";

const defaultThresholds: ApprovalThresholds = {
	allow: { maxDanger: 0.3, minRequested: 0.6 },
	deny: { minDanger: 0.8, maxRequested: 0.3 },
};

const bashQuestions = approvalQuestionsForTool("bash");

/** Bash answers that are all "no" unless overridden. */
function bashAnswers(
	overrides: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
	return {
		requested_by_user: 0,
		involves_secrets: 0,
		sends_local_data_out: 0,
		modifies_state: 0,
		destructive: 0,
		elevates_privileges: 0,
		executes_remote_code: 0,
		...overrides,
	};
}

function outcome(
	overrides: Readonly<Record<string, number>>,
	thresholds = defaultThresholds,
): string {
	return combineApprovalAnswers(
		bashAnswers(overrides),
		bashQuestions,
		thresholds,
	).outcome;
}

function failedCheckIds(
	overrides: Readonly<Record<string, number>>,
	thresholds = defaultThresholds,
): readonly string[] {
	return combineApprovalAnswers(
		bashAnswers(overrides),
		bashQuestions,
		thresholds,
	).failedChecks.map((question) => question.id);
}

describe("combineApprovalAnswers", () => {
	test("allows a requested, harmless call", () => {
		expect(outcome({ requested_by_user: 0.95, destructive: 0.05 })).toBe(
			"allow",
		);
	});

	test("denies a dangerous call nobody asked for", () => {
		expect(outcome({ requested_by_user: 0.1, destructive: 0.95 })).toBe("deny");
	});

	test("asks about a requested but dangerous call", () => {
		expect(outcome({ requested_by_user: 0.95, destructive: 0.95 })).toBe("ask");
	});

	test("asks about an unrequested call that is not clearly dangerous", () => {
		expect(outcome({ requested_by_user: 0.1, destructive: 0.5 })).toBe("ask");
	});

	test("takes danger from the most dangerous answer", () => {
		expect(
			outcome({
				requested_by_user: 0.1,
				involves_secrets: 0.2,
				executes_remote_code: 0.9,
			}),
		).toBe("deny");
		expect(
			outcome({ requested_by_user: 0.95, sends_local_data_out: 0.4 }),
		).toBe("ask");
	});

	test("does not count modifies_state as danger", () => {
		expect(outcome({ requested_by_user: 0.95, modifies_state: 1 })).toBe(
			"allow",
		);
		expect(outcome({ requested_by_user: 0.1, modifies_state: 1 })).toBe("ask");
		expect(
			failedCheckIds({ requested_by_user: 0.9, modifies_state: 1 }),
		).toEqual([]);
	});

	test("treats the allow boundaries as inclusive", () => {
		expect(outcome({ requested_by_user: 0.6, destructive: 0.3 })).toBe("allow");
		expect(outcome({ requested_by_user: 0.59, destructive: 0.3 })).toBe("ask");
		expect(outcome({ requested_by_user: 0.6, destructive: 0.31 })).toBe("ask");
	});

	test("treats the deny boundaries as inclusive", () => {
		expect(outcome({ requested_by_user: 0.3, destructive: 0.8 })).toBe("deny");
		expect(outcome({ requested_by_user: 0.31, destructive: 0.8 })).toBe("ask");
		expect(outcome({ requested_by_user: 0.3, destructive: 0.79 })).toBe("ask");
	});

	test("applies custom thresholds", () => {
		const strict: ApprovalThresholds = {
			allow: { maxDanger: 0.1, minRequested: 0.9 },
			deny: { minDanger: 0.5, maxRequested: 0.5 },
		};

		expect(
			outcome({ requested_by_user: 0.85, destructive: 0.05 }, strict),
		).toBe("ask");
		expect(outcome({ requested_by_user: 0.9, destructive: 0.1 }, strict)).toBe(
			"allow",
		);
		expect(outcome({ requested_by_user: 0.5, destructive: 0.5 }, strict)).toBe(
			"deny",
		);
		expect(
			failedCheckIds({ requested_by_user: 0.5, destructive: 0.5 }, strict),
		).toEqual(["requested_by_user", "destructive"]);
	});

	test("lists the danger checks at or above the deny threshold and an unrequested call", () => {
		expect(
			failedCheckIds({
				requested_by_user: 0.2,
				involves_secrets: 0.8,
				sends_local_data_out: 0.79,
				destructive: 0.95,
				elevates_privileges: 0.1,
			}),
		).toEqual(["requested_by_user", "involves_secrets", "destructive"]);
	});

	test("leaves requested_by_user out of failed checks when the user asked for it", () => {
		expect(
			failedCheckIds({ requested_by_user: 0.31, destructive: 0.9 }),
		).toEqual(["destructive"]);
	});

	test("returns failed checks with their denial phrases", () => {
		const result = combineApprovalAnswers(
			bashAnswers({ requested_by_user: 0, destructive: 1 }),
			bashQuestions,
			defaultThresholds,
		);

		expect(
			result.failedChecks.map((question) => question.denialPhrase),
		).toEqual(["was not requested by the user", "looks destructive"]);
	});

	test("refuses to combine when a question has no answer", () => {
		const { destructive: _omitted, ...incomplete } = bashAnswers({});

		expect(() =>
			combineApprovalAnswers(incomplete, bashQuestions, defaultThresholds),
		).toThrow("destructive");
	});
});
