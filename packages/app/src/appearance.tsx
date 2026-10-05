import {
  ACCENTS,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useTheme,
  type Accent,
  type Theme,
} from "@/ui";
import { Palette } from "lucide-react";

import { Choice } from "./choice";

const ACCENT_NAMES: Record<Accent, string> = {
  ember: "Ember",
  lagoon: "Lagoon",
  lime: "Lime",
  iris: "Iris",
  mono: "Mono",
};

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies readonly { value: Theme; label: string }[];

/**
 * Light, dark or the system's, and the accent: the whole of how the tool
 * looks, in the header's menu and the player's alike.
 */
export function AppearanceControls() {
  const { theme, setTheme, accent, setAccent } = useTheme();
  return (
    <div className="flex flex-col gap-2 p-1.5">
      <p className="px-1 text-2xs font-medium text-text-low">Appearance</p>
      <Choice<Theme> label="Theme" value={theme} onChange={setTheme} options={THEMES} />
      <div
        role="radiogroup"
        aria-label="Accent"
        className="flex items-center gap-1 px-1"
      >
        {ACCENTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={accent === option}
            aria-label={ACCENT_NAMES[option]}
            title={ACCENT_NAMES[option]}
            onClick={() => setAccent(option)}
            className={cn(
              "grid size-7 place-items-center rounded-full focus-bar",
              accent === option ? "bg-active" : "hover:bg-hover",
            )}
          >
            {/* Each swatch carries its own accent's colour, in this theme. */}
            <span data-swatch={option} className="size-4 rounded-full bg-emphasis" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Appearance behind one button, for the header outside a replay. */
export function AppearanceMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Appearance" variant="ghost" size="sm">
          <Palette />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <AppearanceControls />
      </PopoverContent>
    </Popover>
  );
}
