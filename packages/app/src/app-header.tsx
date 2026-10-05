import { cn } from "@/ui";
import { Play } from "lucide-react";
import type * as React from "react";

import { ThemeToggle } from "./theme-toggle";

/** The three places outside a replay: what agents did, what was kept, what to learn. */
export type Place = "sessions" | "saved" | "learn";

const PLACES: { place: Place; label: string; hint: string }[] = [
  {
    place: "sessions",
    label: "Sessions",
    hint: "Agent sessions on this machine — Claude Code, Codex and Gemini CLI",
  },
  {
    place: "saved",
    label: "Saved",
    hint: "Replays and courses saved into a repository’s .replays/ folder",
  },
  {
    place: "learn",
    label: "Learn",
    hint: "Courses that rebuild a repository lesson by lesson, and where you are in each",
  },
];

/**
 * The one header every page outside a replay shares, so reviewing and
 * learning are two tabs of the same tool rather than two tools: the same
 * place, the same way back.
 */
export function AppHeader({
  place,
  hrefOf,
  picker,
}: {
  place: Place;
  /** Where each tab goes — the library keeps its project when switching. */
  hrefOf?: (place: Place) => string;
  /** The project picker, where the page is about one project. */
  picker?: React.ReactNode;
}) {
  const href = hrefOf ?? defaultHref;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-base px-3">
      <a
        href="#/"
        className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-sm font-semibold focus-bar"
      >
        <span className="grid size-5 place-items-center rounded-[5px] bg-emphasis text-accent-text">
          <Play aria-hidden className="size-3 translate-x-px fill-current" />
        </span>
        <span className="hidden sm:inline">Replay</span>
      </a>
      {picker ? (
        <>
          <span aria-hidden className="hidden text-text-low sm:inline">
            /
          </span>
          <span className="min-w-0 shrink">{picker}</span>
        </>
      ) : null}
      <nav
        aria-label="Pages"
        className="ml-auto flex h-full shrink-0 items-stretch gap-0.5 sm:gap-1"
      >
        {PLACES.map((item) => (
          <a
            key={item.place}
            href={href(item.place)}
            title={item.hint}
            aria-current={item.place === place ? "page" : undefined}
            className={cn(
              "relative flex items-center px-1.5 text-sm focus-bar sm:px-2.5",
              item.place === place
                ? "font-medium text-text-high after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-emphasis"
                : "text-text-low hover:text-text-high",
            )}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
      <ThemeToggle />
    </header>
  );
}

function defaultHref(place: Place): string {
  return place === "learn" ? "#/learn" : place === "saved" ? "#/?tab=saved" : "#/";
}
