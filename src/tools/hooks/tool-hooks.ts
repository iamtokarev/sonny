import type { RuntimeSource } from "../../events";
import type { ToolResult } from "../tool";

export type BaseToolHookContext = {
	toolCallId: string;
	toolName: string;
	description: string;
	parameters: unknown;
};

export type PreToolContext = BaseToolHookContext;

export type PreToolDecision =
	| { action: "allow" }
	| { action: "deny"; reason: string }
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
