import { curriculumLessons, studyHref, type StudyContext } from "@agent-replay/core";
import { ArrowLeft, ArrowRight, Check, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/ui";

import { courseProgress } from "./study-progress";

/** The outline lives inside the reading panel, never above the code. */
export function CourseOutline({
  study,
  reviewed,
}: {
  study: StudyContext;
  reviewed: boolean;
}) {
  const all = curriculumLessons(study.curriculum);
  const lesson = all.find((l) => l.id === study.lessonId);
  const chapter = study.curriculum.chapters.find((c) =>
    c.lessons.some((l) => l.id === study.lessonId),
  );
  const activeLink = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    activeLink.current?.scrollIntoView({ block: "nearest" });
  }, [study.lessonId]);
  if (!lesson || !chapter) return null;
  const progress = courseProgress(study.curriculum.id, study.curriculum.revision);
  const libraryHref = study.key ? `#/learn/${study.key}` : study.curriculum.libraryFile;
  return (
    <section className="flex flex-col gap-3 p-4 text-sm" aria-label="Course outline">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-text-high">{study.curriculum.title}</h2>
        {libraryHref && (
          <a
            href={libraryHref}
            className="self-start rounded-control text-xs text-text-low underline decoration-line-high underline-offset-2 focus-bar hover:text-text-high"
          >
            Full course map →
          </a>
        )}
      </div>
      <nav aria-label="Lesson outline" className="flex flex-col">
        {study.curriculum.chapters.map((c, i) => (
          <details
            key={c.id}
            open={c.id === chapter.id}
            className="group border-t border-line"
          >
            <summary className="flex cursor-pointer list-none items-baseline gap-2 py-2.5 font-medium text-text-high [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 self-center text-text-low transition-transform duration-fast group-open:rotate-90"
              />
              <span className="text-2xs text-text-low tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">{c.title}</span>
              <small className="text-2xs font-normal text-text-low tabular-nums">
                {
                  c.lessons.filter((l) =>
                    l.id === lesson.id ? reviewed : progress[l.id]?.reviewed,
                  ).length
                }
                /{c.lessons.length}
              </small>
            </summary>
            <ol className="flex flex-col pb-2">
              {c.lessons.map((l) => {
                const current = l.id === lesson.id;
                const done = current ? reviewed : progress[l.id]?.reviewed;
                const href = studyHref(study, l);
                return (
                  <li key={l.id}>
                    {href ? (
                      <a
                        ref={current ? activeLink : undefined}
                        href={href}
                        aria-current={current ? "step" : undefined}
                        className={cn(
                          "flex items-baseline gap-2 rounded-control px-2 py-1.5 text-[13px] focus-bar",
                          current
                            ? "bg-emphasis-subtle text-text-high"
                            : "text-text-mid hover:bg-hover hover:text-text-high",
                        )}
                      >
                        <span className="w-6 shrink-0 text-2xs text-text-low tabular-nums">
                          {l.id}
                        </span>
                        <span className="min-w-0 flex-1">{l.title}</span>
                        {done && (
                          <Check
                            className="size-3.5 shrink-0 self-center text-success-ink"
                            aria-label="Done"
                          />
                        )}
                      </a>
                    ) : (
                      <span className="flex items-baseline gap-2 px-2 py-1.5 text-[13px] text-text-low">
                        <span className="w-6 shrink-0 text-2xs tabular-nums">
                          {l.id}
                        </span>
                        {l.title} (unavailable)
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        ))}
      </nav>
      {lesson.prerequisites.length > 0 && (
        <p className="text-xs text-text-low">
          Before this lesson:{" "}
          {lesson.prerequisites.map((id, i) => {
            const prerequisite = all.find((l) => l.id === id)!;
            return (
              <React.Fragment key={id}>
                {i ? " · " : ""}
                <a
                  href={studyHref(study, prerequisite)}
                  title={prerequisite.title}
                  className="underline underline-offset-2"
                >
                  {id}
                </a>
              </React.Fragment>
            );
          })}
        </p>
      )}
    </section>
  );
}

/**
 * Beside the playback controls: whether the lesson is done — it becomes so
 * when its end is reached, and can be set either way by hand — and, in a
 * curriculum, the lessons either side.
 */
export function LessonActions({
  study,
  done,
  onDone,
}: {
  study?: StudyContext;
  done: boolean;
  onDone: () => void;
}) {
  const all = study ? curriculumLessons(study.curriculum) : [];
  const index = all.findIndex((l) => l.id === study?.lessonId);
  const previous = index > 0 ? all[index - 1] : undefined;
  const next = index >= 0 ? all[index + 1] : undefined;
  const previousHref = study && previous ? studyHref(study, previous) : undefined;
  const nextHref = study && next ? studyHref(study, next) : undefined;
  return (
    <nav
      className="study-actions flex shrink-0 items-center gap-1"
      aria-label="Lesson controls"
    >
      <button
        className={cn(
          "study-reviewed inline-flex h-7 items-center gap-1.5 rounded-control border px-2.5 text-xs font-medium whitespace-nowrap focus-bar [&_svg]:size-3.5",
          done
            ? "border-success-line bg-success-subtle text-success-ink"
            : "border-line-control text-text-mid hover:bg-hover hover:text-text-high",
        )}
        type="button"
        aria-label={done ? "Done" : "Mark as done"}
        aria-pressed={done}
        onClick={onDone}
        title={done ? "Done — click to mark as not done" : "Mark this lesson as done"}
      >
        <Check aria-hidden />
        <span>{done ? "Done" : "Mark as done"}</span>
      </button>
      {previousHref && previous && (
        <a
          className="study-previous inline-flex size-7 items-center justify-center rounded-control text-text-mid focus-bar hover:bg-hover hover:text-text-high [&_svg]:size-4"
          href={previousHref}
          aria-label="Previous lesson"
          title={previous.title}
        >
          <ArrowLeft aria-hidden />
        </a>
      )}
      {nextHref && next && (
        <a
          className={cn(
            "study-next inline-flex h-7 items-center gap-1.5 rounded-control px-2.5 text-xs font-medium whitespace-nowrap focus-bar [&_svg]:size-3.5",
            done
              ? "bg-emphasis text-accent-text hover:opacity-90"
              : "text-text-mid hover:bg-hover hover:text-text-high",
          )}
          href={nextHref}
          aria-label="Next lesson"
          title={next.title}
        >
          <span>Next lesson</span>
          <ArrowRight aria-hidden />
        </a>
      )}
    </nav>
  );
}
