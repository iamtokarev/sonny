import { Text } from "ink";
import type { MeterModel } from "../context-meter";
import type { Theme } from "../theme";
import { useTheme } from "../ui-context";

function fillColor(zone: MeterModel["zone"], theme: Theme): string | undefined {
	switch (zone) {
		case "over":
			return theme.err;
		case "warn":
			return theme.warn;
		case "normal":
			return theme.accent;
	}
}

/** Shared by `/context` and the composer hint row, so they can never disagree. */
export function ContextMeter({
	meter,
	showPercent = true,
}: {
	meter: MeterModel;
	showPercent?: boolean;
}) {
	const theme = useTheme();

	return (
		<Text>
			<Text color={fillColor(meter.zone, theme)}>
				{theme.glyphs.meterFull.repeat(meter.filledCells)}
			</Text>
			<Text color={theme.faint}>
				{theme.glyphs.meterEmpty.repeat(meter.totalCells - meter.filledCells)}
			</Text>
			{showPercent ? (
				<Text color={theme.fg}>{` ${meter.percent}%`}</Text>
			) : null}
		</Text>
	);
}
