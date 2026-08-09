import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import type { ReactNode } from "react";
import { describeApproval } from "../approval";
import { describeUsage } from "../context-meter";
import { createTextInputState, textInputReducer } from "../text-input";
import { createTheme } from "../theme";
import type { ToolRow } from "../tool-row";
import { UiProvider } from "../ui-context";
import { resolveLayout } from "../use-terminal-size";
import { Answer } from "./answer";
import { ApprovalPane } from "./approval-pane";
import { CommandPopup } from "./command-popup";
import { Composer } from "./composer";
import { ContextMeter } from "./context-meter";
import { StatusRow } from "./status-row";
import { ToolRowView } from "./tool-row-view";
import { UserTurn } from "./user-turn";

const columns = 60;

/**
 * Rendered without colour so the assertions describe layout and copy rather
 * than escape codes. The colour rules are covered in `theme.test.ts`.
 */
function draw(node: ReactNode, bands = false): string {
	return renderToString(
		<UiProvider
			theme={createTheme({
				colorSupport: bands ? "rich" : "none",
				bandsEnabled: bands,
				isInteractive: true,
			})}
			layout={resolveLayout(columns, 24)}
		>
			{node}
		</UiProvider>,
		{ columns },
	);
}

function toolRow(overrides: Partial<ToolRow> = {}): ToolRow {
	return {
		toolName: "bash",
		preview: "bun run test",
		duration: "4.2s",
		status: "ok",
		result: "42 pass",
		detail: null,
		...overrides,
	};
}

describe("UserTurn", () => {
	test("marks your turn", () => {
		// Trailing padding is trimmed away here because the test process emits
		// no colour; `padTo` covers the fill itself.
		expect(draw(<UserTurn text="lift the timeout" />, true)).toContain(
			"› lift the timeout",
		);
	});

	test("keeps the mark when bands are off", () => {
		expect(draw(<UserTurn text="lift the timeout" />)).toContain(
			"› lift the timeout",
		);
	});

	test("marks only the first row of a wrapped turn", () => {
		const lines = draw(
			<UserTurn
				text={
					"why does the bash tool time out on long builds, and where is that cap set?"
				}
			/>,
		).split("\n");

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("›");
		expect(lines[1]?.trimStart().startsWith("›")).toBe(false);
	});
});

describe("ToolRowView", () => {
	test("lays out name, preview, duration and result in columns", () => {
		expect(draw(<ToolRowView row={toolRow()} />)).toBe(
			"  ⏺ bash       bun run test  4.2s  42 pass",
		);
	});

	test("adds one line of why when a call fails", () => {
		const output = draw(
			<ToolRowView
				row={toolRow({
					status: "error",
					result: "exit 1",
					detail: "2 failing",
				})}
			/>,
		);

		expect(output.split("\n")[1]).toBe("    └ 2 failing");
	});

	test("uses the spinner as the row glyph while running", () => {
		expect(
			draw(
				<ToolRowView
					row={toolRow({ status: "running", duration: null, result: null })}
					spinnerFrame="◐"
				/>,
			),
		).toContain("◐ bash");
	});
});

describe("Composer", () => {
	test("shows the placeholder and the hint row when idle", () => {
		const output = draw(
			<Composer
				state="ready"
				input={createTextInputState()}
				placeholder="Ask Sonny…"
				hint="⏎ send"
			/>,
		);

		expect(output).toContain("Ask Sonny…");
		expect(output).toContain("⏎ send");
	});

	test("marks continuation rows of a multi-line draft", () => {
		const input = [
			{ type: "insert", text: "explain this:" } as const,
			{ type: "newline" } as const,
			{ type: "insert", text: "  const x = 1;" } as const,
		].reduce(textInputReducer, createTextInputState());

		const lines = draw(
			<Composer
				state="ready"
				input={input}
				placeholder="Ask Sonny…"
				hint="3 lines"
			/>,
		).split("\n");

		expect(lines[0]).toContain("▍ explain this:");
		expect(lines[1]).toContain("┆   const x = 1;");
	});

	test("replaces the hint with the failure when a send fails", () => {
		expect(
			draw(
				<Composer
					state="error"
					input={createTextInputState()}
					placeholder="Ask Sonny…"
					hint="⏎ send"
					message={{ text: "send failed · rate limited", tone: "error" }}
				/>,
			),
		).toContain("send failed · rate limited");
	});
});

describe("StatusRow", () => {
	test("always occupies two rows so the composer cannot jump", () => {
		expect(
			draw(
				<StatusRow
					label="Working"
					elapsedSeconds={22}
					detail={null}
					spinnerFrame="◐"
				/>,
			).split("\n"),
		).toHaveLength(2);
	});

	test("names the elapsed time and how to stop", () => {
		expect(
			draw(
				<StatusRow
					label="Working"
					elapsedSeconds={64}
					detail="bash  bun run test"
					spinnerFrame="◐"
				/>,
			),
		).toContain("◐ Working (1m 04s · esc to interrupt)");
	});
});

describe("ApprovalPane", () => {
	test("shows a command verbatim and names what y does", () => {
		const output = draw(
			<ApprovalPane
				approval={describeApproval({
					toolCallId: "call-1",
					toolName: "bash",
					description: "run a shell command",
					parameters: { command: "rm -rf .history" },
				})}
			/>,
		);

		expect(output).toContain("$ rm -rf .history");
		expect(output).toContain("y run · n skip · esc stop the turn");
	});

	test("uses the tool's own verb for a write", () => {
		expect(
			draw(
				<ApprovalPane
					approval={describeApproval({
						toolCallId: "call-1",
						toolName: "writeFile",
						description: "write a file",
						parameters: { path: "theme.ts", content: "a" },
					})}
				/>,
			),
		).toContain("y write ·");
	});
});

describe("CommandPopup", () => {
	test("lists commands and how to drive the list", () => {
		const output = draw(
			<CommandPopup
				options={[
					{ name: "context", description: "token usage right now" },
					{ name: "compact", description: "summarise history now" },
				]}
				selectedIndex={0}
			/>,
		);

		expect(output).toContain("/context   token usage right now");
		expect(output).toContain("↑↓ move · ⇥ complete · ⏎ run · esc close");
	});
});

describe("ContextMeter", () => {
	test("fills cells in proportion and prints the percentage", () => {
		expect(
			draw(
				<ContextMeter
					meter={describeUsage({
						tokenCount: 62_411,
						contextWindowTokens: 200_000,
						thresholdTokens: 150_000,
						thresholdRatio: 0.75,
					})}
				/>,
			),
		).toBe("▰▰▰▱▱▱▱▱▱▱ 31%");
	});
});

describe("Answer", () => {
	test("renders headings, bullets and code without markup characters", () => {
		const output = draw(
			<Answer
				text={[
					"## Two options",
					"",
					"- config-wide",
					"",
					"```",
					"const x = 1;",
					"```",
				].join("\n")}
			/>,
		);

		expect(output).toContain("Two options");
		expect(output).not.toContain("##");
		expect(output).toContain("· config-wide");
		expect(output).toContain("const x = 1;");
	});

	test("drops the backticks around inline code", () => {
		const output = draw(<Answer text="the cap is in `tool-executor.ts`" />);

		expect(output).toContain("tool-executor.ts");
		expect(output).not.toContain("`");
	});
});
