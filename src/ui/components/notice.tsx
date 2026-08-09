import { Box, Text } from "ink";
import type { Theme } from "../theme";
import type { NoticeTone } from "../transcript";
import { useTheme } from "../ui-context";

function toneColor(tone: NoticeTone, theme: Theme): string | undefined {
	switch (tone) {
		case "warn":
			return theme.warn;
		case "error":
			return theme.err;
		case "info":
			return theme.dim;
	}
}

/**
 * Command output and errors are notices, not messages: dim, unbanded, and
 * visually below the conversation rather than part of it.
 *
 * Warnings and errors get the composer bar in their own colour — the same
 * device in a different state, so there is one shape to learn.
 */
export function Notice({
	tone,
	title,
	lines,
}: {
	tone: NoticeTone;
	title: string | null;
	lines: string[];
}) {
	const theme = useTheme();
	const color = toneColor(tone, theme);

	if (tone === "info") {
		return (
			<Box flexDirection="column">
				{title === null ? null : <Text color={theme.dim}>{`  ${title}`}</Text>}
				{lines.map((line, index) => (
					<Text
						// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
						key={`${index}-${line}`}
						color={theme.fg}
					>
						{`  ${line}`}
					</Text>
				))}
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{title === null ? null : (
				<Text>
					<Text color={color}>{`${theme.glyphs.bar} `}</Text>
					<Text color={color}>{title}</Text>
				</Text>
			)}
			{lines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${line}`}
				>
					<Text color={color}>{`${theme.glyphs.bar} `}</Text>
					<Text color={theme.fg}>{line}</Text>
				</Text>
			))}
		</Box>
	);
}
