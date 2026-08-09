import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { renderInput, type TextInputState } from "../text-input";
import type { Theme } from "../theme";
import { useLayout, useTheme } from "../ui-context";
import { padTo } from "../wrap";

/**
 * The bar's colour is the entire state machine — you never have to read the
 * hint row to know whether Sonny is listening.
 */
export type ComposerState = "ready" | "busy" | "paused" | "error";

function barColor(state: ComposerState, theme: Theme): string | undefined {
	switch (state) {
		case "ready":
			return theme.accent;
		case "busy":
			return theme.accentDim;
		case "paused":
			return theme.faint;
		case "error":
			return theme.err;
	}
}

export function Composer({
	state,
	input,
	placeholder,
	hint,
	right,
	message,
}: {
	state: ComposerState;
	input: TextInputState;
	placeholder: string;
	hint: string;
	right?: ReactNode;
	message?: { text: string; tone: "error" | "dim" } | null;
}) {
	const theme = useTheme();
	const { columns } = useLayout();
	const width = Math.max(24, columns);
	const bodyWidth = width - 2;
	const { lines, cursorLine, cursorColumn } = renderInput(input);
	const showPlaceholder = input.value.length === 0;
	const showCursor = state !== "paused";

	return (
		<Box flexDirection="column">
			{lines.map((line, index) => (
				<Text
					// biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are positional and never reorder
					key={`${index}-${line}`}
					backgroundColor={theme.surface}
				>
					<Text color={barColor(state, theme)}>
						{index === 0 ? theme.glyphs.bar : theme.glyphs.continuation}
					</Text>
					<Text> </Text>
					{showPlaceholder && index === 0 ? (
						<PlaceholderLine
							text={placeholder}
							width={bodyWidth}
							showCursor={showCursor}
						/>
					) : (
						<InputLine
							text={line}
							width={bodyWidth}
							cursorColumn={
								index === cursorLine && showCursor ? cursorColumn : null
							}
						/>
					)}
				</Text>
			))}
			<Box width={width} justifyContent="space-between">
				<Text>
					<Text color={message?.tone === "error" ? theme.err : theme.faint}>
						{`  ${message?.text ?? hint}`}
					</Text>
				</Text>
				{right ?? <Text> </Text>}
			</Box>
		</Box>
	);
}

function PlaceholderLine({
	text,
	width,
	showCursor,
}: {
	text: string;
	width: number;
	showCursor: boolean;
}) {
	const theme = useTheme();

	return (
		<>
			{showCursor ? (
				<Text backgroundColor={theme.accent} color={theme.band}>
					{" "}
				</Text>
			) : null}
			<Text color={theme.faint}>
				{padTo(text, width - (showCursor ? 1 : 0))}
			</Text>
		</>
	);
}

function InputLine({
	text,
	width,
	cursorColumn,
}: {
	text: string;
	width: number;
	cursorColumn: number | null;
}) {
	const theme = useTheme();

	if (cursorColumn === null) {
		return <Text color={theme.fg}>{padTo(text, width)}</Text>;
	}

	const before = text.slice(0, cursorColumn);
	const at = text.slice(cursorColumn, cursorColumn + 1) || " ";
	const after = text.slice(cursorColumn + 1);

	return (
		<>
			<Text color={theme.fg}>{before}</Text>
			<Text backgroundColor={theme.accent} color={theme.band}>
				{at}
			</Text>
			<Text color={theme.fg}>
				{padTo(after, Math.max(0, width - before.length - 1))}
			</Text>
		</>
	);
}
