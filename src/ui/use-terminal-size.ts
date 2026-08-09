import { useWindowSize } from "ink";

/**
 * Bands span the full width and the composer hint row has a left and a right
 * half, so almost every component needs to know how wide the terminal is.
 */
export type TerminalLayout = {
	columns: number;
	rows: number;
	/** Below this, previews truncate hard and the hint row sheds detail. */
	isNarrow: boolean;
	/** Above this there is room for the full hint row plus a context meter. */
	isWide: boolean;
};

export const narrowBreakpoint = 60;
export const wideBreakpoint = 100;
const fallbackColumns = 80;
const fallbackRows = 24;

export function resolveLayout(columns: number, rows: number): TerminalLayout {
	const safeColumns =
		Number.isFinite(columns) && columns > 0 ? columns : fallbackColumns;
	const safeRows = Number.isFinite(rows) && rows > 0 ? rows : fallbackRows;

	return {
		columns: safeColumns,
		rows: safeRows,
		isNarrow: safeColumns < narrowBreakpoint,
		isWide: safeColumns >= wideBreakpoint,
	};
}

export function useTerminalSize(): TerminalLayout {
	const { columns, rows } = useWindowSize();

	return resolveLayout(columns, rows);
}
