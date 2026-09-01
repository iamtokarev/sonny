import { describe, expect, test } from "bun:test";

import { ChannelDeliveryError } from "./channel-errors";

describe("ChannelDeliveryError", () => {
	test("exposes only safe channel context while retaining the cause", () => {
		const cause = new Error("provider response with sensitive details");
		const error = new ChannelDeliveryError("telegram", { cause });

		expect(error.name).toBe("ChannelDeliveryError");
		expect(error.message).toBe("Failed to deliver message through telegram.");
		expect(error.message).not.toContain(cause.message);
		expect(error.cause).toBe(cause);
	});
});
