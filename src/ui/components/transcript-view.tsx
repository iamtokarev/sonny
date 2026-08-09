import { Box, Static, Text } from "ink";
import { formatTokens } from "../context-meter";
import { truncate } from "../tool-row";
import type { TranscriptItem } from "../transcript";
import { useLayout, useTheme } from "../ui-context";
import { Answer } from "./answer";
import { ContextMeter } from "./context-meter";
import { Notice } from "./notice";
import { ToolRowView } from "./tool-row-view";
import { UserTurn } from "./user-turn";

/**
 * Finished turns are printed into the terminal's own scrollback via `Static`
 * and never redrawn — which is what keeps a long session from flickering, and
 * why only the live region below is re-rendered each frame.
 */
export function TranscriptView({ items }: { items: TranscriptItem[] }) {
	return (
		<Static items={items}>
			{(item) => (
				<Box key={item.id} flexDirection="column" marginBottom={1}>
					<TranscriptEntry item={item} />
				</Box>
			)}
		</Static>
	);
}

export function TranscriptEntry({ item }: { item: TranscriptItem }) {
	const theme = useTheme();
	const { columns } = useLayout();

	switch (item.kind) {
		case "header":
			return (
				<Box flexDirection="column">
					<Text>
						<Text color={theme.accent}>
							{item.glyph === "sonny"
								? theme.glyphs.sonny
								: theme.glyphs.resumed}
						</Text>
						<Text color={theme.bright}>{` ${item.title}`}</Text>
						<Text color={theme.dim}>
							{item.subtitle.length === 0
								? ""
								: // The header stays one row: a long path loses its middle,
									// not its end, so the working directory is still readable.
									`  ${truncate(item.subtitle, Math.max(8, columns - item.title.length - 4))}`}
						</Text>
					</Text>
					{item.lines.map((line) => (
						<Text key={line} color={theme.dim}>{`  ${line}`}</Text>
					))}
				</Box>
			);
		case "context":
			return (
				<Box flexDirection="column">
					<Text color={theme.dim}>{"  context"}</Text>
					<Text>
						<Text>{"  "}</Text>
						<ContextMeter meter={item.meter} />
						<Text color={theme.dim}>
							{`   ${formatTokens(item.meter.tokenCount)} / ${formatTokens(item.meter.windowTokens)} tokens`}
						</Text>
					</Text>
					<Text color={theme.dim}>
						{`  compacts at ${formatTokens(item.meter.thresholdTokens)} — ${formatTokens(item.meter.headroomTokens)} to go`}
					</Text>
				</Box>
			);
		case "user":
			return <UserTurn text={item.text} />;
		case "answer":
			return <Answer text={item.text} />;
		case "tool":
			return <ToolRowView row={item.row} />;
		case "notice":
			return <Notice tone={item.tone} title={item.title} lines={item.lines} />;
		case "divider":
			return (
				<Text
					color={theme.faint}
				>{`──────────── ${item.label} ────────────`}</Text>
			);
	}
}
