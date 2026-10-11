import type { ToolCompletionStatus } from "../../domain";
import type { RuntimeSource } from "../../events";
import type { ToolResult } from "../tool";

export type BaseToolHookContext = {
	toolCallId: string;
	toolName: string;
	description: string;
	parameters: unknown;
};

/** The tool call that ran before the pending one. Never carries its output. */
export type PreviousToolCall = {
	readonly name: string;
	readonly parameters: unknown;
	readonly status: ToolCompletionStatus | null;
};

/**
 * A read-only view of the conversation for approval decisions: what the user
 * asked for and the step before. Assistant prose and tool output are never
 * part of it, so neither can argue a call past the judge.
 */
export interface ApprovalContext {
	/** The last `limit` user messages, oldest first, text only. */
	recentUserMessages(limit: number): readonly string[];
	readonly previousCall: PreviousToolCall | null;
}

export type PreToolContext = BaseToolHookContext & {
	/** Absent when the caller has no conversation to offer. */
	approval?: ApprovalContext;
	/** The turn's cancellation signal. */
	signal?: AbortSignal;
};

/**
 * `origin: "auto"` marks a decision made automatically on the user's behalf
 * rather than by a fixed policy. An automatic deny hands the model the
 * caller-supplied, recoverable `message` verbatim instead of the `BLOCKED:`
 * wrapper that policy and human denials use.
 */
export type PreToolDecision =
	| { action: "allow"; origin?: "auto" }
	| { action: "deny"; reason: string; origin?: "policy" }
	| { action: "deny"; origin: "auto"; message: string }
	| { action: "ask"; reason?: string }
	| { action: "updateInput"; parameters: unknown; reason?: string };

export type PreToolHook = (
	context: PreToolContext,
) => PreToolDecision | Promise<PreToolDecision>;

export interface ToolPermissionTurn {
	readonly sessionId: string;
	readonly turnId: string;
	readonly source: RuntimeSource;
	readonly signal?: AbortSignal;
}

export type ToolPermissionRequest = BaseToolHookContext & {
	reason?: string;
	turn: ToolPermissionTurn;
};

export type ToolPermissionDecision =
	| { approved: true }
	| { approved: false; reason?: string };

export type PermissionHook = (
	request: ToolPermissionRequest,
) => ToolPermissionDecision | Promise<ToolPermissionDecision>;

export type PostToolContext = BaseToolHookContext & {
	result: ToolResult;
	durationMs: number;
};

export type PostToolHook = (context: PostToolContext) => void | Promise<void>;

export type TransformToolResultContext = BaseToolHookContext & {
	result: ToolResult;
	durationMs: number;
};

export type TransformToolResultHook = (
	context: TransformToolResultContext,
) => ToolResult | Promise<ToolResult>;

export type ToolFailureContext = BaseToolHookContext & {
	result: Extract<ToolResult, { ok: false }>;
	durationMs: number;
};

export type ToolFailureHook = (
	context: ToolFailureContext,
) => void | Promise<void>;

export type PermissionDeniedContext = BaseToolHookContext & {
	reason?: string;
};

export type PermissionDeniedHook = (
	context: PermissionDeniedContext,
) => void | Promise<void>;

export type ToolHooks = {
	preTool?: PreToolHook[];
	permission?: PermissionHook;
	postTool?: PostToolHook[];
	transformToolResult?: TransformToolResultHook[];
	toolFailure?: ToolFailureHook[];
	permissionDenied?: PermissionDeniedHook[];
};
