import { curriculumLessons, studyHref, type StudyContext } from "@agent-replay/core";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import * as React from "react";
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
    <section className="study-outline" aria-label="Course outline">
      <div className="study-outline-heading">
        <h2>{study.curriculum.title}</h2>
        {libraryHref && <a href={libraryHref}>Full course map →</a>}
      </div>
      <nav aria-label="Lesson outline">
        {study.curriculum.chapters.map((c, i) => (
          <details key={c.id} open={c.id === chapter.id}>
            <summary>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {c.title}
              <small>{c.lessons.length}</small>
            </summary>
            <ol>
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
                      >
                        <span className="study-outline-number">{l.id}</span>
                        <span>{l.title}</span>
                        {done && (
                          <Check className="study-done-icon" aria-label="Reviewed" />
                        )}
                      </a>
                    ) : (
                      <span className="study-unavailable">
                        {l.id}. {l.title} (unavailable)
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
        <p className="study-prerequisites">
          Before this lesson:{" "}
          {lesson.prerequisites.map((id, i) => {
            const prerequisite = all.find((l) => l.id === id)!;
            return (
              <React.Fragment key={id}>
                {i ? " · " : ""}
                <a href={studyHref(study, prerequisite)} title={prerequisite.title}>
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

/** Small, persistent lesson actions beside the playback controls. */
export function CourseActions({
  study,
  reviewed,
  onReviewed,
}: {
  study: StudyContext;
  reviewed: boolean;
  onReviewed: () => void;
}) {
  const all = curriculumLessons(study.curriculum);
  const index = all.findIndex((l) => l.id === study.lessonId);
  if (index < 0) return null;
  const previous = all[index - 1],
    next = all[index + 1];
  return (
    <nav className="study-actions" aria-label="Lesson controls">
      <button
        className="study-reviewed"
        type="button"
        aria-label={reviewed ? "Reviewed" : "Mark reviewed"}
        aria-pressed={reviewed}
        onClick={onReviewed}
        title={reviewed ? "Reviewed — click to undo" : "Mark this lesson reviewed"}
      >
        <Check aria-hidden />
        <span>{reviewed ? "Reviewed" : "Review"}</span>
      </button>
      {previous && studyHref(study, previous) && (
        <a
          className="study-previous"
          href={studyHref(study, previous)}
          aria-label="Previous lesson"
          title={previous.title}
        >
          <ArrowLeft aria-hidden />
        </a>
      )}
      {next && studyHref(study, next) && (
        <a
          className="study-next"
          href={studyHref(study, next)}
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
