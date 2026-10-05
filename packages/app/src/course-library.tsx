import {
  curriculumLessons,
  studyHref,
  type Curriculum,
  type CurriculumLesson,
  type StudyCourse,
} from "@agent-replay/core";
import { cn, Input } from "@/ui";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Circle,
  CircleDashed,
  GraduationCap,
  Lock,
  Search,
} from "lucide-react";
import * as React from "react";

import { api, rememberTitle, useLoad, type SavedListing } from "./api";
import { AppHeader } from "./app-header";
import { FolderDialog } from "./folder-dialog";
import { ago } from "./labels";
import { ProgressMark } from "./library";
import { learnHash, libraryHash } from "./library-params";
import { ProgressVersion } from "./progress-sync";
import { ProjectPicker } from "./project-picker";
import {
  courseProgress,
  fractionOf,
  furthestOf,
  listedProgress,
  type StudyProgress,
} from "./study-progress";
import { AppearanceMenu } from "./appearance";

/** Lessons a course map mounts at a time. */
const BATCH = 24;

/**
 * Learn: every course on this machine and how far along each one is — the
 * same place as Sessions and Saved, one tab over, not a separate tool. Like
 * them it is about the project chosen in the picker, or all of them.
 */
export function CourseLibrary({
  courseKey,
  project,
  onProject,
}: {
  courseKey?: string;
  /** A repository's root; empty for all of them. */
  project: string;
  onProject: (root: string) => void;
}) {
  // An open map is asked for by its own key, so it is found whichever
  // project is chosen; the list, by the project.
  const catalog = useLoad(
    new URLSearchParams(
      courseKey ? { key: courseKey } : project ? { project } : {},
    ).toString(),
    api.curricula,
  );
  // Redraw when progress kept elsewhere arrives.
  React.useContext(ProgressVersion);
  const courses = useLoad(
    new URLSearchParams({
      agent: "course",
      limit: "100",
      ...(project ? { project } : {}),
    }).toString(),
    api.replays,
  );
  const [refresh, setRefresh] = React.useState(0);
  const projects = useLoad(`projects:${refresh}`, api.projects);
  const [opening, setOpening] = React.useState(false);
  const course =
    courseKey && catalog.state === "ready"
      ? catalog.data.courses.find((c) => c.key === courseKey)
      : undefined;
  return (
    <div className="flex h-dvh flex-col bg-surface-low text-text-high">
      <AppHeader
        place="learn"
        hrefOf={(place) =>
          place === "learn"
            ? learnHash(project)
            : libraryHash({ tab: place, q: "", agent: "", project, page: 1 })
        }
        picker={
          <ProjectPicker
            projects={projects.state === "ready" ? projects.data : []}
            value={project}
            onChange={onProject}
            onOpenFolder={() => setOpening(true)}
          />
        }
      />
      <FolderDialog
        open={opening}
        onOpenChange={setOpening}
        onAdded={(added) => {
          setRefresh((n) => n + 1);
          onProject(added.root);
        }}
      />
      <div
        id="study-content"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-base shadow-sheet sm:mx-2 sm:mb-2 sm:rounded-surface"
      >
        {catalog.state === "loading" || (courses.state === "loading" && !courseKey) ? (
          <p
            role="status"
            className="mx-auto max-w-4xl px-6 py-10 text-sm text-text-low"
          >
            Reading the courses…
          </p>
        ) : catalog.state === "failed" ? (
          <p
            role="alert"
            className="mx-auto max-w-4xl px-6 py-10 text-sm text-danger-ink"
          >
            {catalog.message}
          </p>
        ) : course ? (
          <CourseMap key={course.key} course={course} back={learnHash(project)} />
        ) : courseKey ? (
          // A map that is no longer there — moved, or its folder forgotten.
          <p
            role="status"
            className="mx-auto max-w-4xl px-6 py-10 text-sm text-text-mid"
          >
            This course map is not here any more.{" "}
            <a
              href={learnHash(project)}
              className="rounded-control font-medium text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
            >
              See every course
            </a>
          </p>
        ) : (
          <LearnHome
            project={project}
            maps={catalog.data.courses}
            problems={catalog.data.problems}
            courses={courses.state === "ready" ? courses.data.items : []}
          />
        )}
      </div>
    </div>
  );
}

interface Resume {
  /** The replay it opens, as the routes name it. */
  id: string;
  title: string;
  /** What it is part of, in a few words. */
  context: string;
  href: string;
  progress: StudyProgress;
  fraction: number;
}

/** The most recently studied thing not yet finished — the first thing Learn offers. */
function resumeOf(maps: readonly StudyCourse[], courses: readonly SavedListing[]) {
  const candidates: Resume[] = [];
  for (const map of maps) {
    const progress = courseProgress(map.curriculum.id, map.curriculum.revision);
    for (const lesson of curriculumLessons(map.curriculum)) {
      const saved = progress[lesson.id];
      const href = studyHref({ ...map, lessonId: lesson.id }, lesson);
      if (!saved || saved.reviewed || !href) continue;
      candidates.push({
        id: `${map.key}:${lesson.replay}`,
        title: lesson.title,
        context: map.curriculum.title,
        href,
        progress: saved,
        fraction: fractionOf(saved),
      });
    }
  }
  for (const course of courses) {
    const saved = listedProgress(course);
    if (!saved || saved.reviewed || saved.cursor === 0) continue;
    candidates.push({
      id: course.id,
      title: course.title,
      context: course.repo,
      href: `#/replay/${encodeURIComponent(course.id)}`,
      progress: saved,
      fraction: fractionOf(saved, course.steps),
    });
  }
  return candidates.sort((a, b) => b.progress.updatedAt - a.progress.updatedAt)[0];
}

function LearnHome({
  project,
  maps,
  problems,
  courses,
}: {
  project: string;
  maps: readonly StudyCourse[];
  problems: readonly { project: string; message: string }[];
  courses: readonly SavedListing[];
}) {
  const resume = resumeOf(maps, courses);
  // Courses a map already lists are reached through it.
  const mapped = new Set(
    maps.flatMap((map) =>
      curriculumLessons(map.curriculum).map((lesson) => `${map.key}:${lesson.replay}`),
    ),
  );
  const loose = courses.filter((course) => !mapped.has(course.id));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 pt-8 pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Learn</h1>
        <p className="max-w-prose text-sm text-text-mid">
          Courses rebuild a repository from nothing, lesson by lesson — the real code
          arriving a piece at a time, with the explanations beside it. Where you are in
          each is kept for you; a lesson is done once you reach its end.
        </p>
      </header>

      {problems.map((p) => (
        <p key={p.project} role="alert" className="text-sm text-warning-ink">
          {p.project}: {p.message}
        </p>
      ))}

      {resume ? (
        <section
          aria-label="Continue learning"
          className="flex items-center gap-6 rounded-panel bg-surface-mid p-5"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emphasis-subtle text-emphasis">
            <BookOpen aria-hidden className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="text-2xs font-medium tracking-wide text-text-low uppercase">
              Continue where you left off
            </p>
            <p className="truncate font-medium">{resume.title}</p>
            <div className="flex items-center gap-3 text-xs text-text-low">
              <span className="truncate">{resume.context}</span>
              <ProgressMark progress={{ fraction: resume.fraction, done: false }} />
              <span>{ago(new Date(resume.progress.updatedAt).toISOString())}</span>
            </div>
          </div>
          <a
            href={resume.href}
            onClick={() => rememberTitle(resume.id, resume.title)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-emphasis px-4 text-sm font-medium text-accent-text focus-bar hover:opacity-90"
          >
            Continue
            <ArrowRight aria-hidden className="size-4" />
          </a>
        </section>
      ) : null}

      {maps.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xs font-medium tracking-wide text-text-low uppercase">
            Course maps
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {maps.map((map) => {
              const lessons = curriculumLessons(map.curriculum);
              const progress = courseProgress(
                map.curriculum.id,
                map.curriculum.revision,
              );
              const done = lessons.filter((l) => progress[l.id]?.reviewed).length;
              return (
                <li key={map.key}>
                  <a
                    href={learnHash(project, map.key)}
                    className="flex h-full flex-col gap-3 rounded-panel bg-surface-mid p-4 focus-bar transition-colors duration-fast hover:bg-active"
                  >
                    <span className="flex items-start gap-2.5">
                      <GraduationCap
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-text-low"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{map.curriculum.title}</span>
                        <span className="line-clamp-2 text-xs text-text-mid">
                          {map.curriculum.description}
                        </span>
                      </span>
                    </span>
                    <span className="mt-auto flex items-center gap-3 text-2xs text-text-low tabular-nums">
                      <Bar fraction={lessons.length ? done / lessons.length : 0} />
                      {done} of {lessons.length} lessons done
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {maps.length && !loose.length ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xs font-medium tracking-wide text-text-low uppercase">
            {maps.length ? "Other courses" : "Courses"}
          </h2>
          {loose.length ? (
            <ul className="flex flex-col">
              {loose.map((course) => {
                const saved = listedProgress(course);
                const fraction = fractionOf(saved, course.steps);
                return (
                  <li key={course.id}>
                    <a
                      href={`#/replay/${encodeURIComponent(course.id)}`}
                      onClick={() => rememberTitle(course.id, course.title)}
                      className="-mx-3 flex items-center gap-4 rounded-control px-3 py-2.5 focus-bar hover:bg-hover"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm">{course.title}</span>
                        <span className="truncate text-xs text-text-low">
                          {course.repo}
                          {course.lessons !== undefined
                            ? ` · ${course.lessons} lesson${course.lessons === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </span>
                      {saved && (saved.cursor > 0 || saved.reviewed) ? (
                        <ProgressMark
                          progress={{ fraction, done: saved.reviewed || fraction >= 1 }}
                        />
                      ) : (
                        <span className="shrink-0 text-2xs text-text-low">
                          Not started
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex max-w-prose flex-col gap-2 text-sm text-text-mid">
              <p>
                {maps.length
                  ? "Every course here is part of a course map above."
                  : project
                    ? "No courses in this project yet. Ask your agent to teach it to you:"
                    : "No courses yet. Ask your agent to teach you a repository:"}
              </p>
              {maps.length ? null : (
                <>
                  <p className="rounded-control bg-surface-mid px-3 py-2 text-text-high">
                    “Teach me this repository. Build it up from scratch as a course.”
                  </p>
                  <p className="text-xs text-text-low">
                    With the Replay plugin installed (or after{" "}
                    <code className="font-mono">replay skills install</code>) it writes
                    one into <code className="font-mono">.replays/</code>, and it
                    appears here while it is being written.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <span aria-hidden className="h-1 w-20 overflow-hidden rounded-full bg-line-high">
      <span
        className="block h-full rounded-full bg-emphasis"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </span>
  );
}

type Status = "done" | "started" | "new" | "unavailable";

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case "done":
      return (
        <span className="grid size-5 place-items-center rounded-full bg-success-subtle text-success-ink">
          <Check aria-hidden className="size-3" />
        </span>
      );
    case "started":
      return <CircleDashed aria-hidden className="size-5 text-emphasis" />;
    case "unavailable":
      return <Lock aria-hidden className="size-4 text-text-low" />;
    default:
      return <Circle aria-hidden className="size-5 text-line-high" />;
  }
}

/** A curriculum, chapter by chapter, with where the reader stands in each lesson. */
export function CourseMap({
  course,
  exportBase,
  back,
}: {
  course: StudyCourse;
  exportBase?: string;
  /** The Learn page to offer the way back to. */
  back?: string;
}) {
  const { curriculum } = course;
  const progress = courseProgress(curriculum.id, curriculum.revision);
  const all = curriculumLessons(curriculum);
  const openable = (l: CurriculumLesson) =>
    !course.unavailable.includes(l.id) && (exportBase === undefined || l.exportFile);
  const recent = all
    .filter((l) => progress[l.id] && openable(l))
    .sort((a, b) => progress[b.id]!.updatedAt - progress[a.id]!.updatedAt)[0];
  const next =
    recent && !progress[recent.id]!.reviewed
      ? recent
      : all.find((l) => !progress[l.id]?.reviewed && openable(l));
  const [query, setQuery] = React.useState("");
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (l: CurriculumLesson, chapterTitle: string) =>
    terms.every((t) =>
      `${l.id} ${l.title} ${l.goal} ${chapterTitle}`.toLowerCase().includes(t),
    );
  const matched = curriculum.chapters.map((chapter, number) => ({
    chapter,
    number,
    lessons: chapter.lessons.filter((l) => matches(l, chapter.title)),
  }));
  // A map of hundreds of lessons mounts a batch at a time: more arrive as
  // the end of the list comes into view, or from the button there. Search
  // still covers every lesson.
  const [page, setPage] = React.useState({ query, count: BATCH });
  const count = page.query === query ? page.count : BATCH;
  const total = matched.reduce((sum, c) => sum + c.lessons.length, 0);
  const chapters: typeof matched = [];
  for (let left = count, i = 0; i < matched.length && left > 0; i++) {
    const lessons = matched[i]!.lessons.slice(0, left);
    left -= lessons.length;
    if (lessons.length) chapters.push({ ...matched[i]!, lessons });
  }
  const more = total > count;
  const loadMore = React.useCallback(
    () => setPage({ query, count: count + BATCH }),
    [query, count],
  );
  const sentinel = React.useRef<HTMLButtonElement>(null);
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
  const link = (lesson: CurriculumLesson) => {
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
  const statusOf = (lesson: CurriculumLesson): Status => {
    if (!link(lesson)) return "unavailable";
    const saved = progress[lesson.id];
    if (saved?.reviewed) return "done";
    if (saved) return "started";
    return "new";
  };
  const done = all.filter((l) => progress[l.id]?.reviewed).length;
  const percentOf = (lesson: CurriculumLesson) => {
    const saved = progress[lesson.id];
    return saved?.total
      ? Math.round((Math.min(furthestOf(saved), saved.total) / saved.total) * 100)
      : undefined;
  };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 pt-6 pb-24">
      {back ? (
        <a
          href={back}
          className="-ml-2 flex items-center gap-1.5 self-start rounded-control px-2 py-1 text-xs text-text-low focus-bar hover:bg-hover hover:text-text-high"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          All courses
        </a>
      ) : null}
      <header className="flex flex-col gap-3">
        <p className="text-2xs font-medium tracking-wide text-text-low uppercase">
          Course map · {all.length} lessons in {curriculum.chapters.length} chapters
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {curriculum.title}
        </h1>
        <p className="max-w-prose text-sm text-text-mid">{curriculum.description}</p>
        <p className="flex items-center gap-3 text-xs text-text-low tabular-nums">
          <Bar fraction={all.length ? done / all.length : 0} />
          {done} of {all.length} done
        </p>
      </header>

      {next && link(next) ? (
        <section
          aria-label="Continue learning"
          className="flex items-center gap-6 rounded-panel bg-surface-mid p-5"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-2xs font-medium tracking-wide text-text-low uppercase">
              {progress[next.id]
                ? "Continue where you left off"
                : "Next in your study path"}
            </p>
            <h2 className="font-medium">
              {next.id}. {next.title}
            </h2>
            <p className="text-sm text-text-mid">
              {progress[next.id] && percentOf(next) !== undefined
                ? `${percentOf(next)}% through. `
                : ""}
              {next.goal}
            </p>
          </div>
          <a
            href={link(next)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-emphasis px-4 text-sm font-medium text-accent-text focus-bar hover:opacity-90"
          >
            {progress[next.id] ? "Resume lesson" : "Start lesson"} →
          </a>
        </section>
      ) : (
        <p className="rounded-panel bg-surface-mid p-5 text-sm text-text-mid">
          {all.some((l) => link(l))
            ? "Every available lesson is done. Revisit any of them below."
            : "No lessons are available to open yet. The outline is below."}
        </p>
      )}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 z-raised icon-sm -translate-y-1/2 text-text-low"
        />
        <Input
          id="lesson-search"
          size="sm"
          type="search"
          aria-label="Find a lesson across chapters"
          placeholder="Find a lesson — titles, topics or numbers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>
      {!total && (
        <p role="status" className="text-sm text-text-low">
          No lessons match “{query}”.
        </p>
      )}

      {chapters.map(({ chapter, number, lessons }) => (
        <section key={chapter.id} className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <p className="text-2xs font-medium tracking-wide text-text-low uppercase">
              Chapter {number + 1} ·{" "}
              {chapter.lessons.filter((l) => progress[l.id]?.reviewed).length}/
              {chapter.lessons.length} done
            </p>
            <h2 className="text-lg font-semibold tracking-tight">{chapter.title}</h2>
            <p className="max-w-prose text-sm text-text-mid">{chapter.description}</p>
          </div>
          <ol className="study-lessons -mx-3 flex flex-col gap-0.5">
            {lessons.map((l) => {
              const href = link(l);
              const status = statusOf(l);
              const percent = percentOf(l);
              return (
                <li
                  key={l.id}
                  className="flex gap-3 rounded-panel px-3 py-3 hover:bg-hover"
                >
                  <span className="flex w-6 shrink-0 justify-center pt-0.5">
                    <StatusIcon status={status} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="flex items-baseline gap-2">
                      <span className="text-xs text-text-low tabular-nums">{l.id}</span>
                      {href ? (
                        <a
                          className="rounded-control font-medium focus-bar hover:underline hover:decoration-line-high hover:underline-offset-2"
                          href={href}
                        >
                          {l.title}
                        </a>
                      ) : (
                        <span className="font-medium text-text-low">{l.title}</span>
                      )}
                    </p>
                    <p className="max-w-prose text-sm text-text-mid">{l.goal}</p>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-low">
                      <span
                        className={cn(
                          status === "done" && "font-medium text-success-ink",
                        )}
                      >
                        {status === "unavailable"
                          ? "Replay unavailable"
                          : status === "done"
                            ? "Done"
                            : status === "started"
                              ? percent !== undefined
                                ? `In progress · ${percent}%`
                                : "In progress"
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
                                <a
                                  href={link(p)}
                                  title={p.title}
                                  className="underline underline-offset-2"
                                >
                                  {id}
                                </a>
                              </React.Fragment>
                            );
                          })}
                        </span>
                      )}
                    </p>
                  </div>
                  {href && (
                    <a
                      className="grid size-8 shrink-0 place-items-center self-center rounded-control text-text-low focus-bar hover:bg-hover hover:text-text-high"
                      href={href}
                      aria-label={`Open lesson ${l.id}`}
                    >
                      <ArrowRight aria-hidden className="size-4" />
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
          className="self-center rounded-control px-4 py-2 text-sm text-text-mid focus-bar hover:bg-hover hover:text-text-high"
        >
          Show more lessons ({count} of {total})
        </button>
      )}
    </main>
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
    <div className="flex h-dvh flex-col bg-surface-low text-text-high">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <span className="mr-auto text-sm font-semibold">Replay · Learn</span>
        <span className="text-xs text-text-low">Companion lesson library</span>
        <AppearanceMenu />
      </header>
      <div
        id="study-content"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-base shadow-sheet sm:mx-2 sm:mb-2 sm:rounded-surface"
      >
        <CourseMap
          course={{ key: "", curriculum, unavailable: [] }}
          exportBase={exportBase}
        />
      </div>
    </div>
  );
}
