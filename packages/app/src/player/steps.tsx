import type { Frame, NoteLevel, Replay, Step } from "@agent-replay/core";
import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tree,
} from "@/ui";
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

import { firstLine, predates, stepLabel, when } from "../labels";
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
  rowRef?: React.Ref<HTMLElement>;
}) {
  const { step, change } = frame;
  const note = replay.notes[step.id];
  const failed = step.kind === "command" && step.failed;
  return (
    <li
      ref={rowRef as React.Ref<HTMLLIElement>}
      className={cn("mx-1.5 rounded-control", place === "current" && "bg-active")}
    >
      <button
        type="button"
        onClick={() => onJump(frame.index + 1)}
        aria-current={place === "current" ? "step" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-body focus-bar transition-colors duration-fast",
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
    <div className="flex animate-rise flex-col gap-3 px-2.5 pt-1 pb-4 pl-9 text-sm">
      <p className="text-2xs text-text-low">
        <span className="font-mono">{when(step.at, replay)}</span>
        {step.agent !== "main" ? " · subagent" : ""}
        {change && !change.applied ? " · could not be applied" : ""}
      </p>
      {note ? <NoteBlock note={note} /> : null}
      <Body step={step} replay={replay} />
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

function NoteBlock({ note }: { note: Replay["notes"][string] }) {
  return (
    <div className={cn("border-l-2 pl-3", NOTE[note.level].rule)}>
      <p className={cn("mb-0.5 text-2xs font-medium", NOTE[note.level].ink)}>
        {NOTE[note.level].label}
      </p>
      <Fold text={note.text} className="text-text-high" />
    </div>
  );
}

/**
 * The prompt (or lesson) on screen, read in full under its heading in the
 * list — said once there, not again in a row beneath.
 */
function PromptDetail({ frame, replay }: { frame: Frame; replay: Replay }) {
  const { step } = frame;
  const note = replay.notes[step.id];
  return (
    <div className="flex animate-rise flex-col gap-3 text-sm">
      {step.kind === "lesson" ? (
        <p className="font-medium text-text-high">{step.title}</p>
      ) : null}
      {note ? <NoteBlock note={note} /> : null}
      <Body step={step} replay={replay} />
    </div>
  );
}

function Body({ step, replay }: { step: Step; replay: Replay }) {
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
            : predates(step, replay)
              ? "Already changed when the session began — written before it, outside its tools."
              : "Made outside the session’s tools — a command, an editor or another agent — found by comparing with the end state."}
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
          <pre className="overflow-x-auto rounded-control bg-surface-inset p-2 font-mono text-2xs whitespace-pre-wrap text-text-high">
            $ {step.command}
          </pre>
          {step.output ? (
            <pre
              className={cn(
                "max-h-60 overflow-auto rounded-control bg-surface-inset p-2 font-mono text-2xs whitespace-pre-wrap",
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
  /** The steps shown (chosen in the panel's bar); absent for a course, which shows everything. */
  filter?: Filter;
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
/** The visible steps under the prompt (or, in a course, the lesson) they answer. */
function groupsOf(frames: readonly Frame[], visible: readonly number[]): Group[] {
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
}

const GroupedStepList = React.memo(function GroupedStepList({
  replay,
  visible,
  cursor,
  onJump,
  filter,
  groups,
}: StepListProps & { groups: readonly Group[] }) {
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

  const currentRef = React.useRef<HTMLElement>(null);
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
      <button
        type="button"
        onClick={() => onJump(0)}
        className={cn(
          "mx-1.5 flex h-8 items-center gap-2.5 rounded-control px-2.5 text-left text-body focus-bar",
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
        // Steps before the first prompt have no header to open them by.
        const open = here || opened.has(g) || !group.prompt;
        const reached = (group.prompt?.index ?? group.rows[0]?.index ?? 0) < cursor;
        const isCurrent = group.prompt !== undefined && group.prompt.index === current;
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
                  "flex flex-col",
                  isCurrent
                    ? "mx-1.5 rounded-control bg-active"
                    : "bg-surface-panel px-1.5",
                  // The open turn's question stays in view above its steps;
                  // on screen itself it reads in full, so it scrolls.
                  open && !isCurrent && "sticky top-0 z-raised",
                )}
              >
                <div className="flex">
                  <button
                    ref={here ? headRef : undefined}
                    type="button"
                    onClick={() => onJump(group.prompt!.index + 1)}
                    aria-current={isCurrent ? "step" : undefined}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control py-2 pl-2.5 text-left focus-bar"
                  >
                    <span className="text-2xs text-text-low">
                      {group.prompt.step.kind === "lesson"
                        ? `Lesson ${lessons}`
                        : `Prompt · ${when(group.prompt.step.at, replay)}`}
                      {!open && group.rows.length
                        ? ` · ${plural(group.rows.length, unit)}${group.files ? ` · ${plural(group.files, "file")}` : ""}`
                        : ""}
                    </span>
                    {isCurrent ? null : (
                      <span
                        className={cn(
                          "text-body",
                          open ? "line-clamp-3" : "line-clamp-1",
                          isLesson && "font-medium",
                          reached ? "text-text-high" : "text-text-low",
                        )}
                      >
                        {group.prompt.step.kind === "lesson"
                          ? group.prompt.step.title
                          : firstLine(group.prompt.step.text, 240)}
                      </span>
                    )}
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
                {isCurrent ? (
                  <div
                    ref={currentRef as React.Ref<HTMLDivElement>}
                    className="px-2.5 pb-3"
                  >
                    <PromptDetail frame={group.prompt} replay={replay} />
                  </div>
                ) : null}
              </div>
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

/**
 * What the list and the timeline show — changes, everything, or the noted
 * steps — as one quiet choice in the panel's bar rather than a bar of its own.
 */
export function StepFilter({
  filter,
  onFilter,
  notes,
  className,
}: {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  notes: number;
  className?: string;
}) {
  return (
    <Select value={filter} onValueChange={(value) => onFilter(value as Filter)}>
      <SelectTrigger
        size="sm"
        variant="ghost"
        aria-label="Steps shown"
        className={cn("shrink-0", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="changes" title="File changes, under the prompts they answer">
          Changes
        </SelectItem>
        <SelectItem value="all" title="Every step: commands, replies, changes">
          Everything
        </SelectItem>
        {notes ? (
          <SelectItem value="notes" title="Only the steps with a reviewer’s note">
            Notes · {notes}
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

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
      className="flex h-8 w-full items-center rounded-control px-2.5 pl-9 text-left text-2xs text-text-low focus-bar hover:bg-hover hover:text-text-mid"
    >
      Show {children}
    </button>
  );
}

/**
 * The list by turns, while that stays small: a few hundred turns at most.
 * A history with no turns to fold into (git commits, a log of thousands of
 * replies) or with more turns than that is one windowed list instead, the
 * same keyboard-accessible kind as the file tree.
 */
export const StepList = React.memo(function StepList(props: StepListProps) {
  const groups = React.useMemo(
    () => groupsOf(props.frames, props.visible),
    [props.frames, props.visible],
  );
  const flat =
    props.visible.length > 300 &&
    (groups.length > 200 || groups.every((group) => !group.prompt));
  return flat ? (
    <VirtualSteps {...props} />
  ) : (
    <GroupedStepList {...props} groups={groups} />
  );
});

function VirtualSteps({ replay, frames, visible, cursor, onJump }: StepListProps) {
  const lines = React.useMemo(
    () =>
      visible.map((index) => ({
        id: String(index),
        parentId: null,
        label: `${index + 1}. ${rowLabel(frames[index]!)}`,
      })),
    [visible, frames],
  );
  const index = cursor - 1;
  const current = frames[index];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        className={cn(
          "mx-1.5 flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-left text-body focus-bar",
          cursor === 0 ? "bg-active text-text-high" : "text-text-low hover:bg-hover",
        )}
        onClick={() => onJump(0)}
      >
        <GitCommitHorizontal aria-hidden className="icon-sm shrink-0" />
        {replay.source === "course" ? "Empty repository" : "Base commit"}
      </button>
      <Tree
        lines={lines}
        expanded="all"
        onToggle={() => {}}
        selected={String(index)}
        onSelect={(id) => onJump(Number(id) + 1)}
        reveal={{ id: String(index), token: cursor }}
        label="Session steps"
        rowHeight={32}
        className="min-h-0 flex-1"
        icon={(row) => <StepIcon frame={frames[Number(row.id)]!} className="icon-sm" />}
      />
      {current && (
        <div className="max-h-[40%] shrink-0 overflow-auto bg-surface-inset p-3">
          <Detail frame={current} replay={replay} onJump={onJump} />
        </div>
      )}
    </div>
  );
}
