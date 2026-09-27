import * as React from "react";

import { ThemeContext, type Theme, type ThemeState } from "./use-theme";

const KEY = "theme";

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Light, dark or the system's, as the `.dark` class on <html>. `index.html`
 * applies the stored choice before the first paint; this keeps it current.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(stored);
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
  const value = React.useMemo<ThemeState>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next) => {
        setThemeState(next);
        try {
          if (next === "system") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          // Private mode: the choice lasts the page.
        }
      },
    }),
    [theme, resolvedTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
