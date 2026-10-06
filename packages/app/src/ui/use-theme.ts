import * as React from "react";

export type Theme = "light" | "dark" | "system";

export interface ThemeState {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = React.createContext<ThemeState | undefined>(undefined);

export function useTheme(): ThemeState {
  const state = React.useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider above it.");
  return state;
}
