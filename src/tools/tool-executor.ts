import type { ToolCall } from "../domain";
import { createLogger } from "../utils/logger";
import type {
	BaseToolHookContext,
	PermissionHook,
	ToolHooks,
} from "./hooks/tool-hooks";
import type { Tool, ToolResult } from "./tool";
import type { ToolRegistry } from "./tool-registry";

export type ToolApprovalRequest = BaseToolHookContext;
export type ToolApprovalDecision = Awaited<ReturnType<PermissionHook>>;
export type ToolApprover = PermissionHook;

export type ToolEvent =
	| {
			type: "tool.started";
			toolCallId: string;
			toolName: string;
			parameters: unknown;
			preview: string;
	  }
	| {
			type: "tool.completed";
			toolCallId: string;
			toolName: string;
			parameters: unknown;
			ok: boolean;
			content: string;
			durationMs: number;
	  };

export type ToolEventHandler = (event: ToolEvent) => void;

const logger = createLogger("tools.tool-executor");

function createBlockedToolMessage(reason?: string): string {
	const details = reason === undefined ? "" : ` Reason: ${reason}`;

	return (
		"BLOCKED: This tool call was not allowed. The user has NOT consented " +
		"to this action. Do NOT retry this tool call, do NOT rephrase it, " +
		"and do NOT attempt the same outcome via a different tool. Stop the " +
		`current workflow and wait for the user before taking further action.${details}`
	);
}

function getParameterValue(parameters: unknown, key: string): string | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!(key in parameters)
	) {
		return null;
	}

	const value = (parameters as Record<string, unknown>)[key];

	return typeof value === "string" ? value : null;
}

function createToolPreview(toolName: string, parameters: unknown): string {
	const parameterKey = toolName === "bash" ? "command" : "path";
	const value = getParameterValue(parameters, parameterKey);

	return value ?? toolName;
}

export class ToolExecutor {
	constructor(
		private registry: ToolRegistry,
		private hooks: ToolHooks,
		private onToolEvent?: ToolEventHandler,
	) {}

	async execute(call: ToolCall): Promise<ToolResult> {
		let tool: Tool;
		const startedAt = Date.now();

		try {
			tool = this.registry.get(call.name);
		} catch (error) {
			const result = {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
				reason: "not_found" as const,
			};

			logger.warn("tool.not_found", {
				toolName: call.name,
				toolCallId: call.id,
			});

			this.onToolEvent?.({
				type: "tool.completed",
				toolCallId: call.id,
				toolName: call.name,
				parameters: call.parameters,
				ok: false,
				content: result.error,
				durationMs: Date.now() - startedAt,
			});

			return result;
		}

		let parameters = call.parameters;
		let permissionRequired = false;
		let permissionReason: string | undefined;

		const createContext = (): BaseToolHookContext => ({
			toolCallId: call.id,
			toolName: call.name,
			description: tool.description,
			parameters,
		});

		for (const hook of this.hooks.preTool ?? []) {
			const decision = await hook(createContext());

			if (decision.action === "allow") {
				continue;
			}

			if (decision.action === "updateInput") {
				logger.info("tool.input.updated", {
					toolName: call.name,
					toolCallId: call.id,
					reason: decision.reason,
				});
				parameters = decision.parameters;
				continue;
			}

			if (decision.action === "ask") {
				permissionRequired = true;
				permissionReason = decision.reason ?? permissionReason;
				continue;
			}

			return await this.denyToolCall({
				context: createContext(),
				reason: `Blocked by policy: ${decision.reason}`,
				durationMs: Date.now() - startedAt,
			});
		}

		if (permissionRequired) {
			const permission = this.hooks.permission;

			if (permission === undefined) {
				return await this.denyToolCall({
					context: createContext(),
					reason:
						"Permission was required, but no permission hook was configured.",
					durationMs: Date.now() - startedAt,
				});
			}

			logger.info("tool.permission.requested", {
				toolName: call.name,
				toolCallId: call.id,
				parameters,
				reason: permissionReason,
			});

			const decision = await permission({
				...createContext(),
				reason: permissionReason,
			});

			if (!decision.approved) {
				return await this.denyToolCall({
					context: createContext(),
					reason:
						decision.reason === undefined
							? "User denied this tool call."
							: `User denied this tool call: ${decision.reason}`,
					durationMs: Date.now() - startedAt,
				});
			}

			logger.info("tool.permission.approved", {
				toolName: call.name,
				toolCallId: call.id,
			});
		}

		logger.info("tool.started", {
			toolName: call.name,
			toolCallId: call.id,
		});

		this.onToolEvent?.({
			type: "tool.started",
			toolCallId: call.id,
			toolName: call.name,
			parameters,
			preview: createToolPreview(call.name, parameters),
		});

		const executionStartedAt = Date.now();

		try {
			const result = await tool.execute(parameters);
			const durationMs = Date.now() - executionStartedAt;

			if (result.ok) {
				logger.info("tool.completed", {
					toolName: call.name,
					toolCallId: call.id,
					durationMs,
					contentLength: result.content.length,
				});
			} else {
				logger.warn("tool.failed", {
					toolName: call.name,
					toolCallId: call.id,
					durationMs,
					error: result.error,
				});
			}

			await this.runPostToolHooks(createContext(), result, durationMs);
			await this.runFailureHooks(createContext(), result, durationMs);
			const transformedResult = await this.runTransformHooks(
				createContext(),
				result,
				durationMs,
			);

			this.onToolEvent?.({
				type: "tool.completed",
				toolCallId: call.id,
				toolName: call.name,
				parameters,
				ok: transformedResult.ok,
				content: transformedResult.ok
					? transformedResult.content
					: transformedResult.error,
				durationMs,
			});

			return transformedResult;
		} catch (error) {
			const durationMs = Date.now() - executionStartedAt;
			const result = {
				ok: false as const,
				error: `Tool execution failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				reason: "execution_failed" as const,
			};

			logger.error("tool.failed", {
				toolName: call.name,
				toolCallId: call.id,
				durationMs,
				error: error instanceof Error ? error.message : String(error),
			});

			await this.runPostToolHooks(createContext(), result, durationMs);
			await this.runFailureHooks(createContext(), result, durationMs);
			const transformedResult = await this.runTransformHooks(
				createContext(),
				result,
				durationMs,
			);

			this.onToolEvent?.({
				type: "tool.completed",
				toolCallId: call.id,
				toolName: call.name,
				parameters,
				ok: transformedResult.ok,
				content: transformedResult.ok
					? transformedResult.content
					: transformedResult.error,
				durationMs,
			});

			return transformedResult;
		}
	}

	private async denyToolCall({
		context,
		reason,
		durationMs,
	}: {
		context: BaseToolHookContext;
		reason?: string;
		durationMs: number;
	}): Promise<ToolResult> {
		const error = createBlockedToolMessage(reason);
		const result = {
			ok: false as const,
			error,
			reason: "denied" as const,
		};

		logger.info("tool.permission.denied", {
			toolName: context.toolName,
			toolCallId: context.toolCallId,
			reason,
		});

		for (const hook of this.hooks.permissionDenied ?? []) {
			try {
				await hook({ ...context, reason });
			} catch (error) {
				logger.debug("tool.permission_denied_hook.failed", {
					toolName: context.toolName,
					toolCallId: context.toolCallId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const transformedResult = await this.runTransformHooks(
			context,
			result,
			durationMs,
		);

		this.onToolEvent?.({
			type: "tool.completed",
			toolCallId: context.toolCallId,
			toolName: context.toolName,
			parameters: context.parameters,
			ok: transformedResult.ok,
			content: transformedResult.ok
				? transformedResult.content
				: transformedResult.error,
			durationMs,
		});

		return transformedResult;
	}

	private async runPostToolHooks(
		context: BaseToolHookContext,
		result: ToolResult,
		durationMs: number,
	): Promise<void> {
		for (const hook of this.hooks.postTool ?? []) {
			try {
				await hook({ ...context, result, durationMs });
			} catch (error) {
				logger.debug("tool.post_hook.failed", {
					toolName: context.toolName,
					toolCallId: context.toolCallId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	private async runFailureHooks(
		context: BaseToolHookContext,
		result: ToolResult,
		durationMs: number,
	): Promise<void> {
		if (result.ok) {
			return;
		}

		for (const hook of this.hooks.toolFailure ?? []) {
			try {
				await hook({ ...context, result, durationMs });
			} catch (error) {
				logger.debug("tool.failure_hook.failed", {
					toolName: context.toolName,
					toolCallId: context.toolCallId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	private async runTransformHooks(
		context: BaseToolHookContext,
		result: ToolResult,
		durationMs: number,
	): Promise<ToolResult> {
		let transformedResult = result;

		for (const hook of this.hooks.transformToolResult ?? []) {
			try {
				transformedResult = await hook({
					...context,
					result: transformedResult,
					durationMs,
				});
			} catch (error) {
				logger.debug("tool.transform_hook.failed", {
					toolName: context.toolName,
					toolCallId: context.toolCallId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return transformedResult;
	}
}
