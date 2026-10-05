import {
  curriculumLessons,
  studyHref,
  type StudyCourse,
  type Curriculum,
} from "@agent-replay/core";
import * as React from "react";
import { api, useLoad } from "./api";
import { courseProgress } from "./study-progress";
import { ThemeToggle } from "./theme-toggle";
import { Input } from "@/ui";

export function CourseLibrary({ courseKey }: { courseKey?: string }) {
  const catalog = useLoad("curricula", api.curricula);
  return (
    <div className="study-library h-dvh bg-surface-base text-text-high">
      <a href="#study-content" className="study-skip">
        Skip to lessons
      </a>
      <header className="study-top">
        <a href="#/learn">Replay / Learn</a>
        <a href="#/">Sessions & saved replays</a>
        <ThemeToggle />
      </header>
      {catalog.state === "loading" ? (
        <p role="status" className="p-8">
          Reading course maps…
        </p>
      ) : catalog.state === "failed" ? (
        <p role="alert" className="p-8">
          {catalog.message}
        </p>
      ) : (
        <>
          {catalog.data.problems.map((p) => (
            <p key={p.project} role="alert" className="p-4 text-warning-ink">
              {p.project}: {p.message}
            </p>
          ))}
          {catalog.data.courses.length === 0 ? (
            <main className="mx-auto max-w-2xl p-8">
              <h1 className="text-3xl font-semibold">A place for connected lessons</h1>
              <p className="mt-4 text-text-mid">
                No course map is available yet. Add a curriculum.manifest beside the
                saved courses in .replays to organize chapters, prerequisites and
                companion exports.
              </p>
              <a className="mt-5 inline-block underline" href="#/?tab=saved">
                Browse saved replays
              </a>
            </main>
          ) : (
            (() => {
              const current =
                catalog.data.courses.find((c) => c.key === courseKey) ??
                catalog.data.courses[0]!;
              return (
                <>
                  {catalog.data.courses.length > 1 && (
                    <nav
                      aria-label="Courses"
                      className="flex flex-wrap gap-4 px-8 py-4"
                    >
                      {catalog.data.courses.map((c) => (
                        <a
                          key={c.key}
                          href={`#/learn/${c.key}`}
                          aria-current={c.key === current.key ? "page" : undefined}
                          className="underline"
                        >
                          {c.curriculum.title}
                        </a>
                      ))}
                    </nav>
                  )}
                  <CourseMap key={current.key} course={current} />
                </>
              );
            })()
          )}
        </>
      )}
    </div>
  );
}

export function CourseMap({
  course,
  exportBase,
}: {
  course: StudyCourse;
  exportBase?: string;
}) {
  const { curriculum } = course;
  const progress = courseProgress(curriculum.id, curriculum.revision);
  const all = curriculumLessons(curriculum);
  const recent = all
    .filter(
      (l) =>
        progress[l.id] &&
        !course.unavailable.includes(l.id) &&
        (exportBase === undefined || l.exportFile),
    )
    .sort((a, b) => progress[b.id]!.updatedAt - progress[a.id]!.updatedAt)[0];
  const next =
    recent && !progress[recent.id]!.reviewed
      ? recent
      : all.find(
          (l) =>
            !progress[l.id]?.reviewed &&
            !course.unavailable.includes(l.id) &&
            (exportBase === undefined || l.exportFile),
        );
  const currentChapter =
    curriculum.chapters.find((c) =>
      c.lessons.some((l) => l.id === (next?.id ?? recent?.id)),
    ) ?? curriculum.chapters[0]!;
  const [chapterId, setChapterId] = React.useState(currentChapter.id);
  const [query, setQuery] = React.useState("");
  const selected = curriculum.chapters.find((c) => c.id === chapterId)!;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching = terms.length
    ? curriculum.chapters.filter((c) =>
        c.lessons.some((l) =>
          terms.every((t) =>
            `${l.id} ${l.title} ${l.goal} ${c.title}`.toLowerCase().includes(t),
          ),
        ),
      )
    : [selected];
  // Bound the initial React tree even when searching across every chapter.
  const pageKey = `${chapterId}:${query}`;
  const [page, setPage] = React.useState({ key: pageKey, count: 24 });
  const count = page.key === pageKey ? page.count : 24;
  const matchedLessons = matching.flatMap((chapter) =>
    chapter.lessons.filter((lesson) =>
      terms.every((term) =>
        `${lesson.id} ${lesson.title} ${lesson.goal} ${chapter.title}`
          .toLowerCase()
          .includes(term),
      ),
    ),
  );
  const displayed = new Set(matchedLessons.slice(0, count).map((lesson) => lesson.id));
  const more = matchedLessons.length > count;
  const sentinel = React.useRef<HTMLButtonElement>(null);
  const loadMore = React.useCallback(
    () => setPage({ key: pageKey, count: count + 24 }),
    [pageKey, count],
  );
  React.useEffect(() => {
    if (!more || !sentinel.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [more, loadMore]);
  const link = (lesson: (typeof all)[number]) => {
    const href = studyHref(
      {
        ...course,
        key: exportBase === undefined ? course.key : undefined,
        lessonId: lesson.id,
      },
      lesson,
    );
    return href && exportBase !== undefined ? `${exportBase}${href}` : href;
  };
  const reviewed = all.filter((l) => progress[l.id]?.reviewed).length;
  return (
    <div className="study-shell">
      <aside className="study-chapters">
        <p className="study-eyebrow">Course contents</p>
        <nav aria-label="Chapters">
          {curriculum.chapters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              aria-current={c.id === chapterId ? "step" : undefined}
              onClick={() => {
                setChapterId(c.id);
                setQuery("");
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span>
                {c.title}
                <small>
                  {c.lessons.filter((l) => progress[l.id]?.reviewed).length} /{" "}
                  {c.lessons.length} reviewed
                </small>
              </span>
            </button>
          ))}
        </nav>
        <p className="study-storage">
          Study position stays in this browser. “Reviewed” is your own checkpoint, not a
          test score.
        </p>
      </aside>
      <main id="study-content" className="study-main">
        <p className="study-eyebrow">
          {all.length} lessons · {curriculum.chapters.length} chapters · {reviewed}{" "}
          reviewed
        </p>
        <h1>{curriculum.title}</h1>
        <p className="study-description">{curriculum.description}</p>
        {next && link(next) ? (
          <section className="study-resume" aria-label="Continue learning">
            <div>
              <p className="study-eyebrow">
                {progress[next.id]
                  ? "Continue where you left off"
                  : "Next in your study path"}
              </p>
              <h2>
                {next.id}. {next.title}
              </h2>
              <p>
                {progress[next.id]
                  ? `Saved at step ${progress[next.id]!.cursor}. `
                  : ""}
                {next.goal}
              </p>
            </div>
            <a href={link(next)}>
              {" "}
              {progress[next.id] ? "Resume lesson" : "Start lesson"} →
            </a>
          </section>
        ) : (
          <p className="study-resume">
            {all.some((l) => link(l))
              ? "Every available lesson is marked reviewed. Revisit any chapter below."
              : "No lessons are available to open yet. The course outline is shown below."}
          </p>
        )}
        <div className="study-search">
          <label htmlFor="lesson-search">Find a lesson across chapters</label>
          <Input
            id="lesson-search"
            type="search"
            placeholder="Search titles, topics or lesson numbers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!matching.length && (
          <p role="status">No lessons match “{query}”. Try another topic.</p>
        )}
        {matching
          .filter((chapter) =>
            chapter.lessons.some((lesson) => displayed.has(lesson.id)),
          )
          .map((chapter) => (
            <section key={chapter.id} className="study-section">
              <p className="study-eyebrow">
                Chapter {curriculum.chapters.indexOf(chapter) + 1}
              </p>
              <h2>{chapter.title}</h2>
              <p>{chapter.description}</p>
              <ol className="study-lessons">
                {chapter.lessons
                  .filter((lesson) => displayed.has(lesson.id))
                  .map((l) => {
                    const href = link(l),
                      saved = progress[l.id];
                    return (
                      <li key={l.id}>
                        <span className="study-number">{l.id}</span>
                        <div>
                          {href ? (
                            <a className="study-lesson-title" href={href}>
                              {l.title}
                            </a>
                          ) : (
                            <span className="study-lesson-title">{l.title}</span>
                          )}
                          <p>{l.goal}</p>
                          <div className="study-lesson-meta">
                            <span
                              className={
                                saved?.reviewed ? "study-reviewed-label" : undefined
                              }
                            >
                              {!href
                                ? "Replay unavailable"
                                : saved?.reviewed
                                  ? "Reviewed"
                                  : saved
                                    ? "In progress"
                                    : "Not started"}
                            </span>
                            {l.referenceOnly && <span>Reference collection</span>}
                            {l.prerequisites.length > 0 && (
                              <span>
                                Before this:{" "}
                                {l.prerequisites.map((id, i) => {
                                  const p = all.find((x) => x.id === id)!;
                                  return (
                                    <React.Fragment key={id}>
                                      {i ? ", " : ""}
                                      <a href={link(p)} title={p.title}>
                                        {id}
                                      </a>
                                    </React.Fragment>
                                  );
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        {href && (
                          <a
                            className="study-open"
                            href={href}
                            aria-label={`Open lesson ${l.id}`}
                          >
                            →
                          </a>
                        )}
                      </li>
                    );
                  })}
              </ol>
            </section>
          ))}
        {more && (
          <button
            ref={sentinel}
            type="button"
            onClick={loadMore}
            className="my-4 rounded-control px-4 py-2 text-sm text-text-mid hover:bg-hover"
          >
            Show more lessons ({Math.min(count, matchedLessons.length)} of{" "}
            {matchedLessons.length})
          </button>
        )}
      </main>
    </div>
  );
}

export function StandaloneCourseLibrary({
  curriculum,
  exportBase,
}: {
  curriculum: Curriculum;
  exportBase: string;
}) {
  return (
    <div className="study-library h-dvh bg-surface-base text-text-high">
      <a href="#study-content" className="study-skip">
        Skip to lessons
      </a>
      <header className="study-top">
        <span className="mr-auto font-medium">Replay / Learn</span>
        <span className="text-xs text-text-low">Companion lesson library</span>
        <ThemeToggle />
      </header>
      <CourseMap
        course={{ key: "", curriculum, unavailable: [] }}
        exportBase={exportBase}
      />
    </div>
  );
}
