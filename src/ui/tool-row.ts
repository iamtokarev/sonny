import { formatDuration } from "../cli/tool-display";
import type { ToolCompletionStatus } from "../domain";
import type { ToolCompletedEvent, ToolStartedEvent } from "../events";

/**
 * Every tool renders as one line:
 *
 *   glyph · name(10) · preview · duration · result
 *
 * Only failures earn a second line. `denied` is you; `blocked` is the file and
 * URL policies deciding before you were asked; `missing` is the model asking
 * for a tool this session does not have.
 */
export type ToolRowStatus =
	| "running"
	| "ok"
	| "error"
	| "denied"
	| "blocked"
	| "missing"
	| "truncated";

export type ToolRow = {
	toolName: string;
	preview: string;
	duration: string | null;
	status: ToolRowStatus;
	/** Right-hand summary. Never content, always a summary of it. */
	result: string | null;
	/** One line of why, shown under the row when something went wrong. */
	detail: string | null;
};

/** The reason the composer sends when you decline, so we can tell it apart. */
export const userDenialReason = "Tool call denied by user.";
export const turnCancelledReason = "Turn cancelled by user.";

const truncationMarker = "[Tool output truncated by Sonny:";
const nameColumnWidth = 10;
const maxPreviewWidth = 46;
const maxResultWidth = 28;
const maxDetailWidth = 72;

const previewKeys: Record<string, string> = {
	bash: "command",
	readFile: "path",
	writeFile: "path",
	editFile: "path",
	webSearch: "query",
	webRead: "url",
	loadSkill: "name",
};

function readString(parameters: unknown, key: string): string | null {
	if (typeof parameters !== "object" || parameters === null) {
		return null;
	}

	const value = (parameters as Record<string, unknown>)[key];

	return typeof value === "string" ? value : null;
}

function collapse(text: string): string {
	return text.split(/\s+/).filter(Boolean).join(" ");
}

export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function padName(toolName: string): string {
	return truncate(toolName, nameColumnWidth).padEnd(nameColumnWidth);
}

export function formatBytes(byteCount: number): string {
	if (byteCount < 1024) {
		return `${byteCount} B`;
	}

	if (byteCount < 1024 * 1024) {
		return `${(byteCount / 1024).toFixed(1)} KB`;
	}

	return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

/** The tool's most identifying argument, which is all the row has room for. */
export function describeToolCall(
	toolName: string,
	parameters: unknown,
	maxWidth = maxPreviewWidth,
): string {
	const key = previewKeys[toolName];
	const value = key === undefined ? null : readString(parameters, key);

	if (value === null || value.length === 0) {
		return "";
	}

	return truncate(collapse(value), maxWidth);
}

function firstLine(text: string): string {
	const line = text
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);

	return line ?? "";
}

function parseJson(
	content: string,
): Record<string, unknown> | unknown[] | null {
	try {
		const parsed: unknown = JSON.parse(content);

		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown> | unknown[])
			: null;
	} catch {
		return null;
	}
}

function summariseBash(
	content: string,
): Pick<ToolRow, "status" | "result" | "detail"> {
	const parsed = parseJson(content);

	if (parsed === null || Array.isArray(parsed)) {
		return { status: "ok", result: null, detail: null };
	}

	const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : 0;
	const stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
	const stderr = typeof parsed.stderr === "string" ? parsed.stderr : "";

	if (parsed.timedOut === true) {
		return { status: "error", result: "timed out", detail: null };
	}

	if (exitCode !== 0) {
		return {
			status: "error",
			result: `exit ${exitCode}`,
			detail:
				truncate(
					collapse(firstLine(stderr) || firstLine(stdout)),
					maxDetailWidth,
				) || null,
		};
	}

	const output = firstLine(stdout) || firstLine(stderr);

	return {
		status: "ok",
		result:
			output.length === 0 ? null : truncate(collapse(output), maxResultWidth),
		detail: null,
	};
}

function summariseSuccess(
	toolName: string,
	content: string,
): Pick<ToolRow, "status" | "result" | "detail"> {
	if (content.includes(truncationMarker)) {
		return {
			status: "truncated",
			result: "truncated",
			detail: "only part of the output was sent to Sonny",
		};
	}

	if (toolName === "bash") {
		return summariseBash(content);
	}

	if (toolName === "readFile") {
		// The answer that follows is the result; the row says nothing.
		return { status: "ok", result: null, detail: null };
	}

	const parsed = parseJson(content);

	if (toolName === "writeFile" && parsed !== null && !Array.isArray(parsed)) {
		const bytes = parsed.bytesWritten;

		return {
			status: "ok",
			result: typeof bytes === "number" ? formatBytes(bytes) : null,
			detail: null,
		};
	}

	if (toolName === "editFile" && parsed !== null && !Array.isArray(parsed)) {
		const replacements = parsed.replacements;

		return {
			status: "ok",
			result:
				typeof replacements === "number"
					? `${replacements} replacement${replacements === 1 ? "" : "s"}`
					: null,
			detail: null,
		};
	}

	if (toolName === "webSearch" && Array.isArray(parsed)) {
		return {
			status: "ok",
			result: `${parsed.length} result${parsed.length === 1 ? "" : "s"}`,
			detail: null,
		};
	}

	if (toolName === "webRead") {
		return { status: "ok", result: formatBytes(content.length), detail: null };
	}

	if (toolName === "loadSkill") {
		return { status: "ok", result: "loaded", detail: null };
	}

	const preview = collapse(content);

	return {
		status: "ok",
		result: preview.length === 0 ? null : truncate(preview, maxResultWidth),
		detail: null,
	};
}

/**
 * The runtime says the call was refused; the message says by whom. Only you and
 * the policies can refuse, so the reason text is what separates them.
 */
function summariseRefusal(
	content: string,
): Pick<ToolRow, "status" | "result" | "detail"> {
	const isUserDecision =
		content.includes(userDenialReason) || content.includes(turnCancelledReason);

	return {
		status: isUserDecision ? "denied" : "blocked",
		result: isUserDecision ? "denied" : "blocked",
		detail: isUserDecision
			? "you declined this call"
			: extractPolicyReason(content),
	};
}

function summariseFailure(
	content: string,
): Pick<ToolRow, "status" | "result" | "detail"> {
	return {
		status: "error",
		result: "failed",
		detail: truncate(collapse(firstLine(content)), maxDetailWidth) || null,
	};
}

function extractPolicyReason(content: string): string | null {
	const marker = "Reason:";
	const index = content.indexOf(marker);

	if (index === -1) {
		return null;
	}

	const reason = collapse(content.slice(index + marker.length));

	return reason.length === 0
		? null
		: `policy: ${truncate(reason, maxDetailWidth)}`;
}

/** The runtime classifies the outcome; the row only has to render it. */
export function summariseToolResult(
	toolName: string,
	status: ToolCompletionStatus,
	content: string,
): Pick<ToolRow, "status" | "result" | "detail"> {
	switch (status) {
		case "succeeded":
			return summariseSuccess(toolName, content);
		case "denied":
			return summariseRefusal(content);
		case "not_found":
			return {
				status: "missing",
				result: "no such tool",
				detail: `this session has no tool called ${toolName}`,
			};
		case "failed":
			return summariseFailure(content);
	}
}

export function createToolRow(event: ToolCompletedEvent): ToolRow {
	return {
		toolName: event.toolName,
		preview: describeToolCall(event.toolName, event.parameters),
		duration: formatDuration(event.durationMs),
		...summariseToolResult(event.toolName, event.status, event.content),
	};
}

export function createRunningToolRow(event: ToolStartedEvent): ToolRow {
	return {
		toolName: event.toolName,
		preview: describeToolCall(event.toolName, event.parameters),
		duration: null,
		status: "running",
		result: null,
		detail: null,
	};
}
