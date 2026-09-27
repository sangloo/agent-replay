import { IconButton, useTheme } from "@/ui";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <IconButton
      label={dark ? "Use light theme" : "Use dark theme"}
      variant="ghost"
      size="sm"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}
