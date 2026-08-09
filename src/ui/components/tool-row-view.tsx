import { Box, Text } from "ink";
import type { Theme } from "../theme";
import type { ToolRow, ToolRowStatus } from "../tool-row";
import { padName } from "../tool-row";
import { useTheme } from "../ui-context";

function resultColor(status: ToolRowStatus, theme: Theme): string | undefined {
	switch (status) {
		case "ok":
			return theme.ok;
		case "truncated":
			return theme.warn;
		case "error":
		case "denied":
		case "blocked":
		case "missing":
			return theme.err;
		case "running":
			return theme.faint;
	}
}

/**
 * One line per tool call. The leading glyph is the spinner while the call is
 * running and settles to `⏺` when it finishes, so nothing else has to move.
 */
export function ToolRowView({
	row,
	spinnerFrame,
}: {
	row: ToolRow;
	spinnerFrame?: string;
}) {
	const theme = useTheme();
	const running = row.status === "running";
	const glyph = running
		? (spinnerFrame ?? theme.glyphs.spinner[0])
		: theme.glyphs.tool;

	return (
		<Box flexDirection="column">
			<Text>
				<Text
					color={running ? theme.accentDim : theme.dim}
				>{`  ${glyph} `}</Text>
				<Text color={theme.dim}>{padName(row.toolName)}</Text>
				<Text color={theme.dim}>{` ${row.preview}`}</Text>
				{row.duration === null ? null : (
					<Text color={theme.faint}>{`  ${row.duration}`}</Text>
				)}
				{row.result === null ? null : (
					<Text
						color={resultColor(row.status, theme)}
					>{`  ${row.result}`}</Text>
				)}
			</Text>
			{row.detail === null ? null : (
				<Text>
					<Text color={theme.faint}>{`    ${theme.glyphs.branch} `}</Text>
					<Text color={row.status === "error" ? theme.err : theme.dim}>
						{row.detail}
					</Text>
				</Text>
			)}
		</Box>
	);
}
