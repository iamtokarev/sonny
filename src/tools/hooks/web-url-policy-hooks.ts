import { checkWebReadAccess } from "../policies/web-url-policy";
import type { PreToolHook } from "./tool-hooks";

function getUrl(parameters: unknown): string | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!("url" in parameters) ||
		typeof parameters.url !== "string"
	) {
		return null;
	}

	return parameters.url;
}

function withUrl(parameters: unknown, url: string): unknown {
	if (typeof parameters !== "object" || parameters === null) {
		return parameters;
	}

	return { ...parameters, url };
}

export const webUrlPolicyPreToolHook: PreToolHook = (context) => {
	if (context.toolName !== "webRead") {
		return { action: "allow" };
	}

	const url = getUrl(context.parameters);

	if (url === null) {
		return { action: "allow" };
	}

	const decision = checkWebReadAccess(url);

	if (!decision.allowed) {
		return {
			action: "deny",
			reason: decision.reason,
		};
	}

	if (decision.url === url) {
		return { action: "allow" };
	}

	return {
		action: "updateInput",
		parameters: withUrl(context.parameters, decision.url),
		reason: "Normalized web URL",
	};
};
