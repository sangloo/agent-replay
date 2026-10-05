import type { Frame, NoteLevel, Replay, Step } from "@agent-replay/core";
import { cn } from "@/ui";
import {
  BookOpen,
  ChevronRight,
  FileMinus,
  FilePen,
  FilePlus,
  FileTerminal,
  GitCommitHorizontal,
  Lightbulb,
  MessageSquare,
  Terminal,
} from "lucide-react";
import * as React from "react";

import { Choice } from "../choice";
import { firstLine, stepLabel, when } from "../labels";
import { Markdown } from "./markdown";

const NOTE: Record<
  NoteLevel,
  { label: string; rule: string; ink: string; dot: string }
> = {
  info: {
    label: "Note",
    rule: "border-info-line",
    ink: "text-info-ink",
    dot: "bg-info",
  },
  review: {
    label: "Review this",
    rule: "border-warning-line",
    ink: "text-warning-ink",
    dot: "bg-warning",
  },
  risk: {
    label: "Risk",
    rule: "border-danger-line",
    ink: "text-danger-ink",
    dot: "bg-danger",
  },
};

export function StepIcon({ frame, className }: { frame: Frame; className: string }) {
  const { step, change } = frame;
  switch (step.kind) {
    case "edit":
      return <FilePen aria-hidden className={className} />;
    case "write":
      return change?.before === null ? (
        <FilePlus aria-hidden className={className} />
      ) : (
        <FilePen aria-hidden className={className} />
      );
    case "delete":
      return <FileMinus aria-hidden className={className} />;
    case "external":
      return <FileTerminal aria-hidden className={className} />;
    case "command":
      return <Terminal aria-hidden className={className} />;
    case "commit":
      return <GitCommitHorizontal aria-hidden className={className} />;
    case "lesson":
      return <BookOpen aria-hidden className={className} />;
    case "explain":
      return <Lightbulb aria-hidden className={className} />;
    default:
      return <MessageSquare aria-hidden className={className} />;
  }
}

/** A row's words: the step's label, without what its icon already says. */
function rowLabel(frame: Frame): string {
  return stepLabel(frame);
}

type Place = "done" | "current" | "ahead";

/** One step, as a row; the current one opens to say everything about it. */
const Row = React.memo(function Row({
  frame,
  replay,
  place,
  onJump,
  rowRef,
}: {
  frame: Frame;
  replay: Replay;
  place: Place;
  onJump: (cursor: number) => void;
  rowRef?: React.Ref<HTMLLIElement>;
}) {
  const { step, change } = frame;
  const note = replay.notes[step.id];
  const failed = step.kind === "command" && step.failed;
  return (
    <li ref={rowRef} className={cn(place === "current" && "bg-active")}>
      <button
        type="button"
        onClick={() => onJump(frame.index + 1)}
        aria-current={place === "current" ? "step" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 px-4 text-left text-xs focus-bar",
          place !== "current" && "hover:bg-hover",
          place === "ahead" ? "text-text-low" : "text-text-high",
        )}
      >
        <StepIcon
          frame={frame}
          className={cn(
            "icon-sm shrink-0",
            place === "ahead"
              ? "text-text-low"
              : failed
                ? "text-danger-ink"
                : "text-text-mid",
          )}
        />
        <span
          className="min-w-0 flex-1 truncate"
          title={
            step.kind === "external"
              ? "Made by a shell command, not an edit tool"
              : undefined
          }
        >
          {rowLabel(frame)}
        </span>
        {note ? (
          <span
            aria-label={NOTE[note.level].label}
            className={cn("size-1.5 shrink-0 rounded-full", NOTE[note.level].dot)}
          />
        ) : null}
        {change && (change.added || change.removed) ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums">
            {change.added ? (
              <span className={place === "ahead" ? undefined : "text-success-ink"}>
                +{change.added}
              </span>
            ) : null}
            {change.added && change.removed ? " " : null}
            {change.removed ? (
              <span className={place === "ahead" ? undefined : "text-danger-ink"}>
                −{change.removed}
              </span>
            ) : null}
          </span>
        ) : failed ? (
          <span className="shrink-0 text-2xs text-danger-ink">failed</span>
        ) : null}
      </button>
      {place === "current" ? (
        <Detail frame={frame} replay={replay} onJump={onJump} />
      ) : null}
    </li>
  );
});

/** Long text, folded to a few lines until asked for. */
function Fold({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 420 || text.split("\n").length > 8;
  return (
    <div className="flex flex-col gap-1">
      <p
        className={cn(
          "whitespace-pre-wrap",
          !open && long && "line-clamp-6",
          className,
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="self-start rounded-control text-2xs text-text-low focus-bar hover:text-text-mid"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

function Detail({
  frame,
  replay,
  onJump,
}: {
  frame: Frame;
  replay: Replay;
  onJump: (cursor: number) => void;
}) {
  const { step, change } = frame;
  const note = replay.notes[step.id];
  const cause =
    step.kind === "external" && step.cause
      ? replay.steps.findIndex((candidate) => candidate.id === step.cause)
      : -1;
  const causeStep = cause >= 0 ? replay.steps[cause] : undefined;
  return (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-4 pl-10 text-sm">
      <p className="text-2xs text-text-low">
        <span className="font-mono">{when(step.at, replay)}</span>
        {step.agent !== "main" ? " · subagent" : ""}
        {change && !change.applied ? " · could not be applied" : ""}
      </p>
      {note ? (
        <div className={cn("border-l-2 pl-3", NOTE[note.level].rule)}>
          <p className={cn("mb-0.5 text-2xs font-medium", NOTE[note.level].ink)}>
            {NOTE[note.level].label}
          </p>
          <Fold text={note.text} className="text-text-high" />
        </div>
      ) : null}
      <Body step={step} />
      {step.why ? <Fold text={step.why} className="text-text-mid" /> : null}
      {causeStep && causeStep.kind === "command" ? (
        <button
          type="button"
          onClick={() => onJump(cause + 1)}
          className="self-start rounded-control text-left font-mono text-2xs text-text-low focus-bar hover:text-text-high"
        >
          Probably $ {firstLine(causeStep.command, 48)}
        </button>
      ) : null}
    </div>
  );
}

function Body({ step }: { step: Step }) {
  switch (step.kind) {
    case "prompt":
    case "say":
      return <Fold text={step.text} className="text-text-high" />;
    case "lesson":
      return step.goal ? <p className="text-text-mid">{step.goal}</p> : null;
    case "explain":
      return <Markdown text={step.text} />;
    case "external":
      return (
        <p className="text-text-mid">
          {step.reason === "drift"
            ? "Made by a shell command rather than an edit tool — seen when the next tool read the file."
            : "Made by a shell command rather than an edit tool — found by comparing with the end state."}
        </p>
      );
    case "commit":
      return (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-2xs text-text-low">
            {step.sha.slice(0, 7)}
            {step.author ? ` · ${step.author}` : ""}
          </p>
          {step.body ? <Fold text={step.body} className="text-text-mid" /> : null}
        </div>
      );
    case "command":
      return (
        <div className="flex flex-col gap-1.5">
          {step.description ? (
            <p className="text-text-mid">{step.description}</p>
          ) : null}
          <pre className="overflow-x-auto rounded-control bg-surface-low p-2 font-mono text-2xs whitespace-pre-wrap text-text-high">
            $ {step.command}
          </pre>
          {step.output ? (
            <pre
              className={cn(
                "max-h-60 overflow-auto rounded-control bg-surface-low p-2 font-mono text-2xs whitespace-pre-wrap",
                step.failed ? "text-danger-ink" : "text-text-mid",
              )}
            >
              {step.output}
            </pre>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}

/** Which steps the list and the timeline show. */
export type Filter = "all" | "changes" | "notes";

export interface StepListProps {
  replay: Replay;
  frames: readonly Frame[];
  /** The steps shown, as frame indices — the scrubber's. */
  visible: readonly number[];
  /** Steps applied; the current step is `cursor - 1`. */
  cursor: number;
  onJump: (cursor: number) => void;
  /** The filter, offered above the list; absent for a course, which shows everything. */
  filter?: Filter;
  onFilter?: (filter: Filter) => void;
  /** Steps with a note, for the filter's count. */
  notes?: number;
}

interface Group {
  prompt?: Frame;
  rows: Frame[];
  /** Files the group's changes touch. */
  files: number;
}

/** A turn this long shows the steps around the one on screen, and more on request. */
const WINDOW = 120;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The session as a list, a turn at a time: the turn on screen is open and
 * every other one is a line saying what it asked and how much it changed,
 * so even a session of thousands of steps reads as its few dozen prompts.
 * What is done reads full, what is ahead quiet; click anything to go there.
 */
export const StepList = React.memo(function StepList({
  replay,
  frames,
  visible,
  cursor,
  onJump,
  filter,
  onFilter,
  notes = 0,
}: StepListProps) {
  // Group the visible steps under the prompt they answer.
  const groups = React.useMemo(() => {
    const out: Group[] = [];
    const shown = new Set(visible);
    let group: Group = { rows: [], files: 0 };
    const close = () => {
      if (!group.prompt && !group.rows.length) return;
      group.files = new Set(
        group.rows.flatMap((f) => (f.change ? [f.change.path] : [])),
      ).size;
      out.push(group);
    };
    for (const frame of frames) {
      // A prompt heads what answered it; in a course, a lesson heads its steps.
      if (
        (frame.step.kind === "prompt" && frame.step.agent === "main") ||
        frame.step.kind === "lesson"
      ) {
        close();
        group = { prompt: frame, rows: [], files: 0 };
        continue;
      }
      if (shown.has(frame.index)) group.rows.push(frame);
    }
    close();
    return out;
  }, [frames, visible]);

  // The step on screen — or, when the filter hides it, the last shown before it.
  const current = React.useMemo(
    () => visible.filter((index) => index < cursor).at(-1) ?? -1,
    [visible, cursor],
  );
  // The turn on screen: the last whose prompt is at or before the cursor.
  const currentGroup = React.useMemo(() => {
    let at = -1;
    groups.forEach((group, i) => {
      const first = group.prompt?.index ?? group.rows[0]?.index ?? Infinity;
      if (first < cursor) at = i;
    });
    return at;
  }, [groups, cursor]);
  const [opened, setOpened] = React.useState<ReadonlySet<number>>(new Set());
  // How many more steps of a long turn the reader asked to see, for this turn.
  const [shownMore, setMore] = React.useState({
    group: currentGroup,
    before: 0,
    after: 0,
  });
  const more =
    shownMore.group === currentGroup
      ? shownMore
      : { group: currentGroup, before: 0, after: 0 };

  const currentRef = React.useRef<HTMLLIElement>(null);
  const headRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    (currentRef.current ?? headRef.current)?.scrollIntoView({ block: "nearest" });
  }, [current, currentGroup]);

  const place = (index: number): Place =>
    index === current ? "current" : index < current ? "done" : "ahead";
  const toggle = (g: number) =>
    setOpened((open) => {
      const next = new Set(open);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  const unit = filter === "changes" ? "change" : "step";
  let lessons = 0;

  return (
    <div className="flex flex-col pb-6">
      {filter && onFilter ? (
        <div className="sticky top-0 z-raised flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-low px-2">
          <Choice<Filter>
            label="Steps shown"
            value={filter}
            onChange={onFilter}
            options={[
              {
                value: "changes",
                label: "Changes",
                hint: "File changes, under the prompts they answer",
              },
              {
                value: "all",
                label: "Everything",
                hint: "Every step: commands, replies, changes",
              },
              ...(notes
                ? [
                    {
                      value: "notes" as const,
                      label: (
                        <>
                          Notes{" "}
                          <span className="font-normal tabular-nums">{notes}</span>
                        </>
                      ),
                      hint: "Only the steps with a reviewer's note",
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onJump(0)}
        className={cn(
          "flex h-8 items-center gap-2.5 px-4 text-left text-xs focus-bar",
          cursor === 0 ? "bg-active text-text-high" : "text-text-low hover:bg-hover",
        )}
      >
        <GitCommitHorizontal aria-hidden className="icon-sm shrink-0" />
        <span className="truncate">
          {replay.source === "course" ? "Empty repository" : "Base commit"}
          {replay.repo.base ? (
            <span className="font-mono"> {replay.repo.base.slice(0, 7)}</span>
          ) : null}
        </span>
      </button>
      {groups.map((group, g) => {
        const isLesson = group.prompt?.step.kind === "lesson";
        if (isLesson) lessons++;
        const here = g === currentGroup;
        const open = here || opened.has(g);
        const reached = (group.prompt?.index ?? group.rows[0]?.index ?? 0) < cursor;
        let rows = group.rows;
        let hiddenBefore = 0;
        let hiddenAfter = 0;
        if (open && rows.length > WINDOW * 2) {
          const at = Math.max(
            0,
            rows.findIndex((f) => f.index >= current),
          );
          const from = Math.max(0, at - WINDOW / 2 - more.before);
          const to = Math.min(rows.length, at + WINDOW / 2 + more.after);
          hiddenBefore = from;
          hiddenAfter = rows.length - to;
          rows = rows.slice(from, to);
        }
        return (
          <section
            key={group.prompt?.index ?? `g${g}`}
            // A closed turn is one line: off screen, the browser skips it.
            className={cn(
              "flex flex-col",
              !open &&
                "[contain-intrinsic-size:auto_3.25rem] [content-visibility:auto]",
            )}
          >
            {group.prompt &&
            (group.prompt.step.kind === "prompt" ||
              group.prompt.step.kind === "lesson") ? (
              <div
                className={cn(
                  "flex border-b border-line bg-surface-base",
                  open && "sticky top-0 z-raised",
                  open && filter && onFilter && "top-9",
                  group.prompt.index === current && "bg-active",
                )}
              >
                <button
                  ref={here ? headRef : undefined}
                  type="button"
                  onClick={() => onJump(group.prompt!.index + 1)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pl-4 text-left focus-bar"
                >
                  <span className="text-2xs text-text-low">
                    {group.prompt.step.kind === "lesson"
                      ? `Lesson ${lessons}`
                      : `Prompt · ${when(group.prompt.step.at, replay)}`}
                    {!open && group.rows.length
                      ? ` · ${plural(group.rows.length, unit)}${group.files ? ` · ${plural(group.files, "file")}` : ""}`
                      : ""}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      open ? "line-clamp-3" : "line-clamp-1",
                      isLesson && "font-medium",
                      reached ? "text-text-high" : "text-text-low",
                    )}
                  >
                    {group.prompt.step.kind === "lesson"
                      ? group.prompt.step.title
                      : firstLine(group.prompt.step.text, 240)}
                  </span>
                </button>
                {!here && group.rows.length ? (
                  <button
                    type="button"
                    onClick={() => toggle(g)}
                    aria-expanded={open}
                    aria-label={
                      open ? "Hide this turn's steps" : "Show this turn's steps"
                    }
                    className="flex w-8 shrink-0 items-center justify-center text-text-low focus-bar hover:text-text-high"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform duration-fast",
                        open && "rotate-90",
                      )}
                    />
                  </button>
                ) : null}
              </div>
            ) : null}
            {group.prompt && group.prompt.index === current ? (
              <ul>
                <Row
                  frame={group.prompt}
                  replay={replay}
                  place="current"
                  onJump={onJump}
                  rowRef={currentRef}
                />
              </ul>
            ) : null}
            {open && group.rows.length ? (
              <ul className="flex flex-col py-1">
                {hiddenBefore ? (
                  <li>
                    <More
                      onClick={() => setMore({ ...more, before: more.before + WINDOW })}
                    >
                      {plural(hiddenBefore, `earlier ${unit}`)}
                    </More>
                  </li>
                ) : null}
                {rows.map((frame) => (
                  <Row
                    key={frame.index}
                    frame={frame}
                    replay={replay}
                    place={place(frame.index)}
                    onJump={onJump}
                    rowRef={frame.index === current ? currentRef : undefined}
                  />
                ))}
                {hiddenAfter ? (
                  <li>
                    <More
                      onClick={() => setMore({ ...more, after: more.after + WINDOW })}
                    >
                      {plural(hiddenAfter, `later ${unit}`)}
                    </More>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
});

function More({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center px-4 pl-10 text-left text-2xs text-text-low focus-bar hover:bg-hover hover:text-text-mid"
    >
      Show {children}
    </button>
  );
}
