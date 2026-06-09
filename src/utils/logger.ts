import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
	debug(message: string, fields?: LogFields): void;
	info(message: string, fields?: LogFields): void;
	warn(message: string, fields?: LogFields): void;
	error(message: string, fields?: LogFields): void;
};

type LoggerConfig = {
	logDir: string;
	level: LogLevel;
	maxStringLength: number;
};

const levelPriority: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const sensitiveKeyPattern =
	/(api[_-]?key|token|password|secret|authorization)/i;

let config: LoggerConfig = {
	logDir: join(process.cwd(), "logs"),
	level: "info",
	maxStringLength: 2000,
};

export function configureLogger(options?: {
	logDir?: string;
	level?: LogLevel;
	maxStringLength?: number;
}): void {
	config = {
		logDir: options?.logDir ?? config.logDir,
		level: options?.level ?? config.level,
		maxStringLength: options?.maxStringLength ?? config.maxStringLength,
	};

	mkdirSync(config.logDir, { recursive: true });
}

export function createLogger(scope: string): Logger {
	return {
		debug: (message, fields) => writeLog("debug", scope, message, fields),
		info: (message, fields) => writeLog("info", scope, message, fields),
		warn: (message, fields) => writeLog("warn", scope, message, fields),
		error: (message, fields) => writeLog("error", scope, message, fields),
	};
}

function writeLog(
	level: LogLevel,
	scope: string,
	message: string,
	fields: LogFields = {},
): void {
	if (levelPriority[level] < levelPriority[config.level]) {
		return;
	}

	const record = {
		time: new Date().toISOString(),
		level,
		scope,
		message,
		...sanitizeFields(fields),
	};

	const line = `${JSON.stringify(record)}\n`;

	try {
		mkdirSync(config.logDir, { recursive: true });
		appendFileSync(join(config.logDir, "sonny.jsonl"), line, "utf8");

		if (levelPriority[level] >= levelPriority.warn) {
			appendFileSync(join(config.logDir, "errors.jsonl"), line, "utf8");
		}
	} catch {
		// Logging must never break the agent path.
	}
}

function sanitizeFields(fields: LogFields): LogFields {
	return sanitizeValue(fields, new WeakSet()) as LogFields;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === "string") {
		return truncateString(value);
	}

	if (typeof value !== "object" || value === null) {
		return value;
	}

	if (seen.has(value)) {
		return "[Circular]";
	}

	seen.add(value);

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, seen));
	}

	const sanitized: LogFields = {};

	for (const [key, nestedValue] of Object.entries(value)) {
		sanitized[key] = sensitiveKeyPattern.test(key)
			? "[REDACTED]"
			: sanitizeValue(nestedValue, seen);
	}

	return sanitized;
}

function truncateString(value: string): string {
	if (value.length <= config.maxStringLength) {
		return value;
	}

	return `${value.slice(0, config.maxStringLength)}...[truncated]`;
}
