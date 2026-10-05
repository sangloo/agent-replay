import * as React from "react";

import { cn } from "./cn";

/** What a mark on the timeline stands for. Steps with no tone get none. */
export type Tone = "prompt" | "note" | "pass" | "fail" | "commit";

export interface ScrubStep {
  tone?: Tone;
}

const MARK: Record<Tone, string> = {
  prompt: "h-3 w-0.5 rounded-full bg-text-low",
  commit: "h-3 w-0.5 rounded-full bg-info",
  note: "size-1.5 rounded-full bg-warning",
  pass: "size-1.5 rounded-full bg-success",
  fail: "size-1.5 rounded-full bg-danger",
};

export interface ScrubberProps {
  steps: readonly ScrubStep[];
  /** Steps applied: 0 is the base, `steps.length` the end. */
  cursor: number;
  label: string;
  /** What position 0 is called. */
  baseLabel: string;
  /** What a position is called — asked only for the one hovered or focused. */
  labelOf: (position: number) => string;
  onJump: (position: number) => void;
}

/**
 * The session as a line: drag or click to go anywhere, arrows to step. Marks
 * show where the prompts, notes and test runs are, so the shape of the
 * session is readable before any of it plays.
 */
export const Scrubber = React.memo(function Scrubber({
  steps,
  cursor,
  label,
  baseLabel,
  labelOf,
  onJump,
}: ScrubberProps) {
  const track = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<{ position: number; x: number }>();
  const dragging = React.useRef(false);
  const n = steps.length;
  const ratio = n ? cursor / n : 0;

  const positionAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !n) return { position: 0, x: 0 };
    const x = Math.min(box.width, Math.max(0, clientX - box.left));
    return { position: Math.round((x / box.width) * n), x };
  };
  const nameOf = (position: number) =>
    position === 0 ? baseLabel : position <= n ? labelOf(position) : "";

  const marks = React.useMemo(
    () =>
      steps.flatMap((step, i) =>
        step.tone ? [{ at: (i + 1) / Math.max(1, steps.length), tone: step.tone }] : [],
      ),
    [steps],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={cursor}
      aria-valuetext={`${cursor} of ${n}: ${nameOf(cursor)}`}
      onKeyDown={(event) => {
        const moves: Record<string, number> = {
          ArrowRight: 1,
          ArrowUp: 1,
          ArrowLeft: -1,
          ArrowDown: -1,
          PageUp: 10,
          PageDown: -10,
        };
        let next: number | undefined;
        if (event.key in moves) next = cursor + moves[event.key]!;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = n;
        if (next === undefined) return;
        event.preventDefault();
        onJump(Math.min(n, Math.max(0, next)));
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        onJump(positionAt(event.clientX).position);
      }}
      onPointerMove={(event) => {
        const at = positionAt(event.clientX);
        setHover(at);
        if (dragging.current && at.position !== cursor) onJump(at.position);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => setHover(undefined)}
      className="group relative flex h-8 cursor-pointer touch-none items-center rounded-control px-2 focus-bar outline-none"
    >
      <div ref={track} className="relative h-1 w-full rounded-full bg-line-high">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-text-mid"
          style={{ width: `${ratio * 100}%` }}
        />
        {marks.map((mark, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-1/2",
              MARK[mark.tone],
            )}
            style={{ left: `${mark.at * 100}%` }}
          />
        ))}
        <span
          aria-hidden
          className="absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-surface-base bg-emphasis shadow-popover"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      {hover ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full mb-1 max-w-72 -translate-x-1/2 truncate rounded-control border border-line bg-surface-raised px-2 py-1 text-xs text-text-high shadow-popover"
          style={{ left: hover.x + 8 }}
        >
          <span className="text-text-low tabular-nums">{hover.position}</span>{" "}
          {nameOf(hover.position)}
        </span>
      ) : null}
    </div>
  );
});
