import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChannelSource } from "./channel";
import {
	ChannelSessionBindingStore,
	createChannelSessionKey,
} from "./channel-session-binding-store";

function source(
	conversationId: string,
	overrides: Partial<ChannelSource> = {},
): ChannelSource {
	return {
		channel: "telegram",
		conversationId,
		conversationKind: "direct",
		userId: "user-1",
		messageId: "message-1",
		...overrides,
	};
}

async function createStorePath(): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "sonny-channel-bindings-"));
	return join(workspace, ".history", "channels", "bindings.json");
}

describe("createChannelSessionKey", () => {
	test("uses routing identity without user or message identity", () => {
		const first = source("conversation:/1", {
			userId: "user-a",
			messageId: "message-a",
		});
		const second = source("conversation:/1", {
			userId: "user-b",
			messageId: "message-b",
		});

		expect(createChannelSessionKey(first)).toBe(
			"telegram:direct:conversation%3A%2F1:-",
		);
		expect(createChannelSessionKey(second)).toBe(
			createChannelSessionKey(first),
		);
	});

	test("distinguishes conversation kind and thread", () => {
		expect(createChannelSessionKey(source("one"))).not.toBe(
			createChannelSessionKey(
				source("one", { conversationKind: "group", threadId: "thread-1" }),
			),
		);
		expect(
			createChannelSessionKey(source("one", { threadId: "thread-1" })),
		).not.toBe(
			createChannelSessionKey(source("one", { threadId: "thread-2" })),
		);
	});
});

describe("ChannelSessionBindingStore", () => {
	test("treats a missing file as no binding", async () => {
		const store = new ChannelSessionBindingStore(await createStorePath());

		await expect(store.get(source("missing"))).resolves.toBeUndefined();
	});

	test("persists a binding that a fresh store can read", async () => {
		const path = await createStorePath();
		const store = new ChannelSessionBindingStore(path);
		const input = source("conversation-1");

		const binding = await store.bind(input, "session-1");
		const reopened = new ChannelSessionBindingStore(path);

		expect(binding).toMatchObject({
			key: createChannelSessionKey(input),
			channel: "telegram",
			conversationId: "conversation-1",
			conversationKind: "direct",
			sessionId: "session-1",
		});
		await expect(reopened.get(input)).resolves.toEqual(binding);
	});

	test("rebinding preserves creation time and updates session and time", async () => {
		const path = await createStorePath();
		const timestamps = [
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-02T00:00:00.000Z"),
		];
		const store = new ChannelSessionBindingStore(
			path,
			() => timestamps.shift() ?? new Date("2026-01-03T00:00:00.000Z"),
		);
		const input = source("conversation-1");

		const initial = await store.bind(input, "session-1");
		const updated = await store.bind(input, "session-2");

		expect(updated.createdAt).toBe(initial.createdAt);
		expect(updated.updatedAt).toBe("2026-01-02T00:00:00.000Z");
		expect(updated.sessionId).toBe("session-2");
		await expect(store.get(input)).resolves.toEqual(updated);
	});

	test("keeps different conversations and threads separate", async () => {
		const store = new ChannelSessionBindingStore(await createStorePath());
		const direct = source("conversation-1");
		const other = source("conversation-2");
		const thread = source("conversation-1", { threadId: "thread-1" });

		await store.bind(direct, "session-direct");
		await store.bind(other, "session-other");
		await store.bind(thread, "session-thread");

		expect((await store.get(direct))?.sessionId).toBe("session-direct");
		expect((await store.get(other))?.sessionId).toBe("session-other");
		expect((await store.get(thread))?.sessionId).toBe("session-thread");
	});

	test("rejects malformed JSON instead of treating it as no binding", async () => {
		const path = await createStorePath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, "{not valid json", "utf8");
		const store = new ChannelSessionBindingStore(path);

		await expect(store.get(source("conversation-1"))).rejects.toThrow(
			"Channel session bindings are malformed.",
		);
	});

	test("rejects stored keys that disagree with their routing fields", async () => {
		const path = await createStorePath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify([
				{
					key: "wrong:key",
					channel: "telegram",
					conversationId: "conversation-1",
					conversationKind: "direct",
					sessionId: "session-1",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			]),
			"utf8",
		);
		const store = new ChannelSessionBindingStore(path);

		await expect(store.get(source("conversation-1"))).rejects.toThrow(
			"Channel session bindings are malformed.",
		);
	});

	test("serializes concurrent binds without losing entries", async () => {
		const path = await createStorePath();
		const store = new ChannelSessionBindingStore(path);
		const inputs = Array.from({ length: 20 }, (_, index) =>
			source(String(index)),
		);

		await Promise.all(
			inputs.map((input, index) => store.bind(input, `session-${index}`)),
		);

		const persisted = JSON.parse(await readFile(path, "utf8")) as unknown[];
		expect(persisted).toHaveLength(inputs.length);
		for (const [index, input] of inputs.entries()) {
			expect((await store.get(input))?.sessionId).toBe(`session-${index}`);
		}
	});

	test("leaves no temporary file after an atomic replacement", async () => {
		const path = await createStorePath();
		const store = new ChannelSessionBindingStore(path);

		await store.bind(source("conversation-1"), "session-1");

		expect(await readdir(dirname(path))).toEqual(["bindings.json"]);
	});
});
