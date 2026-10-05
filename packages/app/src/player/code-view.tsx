import { cn } from "@/ui";
import * as React from "react";

import {
  composeDiff,
  plainLines,
  type Diffable,
  type Line,
  type LineKind,
  type Span,
} from "./compose";
import { CATEGORY_CLASS, languageOf, paint, tokenize, type Run } from "./highlight";

/**
 * A removed or added line is tinted whole; the characters that changed
 * inside it wear the same translucent tint again, so they read darker
 * without a colour of their own.
 */
const ROW: Record<LineKind, string> = {
  context: "",
  removed: "bg-danger-subtle",
  added: "bg-success-subtle",
};

const STRONG: Record<LineKind, string> = {
  context: "",
  removed: "bg-danger-subtle",
  added: "bg-success-subtle",
};

/** A sign as well as a colour: colour alone is not a state. */
const SIGN: Record<LineKind, { text: string; className: string }> = {
  context: { text: "", className: "" },
  removed: { text: "−", className: "text-danger-ink" },
  added: { text: "+", className: "text-success-ink" },
};

/** Who last wrote a line, as the gutter shows it. */
export type Origin = "base" | "agent" | "outside" | "current";

const ORIGIN: Record<Origin, string> = {
  base: "",
  agent: "bg-info",
  outside: "bg-warning",
  current: "bg-emphasis",
};

interface Sources {
  before: readonly Run[];
  after: readonly Run[];
}

function SpanText({
  span,
  line,
  sources,
}: {
  span: Span;
  line: LineKind;
  sources: Sources;
}) {
  const pieces = paint(span.text, span.at, sources[span.source]);
  return (
    <span className={span.kind === "strong" ? STRONG[line] : undefined}>
      {pieces.map((piece, i) =>
        piece.category ? (
          <span key={i} className={CATEGORY_CLASS[piece.category]}>
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      )}
    </span>
  );
}

const Caret = () => (
  <span
    aria-hidden
    className="-mb-0.5 inline-block h-[1.1em] w-0.5 animate-pulse bg-emphasis align-text-bottom"
  />
);

/** Who wrote a line, shown at its end while it is hovered. */
export interface Blame {
  /** The step that last wrote it, or undefined for the base commit. */
  step?: number;
  text: string;
}

interface CodeLineProps {
  line: Line;
  /** Part of what is being explained. */
  lit?: boolean;
  origin?: Origin;
  sources: Sources;
  /** Shown after the code, dim, while the line is hovered. */
  blame?: Blame;
  onBlame?: (step: number) => void;
}

const CodeLine = React.memo(
  function CodeLine({ line, lit, origin, sources, blame, onBlame }: CodeLineProps) {
    const sign = SIGN[line.kind];
    return (
      <div
        data-row
        data-line={line.number === null ? undefined : line.number - 1}
        className={cn(
          // Every row is exactly one line of text-code, never wrapped: the
          // pane draws only the rows in view and places them by index.
          "flex h-[1.375rem]",
          ROW[line.kind],
          lit && "bg-emphasis-subtle",
          blame && line.kind === "context" && "bg-hover",
        )}
      >
        <span aria-hidden className="flex w-3 shrink-0 justify-center">
          {lit ? (
            <span className="w-0.5 self-stretch bg-emphasis" />
          ) : origin && origin !== "base" ? (
            <span className={cn("w-0.5 self-stretch", ORIGIN[origin])} />
          ) : null}
        </span>
        <span
          aria-hidden
          className="w-12 shrink-0 pr-3 text-right text-text-low/70 tabular-nums select-none"
        >
          {line.number ?? ""}
        </span>
        <span className={cn("w-4 shrink-0 select-none", sign.className)}>
          {sign.text}
        </span>
        <span className="min-w-0 flex-1 pr-4 whitespace-pre">
          {line.spans.map((span, i) => (
            <React.Fragment key={i}>
              {line.caret === i ? <Caret /> : null}
              <SpanText span={span} line={line.kind} sources={sources} />
            </React.Fragment>
          ))}
          {line.caret === line.spans.length ? <Caret /> : null}
          {line.spans.length === 0 && line.caret === undefined ? " " : null}
          {blame ? (
            // Inline, after the code — never over it.
            blame.step !== undefined && onBlame ? (
              <button
                type="button"
                onClick={() => onBlame(blame.step!)}
                className="ml-8 font-sans text-text-low italic select-none hover:text-text-mid hover:underline"
              >
                {blame.text}
              </button>
            ) : (
              <span className="ml-8 font-sans text-text-low italic select-none">
                {blame.text}
              </span>
            )
          ) : null}
        </span>
      </div>
    );
  },
  (a, b) =>
    a.line.key === b.line.key &&
    a.lit === b.lit &&
    a.origin === b.origin &&
    a.sources === b.sources &&
    a.blame === b.blame &&
    a.onBlame === b.onBlame,
);

export interface CodeViewProps {
  path: string;
  /** A diff to show — typed in while `progress` is below 1, then kept. */
  diff?: Diffable;
  /** The file's content, shown plain when there is no diff. */
  content: string | null;
  progress: number;
  /** Per line of the new side, where it came from — absent while typing. */
  origins?: readonly Origin[];
  /** Who wrote a line of the new side, for the inline note on hover. */
  blameOf?: (line: number) => Blame | undefined;
  /** Go to the step a blame note names. */
  onBlame?: (step: number) => void;
  /** The file as it reads: the change's new lines marked, its old ones gone. */
  hideRemoved?: boolean;
  /** Lines being explained (1-based, inclusive): lit, and brought into view. */
  focus?: readonly [number, number];
}

/** Rows drawn beyond the edges of the view, so a fast scroll stays filled. */
const OVERSCAN = 16;
/** The pane's padding above the first line, in px (py-4). */
const PAD = 16;

/**
 * Syntax runs for a text, without holding up the frame that shows it: a
 * small file is coloured at once; a large one shows plain for the moment it
 * takes, then in colour.
 */
function useRuns(text: string, language: string | undefined): readonly Run[] {
  const immediate = text.length <= 40_000;
  const [late, setLate] = React.useState<{ text: string; runs: readonly Run[] }>();
  React.useEffect(() => {
    if (immediate) return;
    const timer = setTimeout(
      () => setLate({ text, runs: tokenize(text, language) }),
      0,
    );
    return () => clearTimeout(timer);
  }, [immediate, text, language]);
  const now = React.useMemo(
    () => (immediate ? tokenize(text, language) : undefined),
    [immediate, text, language],
  );
  return now ?? (late?.text === text ? late.runs : NO_RUNS);
}
const NO_RUNS: readonly Run[] = [];

export function CodeView({
  path,
  diff,
  content,
  progress,
  origins,
  blameOf,
  onBlame,
  hideRemoved,
  focus,
}: CodeViewProps) {
  const lines = React.useMemo(() => {
    if (!diff) return plainLines(content ?? "");
    const composed = composeDiff(diff, progress);
    return hideRemoved ? composed.filter((line) => line.kind !== "removed") : composed;
  }, [diff, content, progress, hideRemoved]);
  const language = languageOf(path);
  // Tokenized once per version of the file, not per frame of typing.
  const before = useRuns(diff ? (diff.before ?? "") : (content ?? ""), language);
  const after = useRuns(diff ? (diff.after ?? "") : (content ?? ""), language);
  const sources = React.useMemo<Sources>(() => ({ before, after }), [before, after]);

  const scroller = React.useRef<HTMLDivElement>(null);
  const [row, setRow] = React.useState(22);
  const [view, setView] = React.useState({ top: 0, height: 800 });
  React.useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    // One line's height in px, whatever the root font size.
    const probe = box.querySelector<HTMLElement>("[data-row]");
    if (probe && probe.offsetHeight) setRow(probe.offsetHeight);
    const measure = () => setView({ top: box.scrollTop, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const target = lines.findIndex((line) => line.caret !== undefined);
  const focused = (line: Line) =>
    focus !== undefined &&
    line.number !== null &&
    line.number >= focus[0] &&
    line.number <= focus[1];
  const lit = focus ? lines.findIndex(focused) : -1;
  const anchor =
    target >= 0 ? target : lit >= 0 ? lit : lines.findIndex((line) => line.hot);

  // Keep the typing point — or, before it, the start of the change — in the
  // upper middle of the view. A new file opens there at once; within a file
  // the view glides to the next hunk and follows the caret down, and jumps
  // when the distance is more than a screen or motion is reduced.
  const opened = React.useRef(false);
  React.useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || anchor < 0) return;
    const top = PAD + anchor * row;
    const height = box.clientHeight;
    const inView =
      top >= box.scrollTop + height * 0.12 && top <= box.scrollTop + height * 0.72;
    if (inView && opened.current) return;
    const goal = Math.max(0, top - height * 0.35);
    const far = Math.abs(goal - box.scrollTop) > height;
    const still =
      !opened.current ||
      far ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    opened.current = true;
    box.scrollTo({ top: goal, behavior: still ? "instant" : "smooth" });
    if (still) setView((last) => ({ ...last, top: box.scrollTop }));
  }, [anchor, lines, row]);

  // The hovered line says who wrote it, inline and dim at its end.
  const [hover, setHover] = React.useState<number>();
  const onMove = (event: React.MouseEvent) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-line]");
    const line = el?.dataset.line === undefined ? undefined : Number(el.dataset.line);
    if (line !== hover) setHover(line);
  };
  const blame = React.useMemo(
    () => (hover !== undefined && origins && blameOf ? blameOf(hover) : undefined),
    [hover, origins, blameOf],
  );

  const first = Math.max(0, Math.floor((view.top - PAD) / row) - OVERSCAN);
  const last = Math.min(
    lines.length,
    Math.ceil((view.top + view.height) / row) + OVERSCAN,
  );
  // The widest line sets the scroll width, so it does not change as rows
  // come and go.
  const widest = React.useMemo(
    () =>
      lines.reduce(
        (most, line) =>
          Math.max(
            most,
            line.spans.reduce((sum, span) => sum + span.text.length, 0),
          ),
        0,
      ),
    [lines],
  );

  return (
    <div
      ref={scroller}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(undefined)}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setView((last) => (last.top === top ? last : { ...last, top }));
      }}
      className="relative h-full overflow-auto py-4 font-mono text-code text-text-high"
    >
      <div
        style={{
          height: lines.length * row,
          minWidth: `calc(${widest}ch + 6rem)`,
        }}
        className="relative"
      >
        <div style={{ transform: `translateY(${first * row}px)` }}>
          {lines.slice(first, last).map((line, i) => (
            <CodeLine
              key={first + i}
              line={line}
              origin={line.number === null ? undefined : origins?.[line.number - 1]}
              sources={sources}
              lit={focused(line)}
              blame={
                line.number !== null && line.number - 1 === hover ? blame : undefined
              }
              onBlame={onBlame}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
