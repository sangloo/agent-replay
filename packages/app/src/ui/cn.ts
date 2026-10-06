import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom scales, so a later `rounded-panel` replaces an earlier
// `rounded-control` instead of both surviving.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Without these, `text-body` reads as a colour and a later `text-text-high` drops it.
      "font-size": [{ text: ["2xs", "body", "code"] }],
      rounded: [{ rounded: ["sm", "control", "panel", "surface"] }],
      shadow: [{ shadow: ["sheet", "popover", "modal"] }],
    },
  },
});

/** Class names, with later Tailwind classes winning conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
