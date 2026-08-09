import { Box, Text } from "ink";
import type { CommandOption } from "../command-popup";
import { useTheme } from "../ui-context";

/**
 * The one place a border is allowed: it is a floating layer, and the composer
 * below it is a bar rather than a box, so the screen still carries only one
 * heavy device.
 */
export function CommandPopup({
	options,
	selectedIndex,
}: {
	options: CommandOption[];
	selectedIndex: number;
}) {
	const theme = useTheme();

	if (options.length === 0) {
		return null;
	}

	const nameWidth =
		Math.max(...options.map((option) => option.name.length)) + 1;

	return (
		<Box flexDirection="column" marginLeft={2}>
			<Text color={theme.faint}>commands</Text>
			{options.map((option, index) => {
				const selected = index === selectedIndex;

				return (
					<Text
						key={option.name}
						backgroundColor={selected ? theme.surface : undefined}
					>
						<Text color={selected ? theme.accent : theme.fg}>
							{`/${option.name}`.padEnd(nameWidth + 1)}
						</Text>
						<Text color={theme.dim}>{`  ${option.description}`}</Text>
					</Text>
				);
			})}
			<Text color={theme.faint}>↑↓ move · ⇥ complete · ⏎ run · esc close</Text>
		</Box>
	);
}
