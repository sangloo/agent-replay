import { cn, segmentClass } from "@/ui";
import type * as React from "react";

import { AppearanceMenu } from "./appearance";

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
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      <a
        href="#/"
        className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-sm font-semibold focus-bar"
      >
        <LogoMark />
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
      <nav aria-label="Pages" className="ml-auto flex shrink-0 items-center gap-0.5">
        {PLACES.map((item) => (
          <a
            key={item.place}
            href={href(item.place)}
            title={item.hint}
            aria-current={item.place === place ? "page" : undefined}
            className={segmentClass(item.place === place, "md")}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <AppearanceMenu />
    </header>
  );
}

/**
 * The mark: a play triangle on a tile. Drawn rather than taken from the
 * icon set, whose triangle sits a pixel and a half right of centre at this
 * size. A triangle's bounding box looks left-heavy and its centroid
 * right-heavy, so the box sits a little right of centre, between the two.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cn("size-5 shrink-0 text-emphasis", className)}
    >
      <rect width="20" height="20" rx="5" fill="currentColor" />
      <path
        d="M7.1 6.1v7.8l6.75-3.9z"
        className="fill-accent-text stroke-accent-text"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function defaultHref(place: Place): string {
  return place === "learn" ? "#/learn" : place === "saved" ? "#/?tab=saved" : "#/";
}
