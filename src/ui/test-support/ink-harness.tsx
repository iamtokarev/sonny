import { PassThrough } from "node:stream";
import { type Instance, render } from "ink";
import type { ReactElement } from "react";

/**
 * Runs a component as a real Ink app against a fake terminal, for the
 * behaviour `renderToString` cannot reach: keystrokes, effects and anything
 * that redraws over time.
 *
 * Faking a TTY is fiddly enough to be worth one implementation — Ink reads
 * `isTTY` to decide whether raw mode is available, and a stream that merely
 * looks like a pipe takes a different path through the whole app.
 */
export type InkHarness = {
	app: Instance;
	stdin: PassThrough;
	output(): string;
};

export type InkHarnessOptions = {
	/** False produces a piped stdin, where raw mode is unavailable. */
	isTTY?: boolean;
	columns?: number;
	rows?: number;
};

export function createInkHarness(
	node: ReactElement,
	options: InkHarnessOptions = {},
): InkHarness {
	const isTTY = options.isTTY ?? true;
	const stdin = Object.assign(new PassThrough(), {
		// Node reports `undefined` rather than `false` off a TTY, and the
		// difference matters: Ink's own checks are strict.
		isTTY: isTTY ? true : undefined,
		setRawMode(_enabled: boolean) {
			return this;
		},
		ref() {
			return this;
		},
		unref() {
			return this;
		},
	});
	const stdout = Object.assign(new PassThrough(), {
		isTTY: true,
		columns: options.columns ?? 120,
		rows: options.rows ?? 40,
	});
	const stderr = new PassThrough();
	let output = "";

	stdout.on("data", (chunk) => {
		output += chunk.toString();
	});

	const app = render(node, {
		stdin: stdin as unknown as NodeJS.ReadStream,
		stdout: stdout as unknown as NodeJS.WriteStream,
		stderr: stderr as unknown as NodeJS.WriteStream,
		debug: true,
		interactive: true,
		exitOnCtrlC: false,
		patchConsole: false,
		maxFps: 1000,
	});

	return {
		app,
		stdin,
		output: () => output,
	};
}

export async function flush(harness: InkHarness): Promise<void> {
	await harness.app.waitUntilRenderFlush();
}

/** Types the text and submits it, flushing between so effects can settle. */
export async function enter(harness: InkHarness, input: string): Promise<void> {
	harness.stdin.write(input);
	await flush(harness);
	harness.stdin.write("\r");
	await flush(harness);
}
