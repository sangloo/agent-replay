import type { Frame, NoteLevel, Replay, Step } from "@agent-replay/core";
import { cn } from "@/ui";
import {
  FileMinus,
  FilePen,
  FilePlus,
  FileWarning,
  GitCommitHorizontal,
  MessageSquare,
  Terminal,
} from "lucide-react";
import * as React from "react";

import { firstLine, stepLabel, when } from "../labels";

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
      return <FileWarning aria-hidden className={className} />;
    case "command":
      return <Terminal aria-hidden className={className} />;
    case "commit":
      return <GitCommitHorizontal aria-hidden className={className} />;
    default:
      return <MessageSquare aria-hidden className={className} />;
  }
}

/** A row's words: the step's label, without what its icon already says. */
function rowLabel(frame: Frame): string {
  return stepLabel(frame).replace(/ · outside the tools$/, "");
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
              : step.kind === "external"
                ? "text-warning-ink"
                : failed
                  ? "text-danger-ink"
                  : "text-text-mid",
          )}
        />
        <span
          className="min-w-0 flex-1 truncate"
          title={
            step.kind === "external"
              ? "Changed outside the agent's edit tools"
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
        Step {frame.index + 1} of {replay.steps.length} ·{" "}
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
    case "external":
      return (
        <p className="text-text-mid">
          {step.reason === "drift"
            ? "Changed outside the agent's edit tools, found by the next tool that read the file."
            : "Changed outside the agent's edit tools, found by comparing with the end state."}
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

export interface StepListProps {
  replay: Replay;
  frames: readonly Frame[];
  /** The steps shown, as frame indices — the scrubber's. */
  visible: readonly number[];
  /** Steps applied; the current step is `cursor - 1`. */
  cursor: number;
  onJump: (cursor: number) => void;
}

/**
 * The session as a list: each prompt heads the steps that answered it, the
 * step on screen is open, what is done reads full and what is ahead reads
 * quiet. Click any step to go there.
 */
export const StepList = React.memo(function StepList({
  replay,
  frames,
  visible,
  cursor,
  onJump,
}: StepListProps) {
  // Group the visible steps under the prompt they answer.
  const groups = React.useMemo(() => {
    const out: { prompt?: Frame; rows: Frame[] }[] = [];
    const shown = new Set(visible);
    let group: { prompt?: Frame; rows: Frame[] } = { rows: [] };
    for (const frame of frames) {
      if (frame.step.kind === "prompt" && frame.step.agent === "main") {
        if (group.prompt || group.rows.length) out.push(group);
        group = { prompt: frame, rows: [] };
        continue;
      }
      if (shown.has(frame.index)) group.rows.push(frame);
    }
    if (group.prompt || group.rows.length) out.push(group);
    return out;
  }, [frames, visible]);

  // The step on screen — or, when the filter hides it, the last shown before it.
  const current = React.useMemo(
    () => visible.filter((index) => index < cursor).at(-1) ?? -1,
    [visible, cursor],
  );
  const currentRef = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);
  // Opened mid-session (a link to a step), the list starts there.
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const place = (index: number): Place =>
    index === current ? "current" : index < current ? "done" : "ahead";

  return (
    <div className="flex flex-col pb-6">
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
          Base commit
          {replay.repo.base ? (
            <span className="font-mono"> {replay.repo.base.slice(0, 7)}</span>
          ) : null}
        </span>
      </button>
      {groups.map((group, g) => (
        <section key={group.prompt?.index ?? `g${g}`} className="flex flex-col">
          {group.prompt && group.prompt.step.kind === "prompt" ? (
            <button
              type="button"
              onClick={() => onJump(group.prompt!.index + 1)}
              className={cn(
                "sticky top-0 z-raised flex flex-col gap-0.5 border-y border-line bg-surface-base px-4 py-2 text-left focus-bar",
                group.prompt.index === current && "bg-active",
              )}
            >
              <span className="text-2xs text-text-low">
                Prompt · {when(group.prompt.step.at, replay)}
              </span>
              <span
                className={cn(
                  "line-clamp-2 text-xs",
                  group.prompt.index <= current ? "text-text-high" : "text-text-low",
                )}
              >
                {firstLine(group.prompt.step.text, 200)}
              </span>
            </button>
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
          <ul className="flex flex-col py-1">
            {group.rows.map((frame) => (
              <Row
                key={frame.index}
                frame={frame}
                replay={replay}
                place={place(frame.index)}
                onJump={onJump}
                rowRef={frame.index === current ? currentRef : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});
