/**
 * Mulberry — the terminal palette.
 *
 * Six inks and one accent. The rule that keeps it coherent: the accent marks
 * *you* (your turn, your cursor, your bar, your selection) and never touches
 * Sonny's prose or a tool result. `ok` and `err` mean a thing finished; they
 * never emphasise.
 */

export type ColorSupport = "none" | "basic" | "rich";

export type TerminalCapabilities = {
	colorSupport: ColorSupport;
	/** Background fills look wrong on a light terminal, so they are opt-out. */
	bandsEnabled: boolean;
	/** Spinners and cursors only make sense when we can redraw. */
	isInteractive: boolean;
};

export type Theme = {
	/** Background of your turns and the composer row. Undefined means flat mode. */
	band: string | undefined;
	/** Background of the composer row and popup selection. */
	surface: string | undefined;
	bright: string | undefined;
	fg: string | undefined;
	dim: string | undefined;
	faint: string | undefined;
	accent: string | undefined;
	accentDim: string | undefined;
	ok: string | undefined;
	err: string | undefined;
	warn: string | undefined;
	bands: boolean;
	animate: boolean;
	glyphs: Glyphs;
};

export type Glyphs = {
	you: string;
	tool: string;
	bar: string;
	continuation: string;
	branch: string;
	bullet: string;
	resumed: string;
	sonny: string;
	meterFull: string;
	meterEmpty: string;
	spinner: readonly string[];
};

const glyphs: Glyphs = {
	you: "›",
	tool: "⏺",
	bar: "▍",
	continuation: "┆",
	branch: "└",
	bullet: "·",
	resumed: "↻",
	sonny: "◆",
	meterFull: "▰",
	meterEmpty: "▱",
	spinner: ["◐", "◓", "◑", "◒"],
};

/**
 * Truecolor and 256-colour terminals both take hex — chalk downsamples for us.
 * Only the 16-colour case needs its own names.
 */
const richInks = {
	band: "#1D151D",
	surface: "#151016",
	bright: "#F2EAEE",
	fg: "#D0C6CC",
	dim: "#6B5F66",
	faint: "#40383E",
	accent: "#C07FA8",
	accentDim: "#7C4F6A",
	ok: "#77AB84",
	err: "#CF6F6F",
	warn: "#C0A065",
} as const;

const basicInks = {
	band: "blackBright",
	surface: "blackBright",
	bright: "whiteBright",
	fg: "white",
	dim: "gray",
	faint: "gray",
	accent: "magenta",
	accentDim: "magenta",
	ok: "green",
	err: "red",
	warn: "yellow",
} as const;

const monochrome = {
	band: undefined,
	surface: undefined,
	bright: undefined,
	fg: undefined,
	dim: undefined,
	faint: undefined,
	accent: undefined,
	accentDim: undefined,
	ok: undefined,
	err: undefined,
	warn: undefined,
} as const;

function isEnabled(value: string | undefined): boolean {
	return value !== undefined && value !== "" && value !== "0";
}

export function detectColorSupport(
	env: Record<string, string | undefined>,
): ColorSupport {
	if (isEnabled(env.NO_COLOR)) {
		return "none";
	}

	const term = env.TERM ?? "";

	if (term === "dumb") {
		return "none";
	}

	const colorTerm = (env.COLORTERM ?? "").toLowerCase();

	if (colorTerm === "truecolor" || colorTerm === "24bit") {
		return "rich";
	}

	if (term.includes("256")) {
		return "rich";
	}

	return term === "" ? "none" : "basic";
}

export function detectCapabilities(
	env: Record<string, string | undefined>,
	isTTY: boolean,
): TerminalCapabilities {
	const colorSupport = detectColorSupport(env);

	return {
		colorSupport,
		// Bands need a real background fill, and the user can always turn them
		// off when their terminal background is light.
		bandsEnabled: colorSupport === "rich" && env.SONNY_TUI_BANDS !== "0",
		isInteractive: isTTY,
	};
}

export function createTheme(capabilities: TerminalCapabilities): Theme {
	const inks =
		capabilities.colorSupport === "rich"
			? richInks
			: capabilities.colorSupport === "basic"
				? basicInks
				: monochrome;

	const bands =
		capabilities.bandsEnabled && capabilities.colorSupport !== "none";

	return {
		...inks,
		band: bands ? inks.band : undefined,
		surface: bands ? inks.surface : undefined,
		bands,
		animate: capabilities.isInteractive,
		glyphs,
	};
}

export function createDefaultTheme(): Theme {
	return createTheme(
		detectCapabilities(process.env, process.stdout.isTTY === true),
	);
}
