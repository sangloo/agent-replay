import type { Frame, Replay } from "@agent-replay/core";
import { CircleCheck, CircleX, Play } from "lucide-react";
import * as React from "react";

import { cn, Kbd } from "@/ui";

import { firstLine, stepLabel, when } from "../labels";
import { plainText } from "./markdown-parse";
import { StepIcon } from "./steps";

export interface CaptionProps {
  replay: Replay;
  /** The step just applied; undefined at the base commit. */
  frame?: Frame;
  /** Steps applied — for "step 12 of 340". */
  cursor: number;
  onJump: (cursor: number) => void;
}

/**
 * What is happening now, in words, above the code: the prompt being
 * answered, the command being run, why a change is being made. Playback is
 * never silent — a step that changes no line still says what it is.
 */
export const Caption = React.memo(function Caption({
  replay,
  frame,
  cursor,
  onJump,
}: CaptionProps) {
  if (!frame) {
    return (
      <Shell>
        <Meta>
          <Play aria-hidden className="size-3.5 text-emphasis" />
          <span className="font-medium text-text-mid">Start</span>
          {replay.repo.base ? (
            <span className="font-mono">at {replay.repo.base.slice(0, 7)}</span>
          ) : null}
        </Meta>
        <Text className="text-text-mid">
          Nothing has happened yet. Press <Kbd>Space</Kbd> to play the session, or{" "}
          <Kbd>→</Kbd> to take it one step at a time.
        </Text>
      </Shell>
    );
  }

  const { step } = frame;
  const meta = (
    <>
      <span className="tabular-nums">
        {cursor} / {replay.steps.length}
      </span>
      <span aria-hidden>·</span>
      <span className="font-mono">{when(step.at, replay)}</span>
      {step.agent !== "main" ? (
        <>
          <span aria-hidden>·</span>
          <span>subagent</span>
        </>
      ) : null}
    </>
  );

  let title: React.ReactNode = stepLabel(frame);
  let body: React.ReactNode;
  switch (step.kind) {
    case "prompt":
      title = step.agent === "main" ? "You asked" : "Task for a subagent";
      body = <Text>{step.text}</Text>;
      break;
    case "say":
      title = "The agent said";
      body = <Text className="text-text-mid">{step.text}</Text>;
      break;
    case "command":
      title = step.failed ? (
        <span className="flex items-center gap-1 text-danger-ink">
          <CircleX aria-hidden className="size-3.5" /> Command failed
        </span>
      ) : (
        "Ran a command"
      );
      body = (
        <p className="line-clamp-2 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-text-high">
          <span className="text-text-low select-none">$ </span>
          {step.description ? (
            <>
              {firstLine(step.command, 160)}
              <span className="ml-2 font-sans text-text-low">— {step.description}</span>
            </>
          ) : (
            firstLine(step.command, 200)
          )}
        </p>
      );
      break;
    case "commit":
      title = `Commit ${step.sha.slice(0, 7)}`;
      body = <Text>{step.subject}</Text>;
      break;
    case "lesson": {
      const number = replay.steps
        .slice(0, frame.index + 1)
        .filter((candidate) => candidate.kind === "lesson").length;
      title = `Lesson ${number} · ${step.title}`;
      body = step.goal ? <Text className="text-text-mid">{step.goal}</Text> : null;
      break;
    }
    case "explain":
      title = step.path
        ? `About ${step.path}${step.lines ? `, lines ${step.lines[0]}–${step.lines[1]}` : ""}`
        : "Explanation";
      body = <Text className="text-text-mid">{plainText(step.text)}</Text>;
      break;
    case "external": {
      const cause = step.cause
        ? replay.steps.findIndex((candidate) => candidate.id === step.cause)
        : -1;
      const by = cause >= 0 ? replay.steps[cause] : undefined;
      title = (
        <>
          {stepLabel(frame)}
          <span className="font-normal text-text-low"> · by a shell command</span>
        </>
      );
      body = (
        <Text className="text-text-mid">
          {by?.kind === "command" ? (
            <>
              {"Most likely "}
              <button
                type="button"
                onClick={() => onJump(cause + 1)}
                className="rounded-control font-mono text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
              >
                $ {firstLine(by.command, 70)}
              </button>
              {" — an edit no tool call recorded, shown where it happened."}
            </>
          ) : (
            "An edit no tool call recorded — a formatter, a script or a person — shown where it was first seen."
          )}
        </Text>
      );
      break;
    }
    default: {
      const via =
        "via" in step && step.via
          ? replay.steps.findIndex((candidate) => candidate.id === step.via)
          : -1;
      const by = via >= 0 ? replay.steps[via] : undefined;
      body = step.why ? (
        <Text className="text-text-mid">{step.why}</Text>
      ) : by?.kind === "command" ? (
        <Text className="text-text-mid">
          Written by <span className="font-mono">$ {firstLine(by.command, 80)}</span>
        </Text>
      ) : null;
    }
  }

  const check =
    step.kind === "command" &&
    !step.failed &&
    /\b(pass|passed|ok)\b/i.test(step.output ?? "");

  return (
    <Shell>
      <Meta>
        <StepIcon
          frame={frame}
          className={cn(
            "size-3.5 shrink-0",
            step.kind === "command" && step.failed
              ? "text-danger-ink"
              : "text-text-mid",
          )}
        />
        <span className="font-medium text-text-high">{title}</span>
        {check ? (
          <CircleCheck aria-label="passed" className="size-3.5 text-success-ink" />
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">{meta}</span>
      </Meta>
      {body}
    </Shell>
  );
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="flex h-[4.75rem] shrink-0 flex-col gap-1 overflow-hidden border-b border-line bg-surface-low px-5 py-2.5"
    >
      {children}
    </div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-low">
      {children}
    </div>
  );
}

function Text({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "line-clamp-2 max-w-[80ch] text-[13px] leading-5 text-text-high",
        className,
      )}
    >
      {children}
    </p>
  );
}
