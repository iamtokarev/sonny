import { describe, expect, test } from "bun:test";
import {
	type ApprovalQuestion,
	approvalQuestionsForTool,
} from "./approval-questions";

function ids(toolName: string): readonly string[] {
	return approvalQuestionsForTool(toolName).map((question) => question.id);
}

function questionsAcrossTools(): readonly ApprovalQuestion[] {
	return [
		...approvalQuestionsForTool("bash"),
		...approvalQuestionsForTool("writeFile"),
		...approvalQuestionsForTool("webRead"),
	];
}

const shared = [
	"requested_by_user",
	"involves_secrets",
	"sends_local_data_out",
];

describe("approvalQuestionsForTool", () => {
	test("asks only the shared questions for read-only and unknown tools", () => {
		for (const toolName of [
			"readFile",
			"webSearch",
			"loadSkill",
			"mystery",
			"constructor",
		]) {
			expect(ids(toolName)).toEqual(shared);
		}
	});

	test("adds the bash questions for bash", () => {
		expect(ids("bash")).toEqual([
			...shared,
			"modifies_state",
			"destructive",
			"elevates_privileges",
			"executes_remote_code",
		]);
	});

	test("adds the file-mutation questions for writeFile and editFile", () => {
		for (const toolName of ["writeFile", "editFile"]) {
			expect(ids(toolName)).toEqual([
				...shared,
				"targets_system_or_dotfile",
				"removes_substantial_content",
			]);
		}
	});

	test("adds the URL question for webRead", () => {
		expect(ids("webRead")).toEqual([...shared, "url_embeds_local_data"]);
	});

	test("gives each question the role the spec assigns", () => {
		const roles = Object.fromEntries(
			questionsAcrossTools().map((question) => [question.id, question.role]),
		);

		expect(roles).toEqual({
			requested_by_user: "intent",
			involves_secrets: "danger",
			sends_local_data_out: "danger",
			modifies_state: "informational",
			destructive: "danger",
			elevates_privileges: "danger",
			executes_remote_code: "danger",
			targets_system_or_dotfile: "danger",
			removes_substantial_content: "danger",
			url_embeds_local_data: "danger",
		});
	});

	test("phrases every question about the backticked pending call", () => {
		for (const question of questionsAcrossTools()) {
			expect(question.instructions).toContain("`pending_call`");
			expect(question.denialPhrase.length).toBeGreaterThan(0);
			expect(question.denialPhrase).not.toMatch(/\d/);
		}
	});

	test("judges intent and leaked URL data against the user's messages", () => {
		const byId = new Map(
			approvalQuestionsForTool("webRead").map((question) => [
				question.id,
				question.instructions,
			]),
		);

		expect(byId.get("requested_by_user")).toContain("`user_messages`");
		expect(byId.get("url_embeds_local_data")).toContain("`user_messages`");
	});
});
