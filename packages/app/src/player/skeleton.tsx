import { ArrowLeft, LoaderCircle } from "lucide-react";
import * as React from "react";

/** Seconds since it appeared, for a wait that should say how long it has been. */
function useSeconds() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * The player's shape while a replay is read: its title, the way back, and
 * where the code will be — so opening a replay is a page arriving, not a
 * blank screen with a spinner.
 */
export function PlayerSkeleton({
  title,
  what,
  loaded,
  total,
  preview,
  backLabel,
  onBack,
}: {
  title?: string;
  what: string;
  /** Steps arrived so far, of `total`, while a session streams in. */
  loaded?: number;
  total?: number;
  /** The session's first words, to read while the rest arrives. */
  preview?: string;
  backLabel?: string;
  onBack?: () => void;
}) {
  const seconds = useSeconds();
  const widths = [62, 48, 71, 35, 80, 54, 66, 28, 74, 45, 58, 39, 69, 51];
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-base text-text-high">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-2">
        {onBack ? (
          <>
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-text-mid focus-bar hover:bg-hover hover:text-text-high [&_svg]:size-4"
            >
              <ArrowLeft aria-hidden />
              {backLabel ?? "Back"}
            </button>
            <span aria-hidden className="h-5 w-px bg-line" />
          </>
        ) : null}
        {title ? (
          <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        ) : (
          <span className="h-3.5 w-64 animate-pulse rounded-full bg-surface-mid" />
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-line bg-surface-low p-4 md:flex">
          {widths.slice(0, 9).map((w, i) => (
            <span
              key={i}
              className="h-2.5 animate-pulse rounded-full bg-surface-mid"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            role="status"
            className="relative flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 text-xs text-text-mid"
          >
            <LoaderCircle aria-hidden className="size-3.5 animate-spin text-text-low" />
            {what}
            {total ? (
              <span className="text-text-low tabular-nums">
                · {loaded ?? 0} of {total} steps
              </span>
            ) : null}
            {seconds >= 2 ? (
              <span className="text-text-low tabular-nums">· {seconds} s</span>
            ) : null}
            {total ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-0.5 bg-emphasis transition-[width] duration-fast"
                style={{ width: `${Math.round(((loaded ?? 0) / total) * 100)}%` }}
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-3 px-8 py-6">
            {preview ? (
              <p className="mb-3 line-clamp-6 max-w-prose text-sm whitespace-pre-wrap text-text-mid">
                {preview}
              </p>
            ) : null}
            {widths.map((w, i) => (
              <span
                key={i}
                className="h-2.5 animate-pulse rounded-full bg-surface-mid"
                style={{ width: `${w * 0.8}%`, animationDelay: `${i * 60}ms` }}
              />
            ))}
            {seconds >= 6 ? (
              <p className="mt-4 max-w-prose text-xs text-text-low">
                A long session is read in full the first time it is opened, and compared
                with the repository; opening it again is quick.
              </p>
            ) : null}
          </div>
        </main>
        <div className="hidden w-80 shrink-0 flex-col gap-3 border-l border-line bg-surface-low p-4 lg:flex">
          {widths.slice(3, 12).map((w, i) => (
            <span
              key={i}
              className="h-2.5 animate-pulse rounded-full bg-surface-mid"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
      <footer className="h-14 shrink-0 border-t border-line" />
    </div>
  );
}
