import { describe, expect, test } from "bun:test";
import { webUrlPolicyPreToolHook } from "./web-url-policy-hooks";

const baseContext = {
	toolCallId: "call_test",
	description: "Read a web page",
};

describe("webUrlPolicyPreToolHook", () => {
	test("allows tools other than webRead", async () => {
		const decision = await webUrlPolicyPreToolHook({
			...baseContext,
			toolName: "webSearch",
			parameters: { query: "localhost" },
		});

		expect(decision).toEqual({ action: "allow" });
	});

	test("allows missing or malformed input so the tool can validate it", async () => {
		const missingDecision = await webUrlPolicyPreToolHook({
			...baseContext,
			toolName: "webRead",
			parameters: {},
		});
		const malformedDecision = await webUrlPolicyPreToolHook({
			...baseContext,
			toolName: "webRead",
			parameters: { url: "not a URL" },
		});

		expect(missingDecision).toEqual({ action: "allow" });
		expect(malformedDecision).toEqual({ action: "allow" });
	});

	test("normalizes allowed URLs while preserving parameters", async () => {
		const decision = await webUrlPolicyPreToolHook({
			...baseContext,
			toolName: "webRead",
			parameters: {
				url: "  https://example.com  ",
				metadata: "preserved",
			},
		});

		expect(decision).toEqual({
			action: "updateInput",
			parameters: {
				url: "https://example.com/",
				metadata: "preserved",
			},
			reason: "Normalized web URL",
		});
	});

	test("denies non-public destinations", async () => {
		const decision = await webUrlPolicyPreToolHook({
			...baseContext,
			toolName: "webRead",
			parameters: { url: "http://169.254.169.254/latest/meta-data" },
		});

		expect(decision).toEqual({
			action: "deny",
			reason:
				"Access denied: refusing web requests to local or non-public destinations",
		});
	});
});
