import { describe, expect, test } from "bun:test";
import type { ToolPermissionRequest } from "./hooks/tool-hooks";
import {
	describeToolApproval,
	type ToolApprovalDescriptionLine,
} from "./tool-approval-description";
import type { ToolApprovalRequest } from "./tool-executor";

function request(
	toolName: string,
	parameters: unknown,
	description = "does a thing",
): ToolApprovalRequest {
	return {
		toolCallId: "call-1",
		toolName,
		description,
		parameters,
		turn: {
			sessionId: "session-1",
			turnId: "turn-1",
			source: { kind: "cli" },
		},
	};
}

describe("describeToolApproval", () => {
	test("uses the complete permission request as its public input", () => {
		const approvalRequest: ToolApprovalRequest = request("readFile", {
			path: "config.yaml",
		});
		const permissionRequest: ToolPermissionRequest = approvalRequest;

		expect(describeToolApproval(permissionRequest).toolName).toBe("readFile");
		expect(permissionRequest.turn).toEqual({
			sessionId: "session-1",
			turnId: "turn-1",
			source: { kind: "cli" },
		});
	});

	test("names what the approval action will do for each tool", () => {
		expect(describeToolApproval(request("bash", { command: "ls" })).verb).toBe(
			"run",
		);
		expect(describeToolApproval(request("editFile", {})).verb).toBe("apply");
		expect(describeToolApproval(request("writeFile", {})).verb).toBe("write");
		expect(describeToolApproval(request("webRead", {})).verb).toBe("fetch");
	});

	test("shows a command and its working directory", () => {
		const description = describeToolApproval(
			request("bash", { command: "rm -rf .history", cwd: "~/dev/sonny" }),
		);

		expect(description.lines).toEqual([
			{ kind: "command", text: "$ rm -rf .history" },
			{ kind: "context", text: "~/dev/sonny" },
		]);
	});

	test("shows an edit as removed then added lines", () => {
		const description = describeToolApproval(
			request("editFile", {
				path: "src/a.ts",
				oldText: "const t = 30_000;",
				newText: "const t = config.toolTimeoutMs;",
			}),
		);

		expect(description.lines).toEqual([
			{ kind: "field", label: "path", value: "src/a.ts" },
			{ kind: "removed", text: "-  const t = 30_000;" },
			{ kind: "added", text: "+  const t = config.toolTimeoutMs;" },
		]);
	});

	test("collapses the middle of a long diff rather than its end", () => {
		const description = describeToolApproval(
			request("editFile", {
				path: "src/a.ts",
				oldText: Array.from({ length: 20 }, (_, index) => `line ${index}`).join(
					"\n",
				),
				newText: "one line",
			}),
		);
		const collapsed = description.lines.filter(
			(line) => line.kind === "context" && line.text.includes("more removed"),
		);

		expect(collapsed).toHaveLength(1);
		expect(description.lines.at(-1)).toEqual({
			kind: "added",
			text: "+  one line",
		});
	});

	test("shows bounded write content and its full byte size", () => {
		const content = Array.from(
			{ length: 20 },
			(_, index) => `${index}-${"a".repeat(100)}`,
		).join("\n");
		const description = describeToolApproval(
			request("writeFile", { path: "theme.ts", content }),
		);
		const size = new TextEncoder().encode(content).byteLength;

		expect(description.lines[1]).toEqual({
			kind: "field",
			label: "size",
			value: `${(size / 1024).toFixed(1)} KB`,
		});
		expect(description.lines.length).toBeLessThanOrEqual(15);
		expect(description.lines.every((line) => lineText(line).length <= 64)).toBe(
			true,
		);
	});

	test("bounds command and path previews", () => {
		const command = describeToolApproval(
			request("bash", { command: "x".repeat(200), cwd: "y".repeat(200) }),
		);
		const path = describeToolApproval(
			request("readFile", { path: "z".repeat(200) }),
		);

		expect(command.lines.every((line) => lineText(line).length <= 64)).toBe(
			true,
		);
		expect(path.lines.every((line) => lineText(line).length <= 64)).toBe(true);
	});

	test("does not expose unrelated parameters or credentials", () => {
		const secret = "sk-secret-value";
		const description = describeToolApproval(
			request("readFile", {
				path: "config.yaml",
				token: secret,
				metadata: { password: secret },
			}),
		);

		expect(JSON.stringify(description)).not.toContain(secret);
		expect(description.lines).toEqual([
			{ kind: "field", label: "path", value: "config.yaml" },
		]);
	});
});

function lineText(line: ToolApprovalDescriptionLine): string {
	return line.kind === "field" ? line.value : line.text;
}
