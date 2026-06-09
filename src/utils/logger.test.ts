import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLogger, createLogger } from "./logger";

async function createTempLogDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "sonny-logs-"));
}

async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
	const content = await readFile(path, "utf8");

	return content
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("logger", () => {
	test("writes JSONL records", async () => {
		const logDir = await createTempLogDir();
		configureLogger({ logDir, level: "debug" });
		const logger = createLogger("test.scope");

		logger.info("test.event", { value: 42 });

		const records = await readJsonl(join(logDir, "sonny.jsonl"));

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			level: "info",
			scope: "test.scope",
			message: "test.event",
			value: 42,
		});
		expect(typeof records[0]?.time).toBe("string");
	});

	test("writes warnings and errors to errors log", async () => {
		const logDir = await createTempLogDir();
		configureLogger({ logDir, level: "debug" });
		const logger = createLogger("test.scope");

		logger.warn("warn.event");
		logger.error("error.event");

		const records = await readJsonl(join(logDir, "errors.jsonl"));

		expect(records.map((record) => record.message)).toEqual([
			"warn.event",
			"error.event",
		]);
	});

	test("redacts sensitive fields", async () => {
		const logDir = await createTempLogDir();
		configureLogger({ logDir, level: "debug" });
		const logger = createLogger("test.scope");

		logger.info("secret.event", {
			apiKey: "sk-test",
			nested: {
				accessToken: "token-test",
				visible: "ok",
			},
		});

		const [record] = await readJsonl(join(logDir, "sonny.jsonl"));

		expect(record).toMatchObject({
			apiKey: "[REDACTED]",
			nested: {
				accessToken: "[REDACTED]",
				visible: "ok",
			},
		});
	});

	test("truncates long strings", async () => {
		const logDir = await createTempLogDir();
		configureLogger({ logDir, level: "debug", maxStringLength: 5 });
		const logger = createLogger("test.scope");

		logger.info("long.event", {
			value: "abcdefghijklmnopqrstuvwxyz",
		});

		const [record] = await readJsonl(join(logDir, "sonny.jsonl"));

		expect(record?.value).toBe("abcde...[truncated]");
	});

	test("respects configured log level", async () => {
		const logDir = await createTempLogDir();
		configureLogger({ logDir, level: "warn" });
		const logger = createLogger("test.scope");

		logger.info("info.event");
		logger.warn("warn.event");

		const records = await readJsonl(join(logDir, "sonny.jsonl"));

		expect(records.map((record) => record.message)).toEqual(["warn.event"]);
	});
});
