import type { ToolCompletionStatus } from "../domain";

export type JsonSchema = Record<string, unknown>;

export type ToolFailureReason = "denied" | "not_found" | "execution_failed";

export type ToolResult =
	| {
			ok: true;
			content: string;
	  }
	| {
			ok: false;
			error: string;
			reason?: ToolFailureReason;
	  };

export type Tool = {
	name: string;
	description: string;
	parameters: JsonSchema;
	execute: (parameters: unknown) => Promise<ToolResult>;
};

export function getToolCompletionStatus(
	result: ToolResult,
): ToolCompletionStatus {
	if (result.ok) {
		return "succeeded";
	}

	if (result.reason === "denied") {
		return "denied";
	}

	if (result.reason === "not_found") {
		return "not_found";
	}

	return "failed";
}
