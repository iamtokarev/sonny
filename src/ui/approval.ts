import type { ToolApprovalRequest } from "../tools/tool-executor";
import { formatBytes, truncate } from "./tool-row";

/**
 * The verb on `y` changes per tool, so the key you press names what happens.
 */
const verbs: Record<string, string> = {
	bash: "run",
	readFile: "read",
	writeFile: "write",
	editFile: "apply",
	webSearch: "search",
	webRead: "fetch",
	loadSkill: "load",
};

export type ApprovalBodyLine =
	| { kind: "field"; label: string; value: string }
	| { kind: "command"; text: string }
	| { kind: "added"; text: string }
	| { kind: "removed"; text: string }
	| { kind: "context"; text: string }
	| { kind: "warn"; text: string };

export type ApprovalModel = {
	toolName: string;
	description: string;
	verb: string;
	body: ApprovalBodyLine[];
};

const maxDiffLines = 12;
const maxBodyWidth = 64;

function readString(parameters: unknown, key: string): string | null {
	if (typeof parameters !== "object" || parameters === null) {
		return null;
	}

	const value = (parameters as Record<string, unknown>)[key];

	return typeof value === "string" ? value : null;
}

/** Caps a block at `maxDiffLines`, collapsing the middle rather than the end. */
function clampLines(lines: string[]): { lines: string[]; hidden: number } {
	if (lines.length <= maxDiffLines) {
		return { lines, hidden: 0 };
	}

	const head = Math.ceil(maxDiffLines / 2);
	const tail = maxDiffLines - head;

	return {
		lines: [...lines.slice(0, head), ...lines.slice(lines.length - tail)],
		hidden: lines.length - maxDiffLines,
	};
}

function diffBody(oldText: string, newText: string): ApprovalBodyLine[] {
	const removed = clampLines(oldText.split("\n"));
	const added = clampLines(newText.split("\n"));
	const body: ApprovalBodyLine[] = [];

	for (const line of removed.lines) {
		body.push({ kind: "removed", text: truncate(`-  ${line}`, maxBodyWidth) });
	}

	if (removed.hidden > 0) {
		body.push({
			kind: "context",
			text: `⋮ ${removed.hidden} more removed lines`,
		});
	}

	for (const line of added.lines) {
		body.push({ kind: "added", text: truncate(`+  ${line}`, maxBodyWidth) });
	}

	if (added.hidden > 0) {
		body.push({ kind: "context", text: `⋮ ${added.hidden} more added lines` });
	}

	return body;
}

export function describeApproval(request: ToolApprovalRequest): ApprovalModel {
	const { toolName, parameters } = request;
	const verb = verbs[toolName] ?? "run";

	return {
		toolName,
		description: request.description,
		verb,
		body: describeApprovalBody(toolName, parameters),
	};
}

function describeApprovalBody(
	toolName: string,
	parameters: unknown,
): ApprovalBodyLine[] {
	if (toolName === "bash") {
		const command = readString(parameters, "command") ?? "";
		const cwd = readString(parameters, "cwd");
		const body: ApprovalBodyLine[] = [
			{ kind: "command", text: `$ ${command}` },
		];

		if (cwd !== null) {
			body.push({ kind: "context", text: cwd });
		}

		return body;
	}

	if (toolName === "editFile") {
		const path = readString(parameters, "path") ?? "";
		const oldText = readString(parameters, "oldText") ?? "";
		const newText = readString(parameters, "newText") ?? "";

		return [
			{ kind: "field", label: "path", value: path },
			...diffBody(oldText, newText),
		];
	}

	if (toolName === "writeFile") {
		const path = readString(parameters, "path") ?? "";
		const content = readString(parameters, "content") ?? "";
		const preview = clampLines(content.split("\n"));
		const body: ApprovalBodyLine[] = [
			{ kind: "field", label: "path", value: path },
			{
				kind: "field",
				label: "size",
				value: formatBytes(new TextEncoder().encode(content).byteLength),
			},
		];

		for (const line of preview.lines) {
			body.push({ kind: "context", text: truncate(line, maxBodyWidth) });
		}

		if (preview.hidden > 0) {
			body.push({ kind: "context", text: `⋮ ${preview.hidden} more lines` });
		}

		return body;
	}

	const key =
		toolName === "webSearch"
			? "query"
			: toolName === "webRead"
				? "url"
				: toolName === "loadSkill"
					? "name"
					: "path";
	const value = readString(parameters, key);

	// Read-only tools get the quiet form: two rows, not five.
	return value === null
		? []
		: [{ kind: "field", label: key, value: truncate(value, maxBodyWidth) }];
}
