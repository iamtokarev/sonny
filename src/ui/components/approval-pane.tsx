import { Box, Text } from "ink";
import type {
	ToolApprovalDescription,
	ToolApprovalDescriptionLine,
} from "../../tools/tool-approval-description";
import type { Theme } from "../theme";
import { useLayout, useTheme } from "../ui-context";
import { padTo } from "../wrap";

function lineColor(
	line: ToolApprovalDescriptionLine,
	theme: Theme,
): string | undefined {
	switch (line.kind) {
		case "command":
			return theme.bright;
		case "added":
			return theme.ok;
		case "removed":
			return theme.err;
		case "warn":
			return theme.warn;
		case "context":
			return theme.faint;
		case "field":
			return theme.fg;
	}
}

/**
 * Replaces the composer row — same position, same width, so your eye is
 * already there. The bar is warn: the one moment warn marks something that has
 * not finished yet.
 */
export function ApprovalPane({
	approval,
}: {
	approval: ToolApprovalDescription;
}) {
	const theme = useTheme();
	const { columns } = useLayout();
	const width = Math.max(24, columns) - 2;

	return (
		<Box flexDirection="column">
			<Text backgroundColor={theme.surface}>
				<Text color={theme.warn}>{`${theme.glyphs.bar} `}</Text>
				<Text color={theme.bright}>{approval.toolName}</Text>
				<Text color={theme.dim}>
					{padTo(`  ${approval.description}`, width - approval.toolName.length)}
				</Text>
			</Text>
			{approval.lines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${line.kind}`}
					backgroundColor={theme.surface}
				>
					<Text color={theme.warn}>{`${theme.glyphs.bar} `}</Text>
					<Text color={lineColor(line, theme)}>
						{padTo(
							line.kind === "field"
								? `${line.label.padEnd(6)} ${line.value}`
								: line.text,
							width,
						)}
					</Text>
				</Text>
			))}
			<Text>
				<Text color={theme.ok}>{"  y"}</Text>
				<Text color={theme.faint}>{` ${approval.verb} · `}</Text>
				<Text color={theme.err}>n</Text>
				<Text color={theme.faint}>{" skip · "}</Text>
				<Text color={theme.fg}>esc</Text>
				<Text color={theme.faint}>{" stop the turn"}</Text>
			</Text>
		</Box>
	);
}
