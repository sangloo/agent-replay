import * as React from "react";

export type Theme = "light" | "dark" | "system";

/** The colour that marks "now"; `styles.css` defines each, per theme. */
export const ACCENTS = ["mono", "ember", "lagoon", "lime", "iris"] as const;
export type Accent = (typeof ACCENTS)[number];

export interface ThemeState {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
}

export const ThemeContext = React.createContext<ThemeState | undefined>(undefined);

export function useTheme(): ThemeState {
  const state = React.useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider above it.");
  return state;
}
