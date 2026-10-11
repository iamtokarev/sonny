import type { ToolApprovalConfig } from "../../config";
import { createLogger } from "../../utils/logger";
import { createAutoApprovalHooks } from "../approval/auto-approval-hook";
import type { DecisionModel } from "../approval/decision-model";
import type { ToolResult } from "../tool";
import { filePolicyPreToolHook } from "./file-policy-hooks";
import type {
	PermissionDeniedHook,
	PermissionHook,
	PreToolHook,
	ToolFailureHook,
	ToolHooks,
	TransformToolResultHook,
} from "./tool-hooks";
import { webUrlPolicyPreToolHook } from "./web-url-policy-hooks";

const logger = createLogger("tools.hooks");
const maxToolOutputLength = 20_000;

export const askBeforeEveryTool: PreToolHook = () => ({ action: "ask" });

export const logToolFailure: ToolFailureHook = ({
	toolCallId,
	toolName,
	result,
	durationMs,
}) => {
	logger.warn("tool.hook.failure", {
		toolCallId,
		toolName,
		durationMs,
		reason: result.reason,
		error: result.error,
	});
};

export const logPermissionDenied: PermissionDeniedHook = ({
	toolCallId,
	toolName,
	reason,
}) => {
	logger.info("tool.hook.permission_denied", {
		toolCallId,
		toolName,
		reason,
	});
};

export const enrichFailureForModel: TransformToolResultHook = ({ result }) => {
	if (result.ok || result.error.startsWith("BLOCKED:")) {
		return result;
	}

	return {
		...result,
		error:
			`${result.error}\n\n` +
			"Tool failed. Use this error to recover. Inspect current state before retrying the same tool call.",
	};
};

function truncateText(text: string): string {
	if (text.length <= maxToolOutputLength) {
		return text;
	}

	return (
		text.slice(0, maxToolOutputLength) +
		`\n\n[Tool output truncated by Sonny: original output was ${text.length} characters.]`
	);
}

export const reduceLargeToolOutput: TransformToolResultHook = ({
	result,
}): ToolResult => {
	if (result.ok) {
		return {
			...result,
			content: truncateText(result.content),
		};
	}

	return {
		...result,
		error: truncateText(result.error),
	};
};

export type DefaultToolHooksOptions = {
	permission: PermissionHook;
	toolApproval: ToolApprovalConfig;
	/** Consulted only in auto mode. */
	decisionModel: DecisionModel;
};

/**
 * The file and URL policies always hard-deny first. Auto mode then lets the
 * decision model judge the call; manual mode asks the user every time.
 */
export function createDefaultToolHooks({
	permission,
	toolApproval,
	decisionModel,
}: DefaultToolHooksOptions): ToolHooks {
	const approval =
		toolApproval.mode === "auto"
			? createAutoApprovalHooks({ decisionModel, config: toolApproval })
			: { preTool: askBeforeEveryTool, postTool: undefined };

	return {
		preTool: [filePolicyPreToolHook, webUrlPolicyPreToolHook, approval.preTool],
		permission,
		postTool: approval.postTool === undefined ? [] : [approval.postTool],
		toolFailure: [logToolFailure],
		permissionDenied: [logPermissionDenied],
		transformToolResult: [enrichFailureForModel, reduceLargeToolOutput],
	};
}
