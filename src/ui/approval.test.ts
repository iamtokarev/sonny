import { describe, expect, test } from "bun:test";
import type { ToolApprovalRequest } from "../tools/tool-executor";
import { describeApproval } from "./approval";

function request(
	toolName: string,
	parameters: unknown,
	description = "does a thing",
): ToolApprovalRequest {
	return { toolCallId: "call-1", toolName, description, parameters };
}

describe("describeApproval", () => {
	test("names what the y key will do, per tool", () => {
		expect(describeApproval(request("bash", { command: "ls" })).verb).toBe(
			"run",
		);
		expect(describeApproval(request("editFile", {})).verb).toBe("apply");
		expect(describeApproval(request("writeFile", {})).verb).toBe("write");
		expect(describeApproval(request("webRead", {})).verb).toBe("fetch");
	});

	test("shows a command verbatim, with its working directory", () => {
		const model = describeApproval(
			request("bash", { command: "rm -rf .history", cwd: "~/dev/sonny" }),
		);

		expect(model.body).toEqual([
			{ kind: "command", text: "$ rm -rf .history" },
			{ kind: "context", text: "~/dev/sonny" },
		]);
	});

	test("shows an edit as removed then added lines", () => {
		const model = describeApproval(
			request("editFile", {
				path: "src/a.ts",
				oldText: "const t = 30_000;",
				newText: "const t = config.toolTimeoutMs;",
			}),
		);

		expect(model.body).toEqual([
			{ kind: "field", label: "path", value: "src/a.ts" },
			{ kind: "removed", text: "-  const t = 30_000;" },
			{ kind: "added", text: "+  const t = config.toolTimeoutMs;" },
		]);
	});

	test("collapses the middle of a long diff rather than its end", () => {
		const model = describeApproval(
			request("editFile", {
				path: "src/a.ts",
				oldText: Array.from({ length: 20 }, (_, index) => `line ${index}`).join(
					"\n",
				),
				newText: "one line",
			}),
		);
		const collapsed = model.body.filter(
			(line) => line.kind === "context" && line.text.includes("more removed"),
		);

		expect(collapsed).toHaveLength(1);
		expect(model.body.at(-1)).toEqual({
			kind: "added",
			text: "+  one line",
		});
	});

	test("calls out the size of a write", () => {
		const model = describeApproval(
			request("writeFile", { path: "theme.ts", content: "a".repeat(1229) }),
		);

		expect(model.body[1]).toEqual({
			kind: "field",
			label: "size",
			value: "1.2 KB",
		});
	});

	test("keeps read-only tools to the quiet form", () => {
		expect(
			describeApproval(request("readFile", { path: "config.yaml" })).body,
		).toEqual([{ kind: "field", label: "path", value: "config.yaml" }]);
	});
});
