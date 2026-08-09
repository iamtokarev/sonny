import { Box, Text } from "ink";
import { useLayout, useTheme } from "../ui-context";
import { padTo, wrapText } from "../wrap";

/**
 * Your turns get a full-width background tint. The `›` mark stays even in flat
 * mode, so turning bands off degrades to a marked line rather than nothing.
 */
export function UserTurn({ text }: { text: string }) {
	const theme = useTheme();
	const { columns } = useLayout();
	const width = Math.max(20, columns);
	const lines = wrapText(text, width - 2);

	return (
		<Box flexDirection="column">
			{lines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${line}`}
					backgroundColor={theme.band}
					color={theme.bright}
				>
					<Text color={theme.accent}>
						{index === 0 ? theme.glyphs.you : " "}
					</Text>
					{padTo(` ${line}`, width - 1)}
				</Text>
			))}
		</Box>
	);
}
