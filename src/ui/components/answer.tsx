import { Box, Text } from "ink";
import { type MarkdownSpan, parseMarkdown } from "../markdown";
import { useLayout, useTheme } from "../ui-context";
import { wrapText } from "../wrap";

/**
 * Sonny's answer is the only unmarked thing on screen, which is what makes it
 * read as the default rather than as one more annotated row.
 */
export function Answer({ text }: { text: string }) {
	const theme = useTheme();
	const { columns } = useLayout();
	const width = Math.max(20, columns - 2);
	const lines = parseMarkdown(text);

	return (
		<Box flexDirection="column">
			{lines.map((line, index) => {
				const key = `${index}-${line.kind}`;

				if (line.kind === "blank") {
					return <Text key={key}> </Text>;
				}

				if (line.kind === "heading") {
					return (
						<Text key={key} color={theme.bright} bold>
							{line.text}
						</Text>
					);
				}

				if (line.kind === "code") {
					return (
						<Text key={key} color={theme.dim}>
							{`  ${line.text}`}
						</Text>
					);
				}

				if (line.kind === "bullet") {
					return (
						<Text key={key}>
							<Text color={theme.dim}>{`  ${theme.glyphs.bullet} `}</Text>
							<Spans spans={line.spans} />
						</Text>
					);
				}

				return <ParagraphLine key={key} spans={line.spans} width={width} />;
			})}
		</Box>
	);
}

function Spans({ spans }: { spans: MarkdownSpan[] }) {
	const theme = useTheme();

	return (
		<>
			{spans.map((span, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${span.text}`}
					color={span.emphasis ? theme.bright : theme.fg}
				>
					{span.text}
				</Text>
			))}
		</>
	);
}

/**
 * Wrapping happens on the joined text so a bright identifier does not force a
 * break, then the spans are re-applied per line.
 */
function ParagraphLine({
	spans,
	width,
}: {
	spans: MarkdownSpan[];
	width: number;
}) {
	const theme = useTheme();
	const text = spans.map((span) => span.text).join("");
	const lines = wrapText(text, width);

	if (lines.length <= 1) {
		return (
			<Text>
				<Spans spans={spans} />
			</Text>
		);
	}

	return (
		<>
			{lines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${line}`}
					color={theme.fg}
				>
					{line}
				</Text>
			))}
		</>
	);
}
