import {
  curriculumLessons,
  studyHref,
  type Frame,
  type Replay,
  type StudyContext,
} from "@agent-replay/core";
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleCheck,
  FilePlus2,
  FlaskConical,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/ui";

import { fileName } from "../labels";
import { DeferredDetails } from "./deferred-details";
import { lessonsOf, type Lesson } from "./lessons";
import { Markdown } from "./markdown";

export interface LessonPanelProps {
  replay: Replay;
  frames: readonly Frame[];
  /** Steps applied; the current step is `cursor - 1`. */
  cursor: number;
  /** The furthest step the reader has reached, ever: what marks a lesson read. */
  furthest?: number;
  onJump: (cursor: number) => void;
  onInspect?: (cursor: number) => void;
  /** Its place in a curriculum, for the way on once it is finished. */
  study?: StudyContext;
}

/** What a code step did, in words a learner reads between explanations. */
function codeLabel(frame: Frame): string | undefined {
  const { step, change } = frame;
  if (!change) return undefined;
  if ((step.kind === "write" || step.kind === "edit") && step.sourceMode === "included")
    return `Included for completeness · ${step.path}`;
  if ((step.kind === "write" || step.kind === "edit") && step.aside) {
    return `Example · ${step.path}`;
  }
  const lines = change.added;
  if (change.before === null)
    return `${fileName(change.path)} begins — ${lines} line${lines === 1 ? "" : "s"}`;
  return `${fileName(change.path)} grows — +${lines}${change.removed ? ` −${change.removed}` : ""}`;
}

/**
 * The lesson as a document that writes itself alongside the code: its
 * title and goal, then every explanation so far in full, with the code
 * steps between them as quiet markers. What is ahead is not shown — it
 * arrives as the course plays.
 */
export const LessonPanel = React.memo(function LessonPanel({
  replay,
  frames,
  cursor,
  furthest = cursor,
  onJump,
  onInspect = onJump,
  study,
}: LessonPanelProps) {
  const lessons = React.useMemo(() => lessonsOf(frames), [frames]);
  // A lesson is read once the reader has been past its last step.
  const read = (lesson: Lesson) => {
    const last = lesson.frames.at(-1)?.index ?? lesson.frame?.index ?? 0;
    return furthest >= last + 1;
  };
  const finished = frames.length > 0 && cursor >= frames.length;
  const currentIndex = cursor - 1;
  const at = Math.max(
    0,
    lessons.findLastIndex(
      (lesson) => (lesson.frame?.index ?? lesson.frames[0]?.index ?? 0) <= currentIndex,
    ),
  );
  const lesson = lessons[at];
  const counted = lessons.filter((item) => item.frame).length;
  const readCount = lessons.filter((item) => item.frame && read(item)).length;
  const [contents, setContents] = React.useState(false);

  const latest = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    latest.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [cursor]);

  if (!lesson) {
    return <p className="p-5 text-sm text-text-low">This course has no lessons yet.</p>;
  }
  const shown = lesson.frames.filter((frame) => frame.index <= currentIndex);
  const started = lesson.frame ? lesson.frame.index <= currentIndex : shown.length > 0;
  const explanations = frames.filter(
    (f) =>
      f.step.kind === "explain" &&
      !(
        frames[f.index - 1]?.step &&
        "sourceMode" in frames[f.index - 1]!.step &&
        (frames[f.index - 1]!.step as { sourceMode?: string }).sourceMode === "included"
      ),
  );
  const previous = explanations.filter((f) => f.index < currentIndex).at(-1);
  const next = explanations.find((f) => f.index > currentIndex);
  const title = lesson.frame?.step.kind === "lesson" ? lesson.frame.step : undefined;

  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setContents(!contents)}
          aria-expanded={contents}
          className="flex w-full items-center gap-1.5 rounded-control text-left text-xs text-text-low focus-bar hover:text-text-mid"
        >
          <BookOpen aria-hidden className="size-3.5" />
          {lesson.number
            ? `Lesson ${lesson.number} of ${counted}`
            : `Introduction · ${counted} lessons`}
          {counted ? (
            <span className="ml-1 text-text-low tabular-nums">· {readCount} read</span>
          ) : null}
          <ChevronRight
            aria-hidden
            className={cn(
              "ml-auto size-3.5 transition-transform duration-fast",
              contents && "rotate-90",
            )}
          />
        </button>
        {contents ? (
          <ol className="mt-2 flex flex-col">
            {lessons.map((item, i) => {
              const step = item.frame?.step;
              const first = item.frame?.index ?? item.frames[0]?.index ?? 0;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(first + 1);
                      setContents(false);
                    }}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left text-[13px] focus-bar hover:bg-hover",
                      i === at ? "font-medium text-text-high" : "text-text-mid",
                    )}
                  >
                    <span className="w-5 shrink-0 text-right text-xs text-text-low tabular-nums">
                      {item.number || ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      {step?.kind === "lesson" ? step.title : "Introduction"}
                    </span>
                    {item.frame && read(item) ? (
                      <Check
                        aria-label="Read"
                        className="size-3.5 shrink-0 self-center text-success-ink"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      <nav
        aria-label="Explanation navigation"
        className="flex justify-between gap-3 border-b border-line px-5 py-2 text-xs text-text-mid"
      >
        <button
          type="button"
          disabled={!previous}
          onClick={() => previous && onJump(previous.index + 1)}
          className="rounded-control focus-bar disabled:opacity-40"
        >
          ← Previous explanation
        </button>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && onJump(next.index + 1)}
          className="rounded-control focus-bar disabled:opacity-40"
        >
          Next explanation →
        </button>
      </nav>
      <article className="flex flex-col gap-4 px-5 pt-4 pb-10">
        <header className="flex flex-col gap-1">
          <h2
            className={cn(
              "text-lg leading-snug font-semibold",
              started ? "text-text-high" : "text-text-low",
            )}
          >
            {title?.title ?? replay.title}
          </h2>
          {title?.goal ? <p className="text-sm text-text-mid">{title.goal}</p> : null}
        </header>

        {shown.length === 0 ? (
          <p className="text-sm text-text-low">
            {started
              ? "The lesson begins with the next step."
              : "Press Space to begin."}
          </p>
        ) : null}

        {shown.map((frame) => {
          const isLatest = frame.index === currentIndex;
          const { step } = frame;
          const before = frames[frame.index - 1]?.step;
          if (
            step.kind === "explain" &&
            before &&
            "sourceMode" in before &&
            before.sourceMode === "included"
          )
            return null;
          if (
            (step.kind === "write" || step.kind === "edit") &&
            step.sourceMode === "included"
          ) {
            const explanation = frames[frame.index + 1];
            return (
              <DeferredDetails
                summary={<>Included for completeness · {fileName(step.path)}</>}
                summaryClassName="cursor-pointer leading-relaxed"
                key={frame.index}
                className="rounded-control border border-line p-3 text-xs text-text-mid"
              >
                <p className="my-2 font-mono text-2xs break-all">{step.path}</p>
                <button
                  type="button"
                  className="mb-3 underline focus-bar"
                  onClick={() => onInspect(frame.index + 1)}
                >
                  Inspect complete file
                </button>
                {explanation &&
                explanation.index <= currentIndex &&
                explanation.step.kind === "explain" ? (
                  <Markdown text={explanation.step.text} />
                ) : (
                  <p>
                    Exact reference source. Only explicitly highlighted ranges count as
                    explained.
                  </p>
                )}
              </DeferredDetails>
            );
          }
          if (step.kind === "explain") {
            return (
              <div
                key={frame.index}
                ref={isLatest ? latest : undefined}
                className={cn(
                  "-mx-3 rounded-control border-l-2 px-3 py-1 transition-colors duration-fast",
                  isLatest
                    ? "border-emphasis bg-emphasis-subtle"
                    : "border-transparent",
                )}
              >
                {step.path ? (
                  <button
                    type="button"
                    onClick={() => onInspect(frame.index + 1)}
                    className="mb-1 rounded-control font-mono text-2xs text-text-low focus-bar hover:text-text-high"
                  >
                    {step.path}
                    {step.lines ? `:${step.lines[0]}–${step.lines[1]}` : ""}
                  </button>
                ) : null}
                <Markdown text={step.text} />
              </div>
            );
          }
          const label = codeLabel(frame);
          if (!label) return null;
          const aside = (step.kind === "write" || step.kind === "edit") && step.aside;
          const Icon = aside ? FlaskConical : FilePlus2;
          return (
            <div
              key={frame.index}
              ref={isLatest ? latest : undefined}
              className="flex flex-col gap-1"
            >
              <button
                type="button"
                onClick={() => onInspect(frame.index + 1)}
                className={cn(
                  "-mx-1.5 flex items-center gap-2 self-start rounded-control px-1.5 py-0.5 text-xs focus-bar hover:bg-hover",
                  isLatest ? "text-text-high" : "text-text-low",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn("size-3.5", aside ? "text-info-ink" : undefined)}
                />
                {label}
              </button>
              {step.why ? <Markdown text={step.why} className="text-text-mid" /> : null}
            </div>
          );
        })}

        {finished ? <Finished study={study} replay={replay} /> : null}

        {lessons[at + 1] && shown.length === lesson.frames.length ? (
          <button
            type="button"
            onClick={() => onJump((lessons[at + 1]!.frame?.index ?? 0) + 1)}
            className="mt-2 flex items-center gap-1.5 self-start rounded-control text-sm text-text-mid focus-bar hover:text-text-high"
          >
            Next:{" "}
            {lessons[at + 1]!.frame?.step.kind === "lesson"
              ? (lessons[at + 1]!.frame!.step as { title: string }).title
              : "the next lesson"}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        ) : null}
      </article>
    </div>
  );
});

/** The end of the course: said plainly, with the way on. */
function Finished({ study, replay }: { study?: StudyContext; replay: Replay }) {
  const all = study ? curriculumLessons(study.curriculum) : [];
  const index = all.findIndex((lesson) => lesson.id === study?.lessonId);
  const next = index >= 0 ? all[index + 1] : undefined;
  const href = study && next ? studyHref(study, next) : undefined;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-panel border border-success-line bg-success-subtle p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-success-ink">
        <CircleCheck aria-hidden className="size-4" />
        {study ? "Lesson complete" : `You have finished “${replay.title}”`}
      </p>
      <p className="text-xs text-text-mid">
        Your progress is saved
        {href ? "." : " — the Learn page shows where you are in every course."}
      </p>
      {href && next ? (
        <a
          href={href}
          className="flex items-center gap-1.5 self-start rounded-control text-sm font-medium text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
        >
          Next: {next.title}
          <ChevronRight aria-hidden className="size-4" />
        </a>
      ) : null}
    </div>
  );
}
