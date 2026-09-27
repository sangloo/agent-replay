import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom scales, so a later `rounded-panel` replaces an earlier
// `rounded-control` instead of both surviving.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "code"] }],
      rounded: [{ rounded: ["control", "panel", "surface"] }],
      shadow: [{ shadow: ["popover", "modal"] }],
    },
  },
});

/** Class names, with later Tailwind classes winning conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
