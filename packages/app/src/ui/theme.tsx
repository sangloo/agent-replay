import * as React from "react";

import {
  ACCENTS,
  ThemeContext,
  type Accent,
  type Theme,
  type ThemeState,
} from "./use-theme";

const KEY = "theme";
const ACCENT_KEY = "accent";

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function storedAccent(): Accent {
  try {
    const value = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.find((accent) => accent === value) ?? "mono";
  } catch {
    return "mono";
  }
}

function remember(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts the page.
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Light, dark or the system's, as the `.dark` class on <html>, and the
 * accent as its `data-accent`. `index.html` applies the stored choices
 * before the first paint; this keeps them current.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(stored);
  const [accent, setAccentState] = React.useState<Accent>(storedAccent);
  const [systemDark, setSystemDark] = React.useState(() => media().matches);
  React.useEffect(() => {
    const query = media();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.classList.toggle("light", resolvedTheme === "light");
  }, [resolvedTheme]);
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    if (accent === "mono") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
  }, [accent]);
  const value = React.useMemo<ThemeState>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next) => {
        setThemeState(next);
        remember(KEY, next === "system" ? undefined : next);
      },
      accent,
      setAccent: (next) => {
        setAccentState(next);
        remember(ACCENT_KEY, next === "mono" ? undefined : next);
      },
    }),
    [theme, resolvedTheme, accent],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
