import { describe, expect, test } from "bun:test";
import { createTheme, detectCapabilities, detectColorSupport } from "./theme";

describe("detectColorSupport", () => {
	test("honours NO_COLOR above everything else", () => {
		expect(detectColorSupport({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe(
			"none",
		);
	});

	test("treats a dumb terminal as colourless", () => {
		expect(detectColorSupport({ TERM: "dumb" })).toBe("none");
	});

	test("reads truecolor from COLORTERM", () => {
		expect(detectColorSupport({ COLORTERM: "truecolor" })).toBe("rich");
		expect(detectColorSupport({ COLORTERM: "24bit" })).toBe("rich");
	});

	test("accepts a 256 colour terminal", () => {
		expect(detectColorSupport({ TERM: "xterm-256color" })).toBe("rich");
	});

	test("falls back to the sixteen colour set", () => {
		expect(detectColorSupport({ TERM: "xterm" })).toBe("basic");
	});
});

describe("detectCapabilities", () => {
	test("enables bands on a truecolor terminal", () => {
		expect(
			detectCapabilities({ COLORTERM: "truecolor" }, true).bandsEnabled,
		).toBe(true);
	});

	test("lets the user turn bands off for a light background", () => {
		expect(
			detectCapabilities({ COLORTERM: "truecolor", SONNY_TUI_BANDS: "0" }, true)
				.bandsEnabled,
		).toBe(false);
	});

	test("never bands a sixteen colour terminal", () => {
		expect(detectCapabilities({ TERM: "xterm" }, true).bandsEnabled).toBe(
			false,
		);
	});
});

describe("createTheme", () => {
	test("uses hex inks when the terminal can render them", () => {
		const theme = createTheme({
			colorSupport: "rich",
			bandsEnabled: true,
			isInteractive: true,
		});

		expect(theme.accent).toBe("#C07FA8");
		expect(theme.band).toBe("#1D151D");
		expect(theme.bands).toBe(true);
	});

	test("degrades to named colours and drops bands", () => {
		const theme = createTheme({
			colorSupport: "basic",
			bandsEnabled: false,
			isInteractive: true,
		});

		expect(theme.accent).toBe("magenta");
		expect(theme.band).toBeUndefined();
		expect(theme.bands).toBe(false);
	});

	test("drops every colour when the terminal has none", () => {
		const theme = createTheme({
			colorSupport: "none",
			bandsEnabled: false,
			isInteractive: false,
		});

		expect(theme.accent).toBeUndefined();
		expect(theme.fg).toBeUndefined();
		// Glyphs and spacing still separate everything.
		expect(theme.glyphs.you).toBe("›");
	});

	test("stops animating when there is nothing to redraw", () => {
		expect(
			createTheme({
				colorSupport: "rich",
				bandsEnabled: true,
				isInteractive: false,
			}).animate,
		).toBe(false);
	});
});
