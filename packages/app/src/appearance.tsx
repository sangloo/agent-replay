import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useTheme,
  type Theme,
} from "@/ui";
import { SunMoon } from "lucide-react";

import { Choice } from "./choice";

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies readonly { value: Theme; label: string }[];

/** Light, dark or the system's: in the header's menu and the player's alike. */
export function AppearanceControls() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-2 p-1.5">
      <p className="px-1 text-2xs font-medium text-text-low">Appearance</p>
      <Choice<Theme> label="Theme" value={theme} onChange={setTheme} options={THEMES} />
    </div>
  );
}

/** Appearance behind one button, for the header outside a replay. */
export function AppearanceMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Appearance" variant="ghost" size="sm">
          <SunMoon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <AppearanceControls />
      </PopoverContent>
    </Popover>
  );
}
