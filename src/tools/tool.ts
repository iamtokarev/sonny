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
