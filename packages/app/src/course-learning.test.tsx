import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { Curriculum, Replay } from "@agent-replay/core";
import { ThemeProvider } from "@/ui";
import { Player } from "./player/player";
import { CourseMap } from "./course-library";
import {
  lessonProgressKey,
  readStudyProgress,
  saveStudyProgress,
} from "./study-progress";
const curriculum: Curriculum = {
  version: 1,
  id: "test-course",
  revision: "pin",
  title: "A connected course",
  description: "Learn in order.",
  chapters: [
    {
      id: "first",
      title: "Foundations",
      description: "Start with values.",
      lessons: [
        { id: "01", title: "One", goal: "Read one.", replay: "one", prerequisites: [] },
        {
          id: "02",
          title: "Two",
          goal: "Use one.",
          replay: "two",
          prerequisites: ["01"],
        },
      ],
    },
  ],
};
const base = { at: "2026-01-01T00:00:00Z", agent: "main", turn: 0 };
const replay: Replay = {
  version: 1,
  id: "one",
  title: "One",
  source: "course",
  startedAt: base.at,
  endedAt: base.at,
  repo: { name: "r", commits: [] },
  files: {},
  omitted: [],
  notes: {},
  course: { rev: "pin" },
  steps: [
    { ...base, id: "a", kind: "lesson", title: "One" },
    { ...base, id: "b", kind: "explain", text: "First explanation." },
    { ...base, id: "c", kind: "explain", text: "Second explanation." },
    { ...base, id: "d", kind: "explain", text: "Final checkpoint." },
  ],
};
const study = { curriculum, key: "12345678", lessonId: "01" };
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/replay/one");
  Element.prototype.scrollIntoView = () => {};
});
it("resumes saved steps, honors explicit deep links, and marks reviewed only on request", () => {
  const key = lessonProgressKey("test-course", "01", "pin");
  saveStudyProgress(key, { cursor: 3, reviewed: false, updatedAt: 1 });
  const view = render(
    <ThemeProvider>
      <Player replay={replay} study={study} />
    </ThemeProvider>,
  );
  expect(window.location.hash).toContain("at=3");
  expect(screen.queryByRole("combobox", { name: "Speed" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Steps shown" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark reviewed" }).closest("footer"),
  ).not.toBeNull();
  expect(
    screen.getByRole("link", { name: "Next lesson" }).closest("footer"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next explanation →" }));
  expect(window.location.hash).toContain("at=4");
  expect(readStudyProgress(key)?.reviewed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
  expect(readStudyProgress(key)?.reviewed).toBe(true);
  view.unmount();
  render(
    <ThemeProvider>
      <Player replay={replay} study={study} at={2} />
    </ThemeProvider>,
  );
  expect(window.location.hash).toContain("at=2");
  expect(screen.getByRole("button", { name: "Reviewed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  cleanup();
});
it("resumes an unfinished lesson and advances the suggested path after explicit review", () => {
  const key = lessonProgressKey("test-course", "01", "pin");
  saveStudyProgress(key, { cursor: 3, reviewed: false, updatedAt: 1 });
  const view = render(
    <ThemeProvider>
      <CourseMap course={{ key: "12345678", curriculum, unavailable: [] }} />
    </ThemeProvider>,
  );
  expect(screen.getByRole("link", { name: "Resume lesson →" })).toHaveAttribute(
    "href",
    "#/replay/12345678%3Aone",
  );
  view.unmount();
  saveStudyProgress(key, { cursor: 4, reviewed: true, updatedAt: 2 });
  render(
    <ThemeProvider>
      <CourseMap course={{ key: "12345678", curriculum, unavailable: [] }} />
    </ThemeProvider>,
  );
  expect(screen.getByRole("link", { name: "Start lesson →" })).toHaveAttribute(
    "href",
    "#/replay/12345678%3Atwo",
  );
  expect(screen.getByRole("link", { name: "01" })).toHaveAttribute("title", "One");
});
it("uses the curriculum revision for progress and skips an unavailable resume target", () => {
  const changed = { ...curriculum, revision: "edition-two" };
  const view = render(
    <ThemeProvider>
      <Player replay={replay} study={{ ...study, curriculum: changed }} />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
  expect(
    readStudyProgress(lessonProgressKey(changed.id, "01", changed.revision))?.reviewed,
  ).toBe(true);
  expect(readStudyProgress(lessonProgressKey(changed.id, "01", "pin"))).toBeUndefined();
  view.unmount();
  saveStudyProgress(lessonProgressKey(curriculum.id, "01", "pin"), {
    cursor: 3,
    reviewed: false,
    updatedAt: 2,
  });
  render(
    <ThemeProvider>
      <CourseMap course={{ key: "12345678", curriculum, unavailable: ["01"] }} />
    </ThemeProvider>,
  );
  expect(screen.getByRole("link", { name: "Start lesson →" })).toHaveAttribute(
    "href",
    "#/replay/12345678%3Atwo",
  );
});
it("keeps standalone course links relative and offers a return to its companion library", () => {
  const linked = {
    ...curriculum,
    libraryFile: "index.html",
    chapters: curriculum.chapters.map((c) => ({
      ...c,
      lessons: c.lessons.map((l) => ({ ...l, exportFile: `lesson-${l.id}.html` })),
    })),
  };
  const view = render(
    <ThemeProvider>
      <CourseMap
        course={{ key: "", curriculum: linked, unavailable: [] }}
        exportBase="lessons/"
      />
    </ThemeProvider>,
  );
  expect(screen.getByRole("link", { name: "Start lesson →" })).toHaveAttribute(
    "href",
    "lessons/lesson-01.html",
  );
  view.unmount();
  render(
    <ThemeProvider>
      <Player replay={replay} study={{ curriculum: linked, lessonId: "01" }} />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Courses" }));
  expect(screen.getByRole("link", { name: "Full course map →" })).toHaveAttribute(
    "href",
    "index.html",
  );
  expect(screen.getByRole("link", { name: "Next lesson" })).toHaveAttribute(
    "href",
    "lesson-02.html",
  );
});

it("reveals large lesson lists in batches and searches beyond the first batch", () => {
  const many: Curriculum = {
    ...curriculum,
    chapters: [
      {
        ...curriculum.chapters[0]!,
        lessons: Array.from({ length: 100 }, (_, i) => ({
          id: String(i + 1),
          title: `Topic ${i + 1}`,
          goal: `Goal ${i + 1}`,
          replay: `lesson-${i + 1}`,
          prerequisites: [],
        })),
      },
    ],
  };
  const { container } = render(
    <ThemeProvider>
      <CourseMap course={{ curriculum: many, key: "12345678", unavailable: [] }} />
    </ThemeProvider>,
  );
  expect(container.querySelectorAll(".study-lessons > li")).toHaveLength(24);
  fireEvent.click(screen.getByRole("button", { name: /Show more lessons/ }));
  expect(container.querySelectorAll(".study-lessons > li")).toHaveLength(48);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Topic 100" } });
  expect(container.querySelectorAll(".study-lessons > li")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Topic 100" })).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  expect(container.querySelectorAll(".study-lessons > li")).toHaveLength(48);
});
