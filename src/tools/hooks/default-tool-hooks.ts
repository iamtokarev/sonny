import { createLogger } from "../../utils/logger";
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

export function createDefaultToolHooks(permission: PermissionHook): ToolHooks {
	return {
		preTool: [
			filePolicyPreToolHook,
			webUrlPolicyPreToolHook,
			askBeforeEveryTool,
		],
		permission,
		postTool: [],
		toolFailure: [logToolFailure],
		permissionDenied: [logPermissionDenied],
		transformToolResult: [enrichFailureForModel, reduceLargeToolOutput],
	};
}
