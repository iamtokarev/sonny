import { describe, expect, test } from "bun:test";
import type {
	ChannelAdapter,
	ChannelEventHandler,
	ChannelOutput,
} from "./channel";
import { ChannelDelivery } from "./channel-delivery";

function adapter(
	name: string,
	send: (output: ChannelOutput) => Promise<void> = async () => {},
): ChannelAdapter {
	return {
		name,
		run: async (_handler: ChannelEventHandler, _signal: AbortSignal) => {},
		send,
	};
}

const output: ChannelOutput = {
	target: { channel: "telegram", conversationId: "conversation-1" },
	text: "Hello",
};

describe("ChannelDelivery", () => {
	test("rejects duplicate adapter names during construction", () => {
		expect(
			() => new ChannelDelivery([adapter("telegram"), adapter("telegram")]),
		).toThrow("Channel adapter names must be unique.");
	});

	test("routes output through its named adapter", async () => {
		const sent: ChannelOutput[] = [];
		const delivery = new ChannelDelivery([
			adapter("slack"),
			adapter("telegram", async (candidate) => {
				sent.push(candidate);
			}),
		]);

		await delivery.send(output);

		expect(sent).toEqual([output]);
	});

	test("rejects output for an unknown channel", async () => {
		const delivery = new ChannelDelivery([adapter("telegram")]);

		await expect(
			delivery.send({
				target: { channel: "slack", conversationId: "conversation-1" },
				text: "Hello",
			}),
		).rejects.toThrow("No channel adapter is registered for slack.");
	});

	test("propagates adapter delivery failures", async () => {
		const failure = new Error("send failed");
		const delivery = new ChannelDelivery([
			adapter("telegram", async () => {
				throw failure;
			}),
		]);

		await expect(delivery.send(output)).rejects.toBe(failure);
	});
});
