import { Box, Text } from "ink";
import { useTheme } from "../ui-context";
import { formatElapsed } from "../use-ticker";

/**
 * Always two rows, whether or not there is a detail line — the composer below
 * must never jump while a turn runs.
 */
export function StatusRow({
	label,
	elapsedSeconds,
	detail,
	spinnerFrame,
}: {
	label: string;
	elapsedSeconds: number;
	detail: string | null;
	spinnerFrame: string;
}) {
	const theme = useTheme();

	return (
		<Box flexDirection="column">
			<Text>
				<Text color={theme.accentDim}>{spinnerFrame}</Text>
				<Text color={theme.fg}>{` ${label}`}</Text>
				<Text color={theme.dim}>
					{` (${formatElapsed(elapsedSeconds)} · esc to interrupt)`}
				</Text>
			</Text>
			<Text color={theme.dim}>
				{detail === null ? " " : `  ${theme.glyphs.branch} ${detail}`}
			</Text>
		</Box>
	);
}
