import * as React from "react";

import { cn } from "./cn";

export interface ResizablePanelProps {
  /** Which edge carries the handle. */
  side: "left" | "right";
  size: number;
  min: number;
  max: number;
  defaultSize: number;
  /** Every frame of a drag. */
  onSizeChange: (size: number) => void;
  /** Once, when the drag or key press ends. */
  onSizeCommit: (size: number) => void;
  /** The handle's accessible name. */
  label: string;
  className?: string;
  children: React.ReactNode;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * A panel with a draggable edge. The edge is a real separator: focusable,
 * arrow keys resize it, double-click puts it back.
 */
export function ResizablePanel({
  side,
  size,
  min,
  max,
  defaultSize,
  onSizeChange,
  onSizeCommit,
  label,
  className,
  children,
}: ResizablePanelProps) {
  const [dragging, setDragging] = React.useState(false);
  const start = React.useRef({ x: 0, size });
  const latest = React.useRef(size);

  const resize = (next: number) => {
    latest.current = clamp(Math.round(next), min, max);
    onSizeChange(latest.current);
  };

  return (
    <div
      className={cn("relative flex shrink-0", dragging && "select-none", className)}
      style={{ width: size }}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={size}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = { x: event.clientX, size };
          latest.current = size;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const dx = event.clientX - start.current.x;
          resize(start.current.size + (side === "right" ? dx : -dx));
        }}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          onSizeCommit(latest.current);
        }}
        onDoubleClick={() => onSizeCommit(defaultSize)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 16;
          const grow = side === "right" ? "ArrowRight" : "ArrowLeft";
          const shrink = side === "right" ? "ArrowLeft" : "ArrowRight";
          if (event.key !== grow && event.key !== shrink) return;
          event.preventDefault();
          onSizeCommit(clamp(size + (event.key === grow ? step : -step), min, max));
        }}
        className={cn(
          "group absolute inset-y-0 z-raised flex w-2 cursor-col-resize justify-center outline-none",
          side === "right" ? "-right-1" : "-left-1",
        )}
      >
        <span
          className={cn(
            "w-px bg-transparent transition-colors duration-fast group-hover:bg-emphasis group-focus-visible:bg-emphasis",
            dragging && "bg-emphasis",
          )}
        />
      </div>
    </div>
  );
}
