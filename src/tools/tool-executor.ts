import type { ToolCall } from "../core/message";
import { createLogger } from "../utils/logger";
import type { Tool, ToolResult } from "./tool";
import type { ToolRegistry } from "./tool-registry";

export type ToolApprovalRequest = {
	toolName: string;
	description: string;
	parameters: unknown;
};

export type ToolApprovalDecision =
	| { approved: true }
	| { approved: false; reason?: string };

export type ToolApprover = (
	request: ToolApprovalRequest,
) => Promise<ToolApprovalDecision>;

const logger = createLogger("tools.tool-executor");

function createDeniedToolMessage(reason?: string): string {
	const details = reason === undefined ? "" : ` Reason: ${reason}`;

	return (
		"BLOCKED: User denied this tool call. The user has NOT consented " +
		"to this action. Do NOT retry this tool call, do NOT rephrase it, " +
		"and do NOT attempt the same outcome via a different tool. Stop the " +
		`current workflow and wait for the user before taking further action.${details}`
	);
}

export class ToolExecutor {
	constructor(
		private registry: ToolRegistry,
		private approve: ToolApprover,
	) {}

	async execute(call: ToolCall): Promise<ToolResult> {
		let tool: Tool;
		const startedAt = Date.now();

		try {
			tool = this.registry.get(call.name);
		} catch (error) {
			logger.warn("tool.not_found", {
				toolName: call.name,
				toolCallId: call.id,
			});

			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				reason: "not_found",
			};
		}

		logger.info("tool.approval.requested", {
			toolName: call.name,
			toolCallId: call.id,
			parameters: call.parameters,
		});

		const decision = await this.approve({
			toolName: call.name,
			description: tool.description,
			parameters: call.parameters,
		});

		if (!decision.approved) {
			logger.info("tool.approval.denied", {
				toolName: call.name,
				toolCallId: call.id,
				reason: decision.reason,
			});

			return {
				ok: false,
				error: createDeniedToolMessage(decision.reason),
				reason: "denied",
			};
		}

		logger.info("tool.approval.approved", {
			toolName: call.name,
			toolCallId: call.id,
		});
		logger.info("tool.started", {
			toolName: call.name,
			toolCallId: call.id,
		});

		try {
			const result = await tool.execute(call.parameters);
			const durationMs = Date.now() - startedAt;

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

			return result;
		} catch (error) {
			logger.error("tool.failed", {
				toolName: call.name,
				toolCallId: call.id,
				durationMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				ok: false,
				error: `Tool execution failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				reason: "execution_failed",
			};
		}
	}
}
