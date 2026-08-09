import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createTheme, type Theme } from "./theme";
import { resolveLayout, type TerminalLayout } from "./use-terminal-size";

export type UiValue = {
	theme: Theme;
	layout: TerminalLayout;
};

const fallback: UiValue = {
	theme: createTheme({
		colorSupport: "rich",
		bandsEnabled: true,
		isInteractive: true,
	}),
	layout: resolveLayout(80, 24),
};

const UiContext = createContext<UiValue>(fallback);

export function UiProvider({
	theme,
	layout,
	children,
}: {
	theme: Theme;
	layout: TerminalLayout;
	children: ReactNode;
}) {
	const value = useMemo(() => ({ theme, layout }), [theme, layout]);

	return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiValue {
	return useContext(UiContext);
}

export function useTheme(): Theme {
	return useContext(UiContext).theme;
}

export function useLayout(): TerminalLayout {
	return useContext(UiContext).layout;
}
