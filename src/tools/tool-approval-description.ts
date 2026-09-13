import type { ToolPermissionRequest } from "./hooks/tool-hooks";

/** The verb on `y` changes per tool, so the key names what happens. */
const verbs: Readonly<Record<string, string>> = {
	bash: "run",
	readFile: "read",
	writeFile: "write",
	editFile: "apply",
	webSearch: "search",
	webRead: "fetch",
	loadSkill: "load",
};

export type ToolApprovalDescriptionLine =
	| { readonly kind: "field"; readonly label: string; readonly value: string }
	| { readonly kind: "command"; readonly text: string }
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "removed"; readonly text: string }
	| { readonly kind: "context"; readonly text: string }
	| { readonly kind: "warn"; readonly text: string };

export interface ToolApprovalDescription {
	readonly toolName: string;
	readonly description: string;
	readonly verb: string;
	readonly lines: readonly ToolApprovalDescriptionLine[];
}

const maxPreviewLines = 12;
const maxPreviewWidth = 64;

function readString(parameters: unknown, key: string): string | null {
	if (typeof parameters !== "object" || parameters === null) {
		return null;
	}

	const value = (parameters as Record<string, unknown>)[key];

	return typeof value === "string" ? value : null;
}

function truncate(text: string): string {
	if (text.length <= maxPreviewWidth) {
		return text;
	}

	return `${text.slice(0, maxPreviewWidth - 1)}…`;
}

function formatBytes(byteCount: number): string {
	if (byteCount < 1024) {
		return `${byteCount} B`;
	}

	if (byteCount < 1024 * 1024) {
		return `${(byteCount / 1024).toFixed(1)} KB`;
	}

	return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

/** Caps a block at `maxPreviewLines`, collapsing the middle, not the end. */
function clampLines(lines: readonly string[]): {
	readonly lines: readonly string[];
	readonly hidden: number;
} {
	if (lines.length <= maxPreviewLines) {
		return { lines, hidden: 0 };
	}

	const head = Math.ceil(maxPreviewLines / 2);
	const tail = maxPreviewLines - head;

	return {
		lines: [...lines.slice(0, head), ...lines.slice(lines.length - tail)],
		hidden: lines.length - maxPreviewLines,
	};
}

function describeDiff(
	oldText: string,
	newText: string,
): readonly ToolApprovalDescriptionLine[] {
	const removed = clampLines(oldText.split("\n"));
	const added = clampLines(newText.split("\n"));
	const lines: ToolApprovalDescriptionLine[] = [];

	for (const line of removed.lines) {
		lines.push({ kind: "removed", text: truncate(`-  ${line}`) });
	}

	if (removed.hidden > 0) {
		lines.push({
			kind: "context",
			text: `⋮ ${removed.hidden} more removed lines`,
		});
	}

	for (const line of added.lines) {
		lines.push({ kind: "added", text: truncate(`+  ${line}`) });
	}

	if (added.hidden > 0) {
		lines.push({
			kind: "context",
			text: `⋮ ${added.hidden} more added lines`,
		});
	}

	return lines;
}

function describeParameters(
	toolName: string,
	parameters: unknown,
): readonly ToolApprovalDescriptionLine[] {
	if (toolName === "bash") {
		const command = readString(parameters, "command") ?? "";
		const cwd = readString(parameters, "cwd");
		const lines: ToolApprovalDescriptionLine[] = [
			{ kind: "command", text: truncate(`$ ${command}`) },
		];

		if (cwd !== null) {
			lines.push({ kind: "context", text: truncate(cwd) });
		}

		return lines;
	}

	if (toolName === "editFile") {
		const path = readString(parameters, "path") ?? "";
		const oldText = readString(parameters, "oldText") ?? "";
		const newText = readString(parameters, "newText") ?? "";

		return [
			{ kind: "field", label: "path", value: truncate(path) },
			...describeDiff(oldText, newText),
		];
	}

	if (toolName === "writeFile") {
		const path = readString(parameters, "path") ?? "";
		const content = readString(parameters, "content") ?? "";
		const preview = clampLines(content.split("\n"));
		const lines: ToolApprovalDescriptionLine[] = [
			{ kind: "field", label: "path", value: truncate(path) },
			{
				kind: "field",
				label: "size",
				value: formatBytes(new TextEncoder().encode(content).byteLength),
			},
		];

		for (const line of preview.lines) {
			lines.push({ kind: "context", text: truncate(line) });
		}

		if (preview.hidden > 0) {
			lines.push({
				kind: "context",
				text: `⋮ ${preview.hidden} more lines`,
			});
		}

		return lines;
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

	return value === null
		? []
		: [{ kind: "field", label: key, value: truncate(value) }];
}

/**
 * Produces the bounded semantic description used by every approval surface.
 * Only known, operation-specific fields are read; unrelated parameters such as
 * credentials never fall through into the preview.
 */
export function describeToolApproval(
	request: ToolPermissionRequest,
): ToolApprovalDescription {
	return {
		toolName: request.toolName,
		description: request.description,
		verb: verbs[request.toolName] ?? "run",
		lines: describeParameters(request.toolName, request.parameters),
	};
}
