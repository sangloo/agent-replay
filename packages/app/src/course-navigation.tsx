import { curriculumLessons, studyHref, type StudyContext } from "@agent-replay/core";
import * as React from "react";
import { courseProgress } from "./study-progress";

export function CourseNavigation({
  study,
  reviewed,
  onReviewed,
}: {
  study: StudyContext;
  reviewed: boolean;
  onReviewed: () => void;
}) {
  const all = curriculumLessons(study.curriculum),
    index = all.findIndex((l) => l.id === study.lessonId),
    lesson = all[index];
  const chapter = study.curriculum.chapters.find((c) =>
    c.lessons.some((l) => l.id === study.lessonId),
  );
  const [open, setOpen] = React.useState(false);
  if (!lesson || !chapter) return null;
  const progress = courseProgress(study.curriculum.id, study.curriculum.revision);
  const previous = all[index - 1],
    next = all[index + 1];
  return (
    <section className="study-navigation" aria-label="Course navigation">
      <div className="study-navigation-bar">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="course-outline"
        >
          Chapters <span aria-hidden>{open ? "−" : "+"}</span>
        </button>
        <span className="study-location">
          {chapter.title}
          <small>
            Lesson {lesson.id} · {index + 1} of {all.length}
          </small>
        </span>
        <button type="button" aria-pressed={reviewed} onClick={onReviewed}>
          {reviewed ? "✓ Reviewed" : "Mark reviewed"}
        </button>
        <nav aria-label="Adjacent lessons">
          {previous && studyHref(study, previous) && (
            <a href={studyHref(study, previous)} title={previous.title}>
              ← Previous
            </a>
          )}
          {next && studyHref(study, next) && (
            <a href={studyHref(study, next)} title={next.title}>
              Next lesson →
            </a>
          )}
        </nav>
      </div>
      {open && (
        <div id="course-outline" className="study-outline">
          <div>
            <h2>{study.curriculum.title}</h2>
            <p>{lesson.goal}</p>
            {lesson.prerequisites.length > 0 && (
              <p>
                Before this lesson:{" "}
                {lesson.prerequisites.map((id, i) => {
                  const p = all.find((l) => l.id === id)!;
                  return (
                    <React.Fragment key={id}>
                      {i ? " · " : ""}
                      <a href={studyHref(study, p)}>
                        {id}. {p.title}
                      </a>
                    </React.Fragment>
                  );
                })}
              </p>
            )}
            <p>
              {study.key ? (
                <a href={`#/learn/${study.key}`}>Open full course map →</a>
              ) : study.curriculum.libraryFile ? (
                <a href={study.curriculum.libraryFile}>Open full course map →</a>
              ) : (
                "Adjacent lessons open companion HTML files when they are present in the same folder."
              )}
            </p>
            <p>
              Mark reviewed after working through the checkpoint. Playback alone does
              not mark a lesson complete.
            </p>
          </div>
          <nav aria-label="Lesson outline">
            {study.curriculum.chapters.map((c) => (
              <details key={c.id} open={c.id === chapter.id}>
                <summary>
                  {c.title} · {c.lessons.length}
                </summary>
                <ol>
                  {c.lessons.map((l) => (
                    <li key={l.id}>
                      {studyHref(study, l) ? (
                        <a
                          href={studyHref(study, l)}
                          aria-current={l.id === lesson.id ? "step" : undefined}
                        >
                          {l.id}. {l.title}
                          {progress[l.id]?.reviewed ? " ✓" : ""}
                        </a>
                      ) : (
                        <span>
                          {l.id}. {l.title} (unavailable)
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </nav>
        </div>
      )}
    </section>
  );
}
