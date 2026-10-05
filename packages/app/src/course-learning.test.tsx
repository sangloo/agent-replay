import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { Curriculum, Replay } from "@agent-replay/core";
import { ThemeProvider } from "@/ui";
import { Player } from "./player/player";
import { CourseMap } from "./course-library";
import {
  lessonProgressKey,
  readStudyProgress,
  replayProgressKey,
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
it("resumes saved steps, honors explicit deep links, and completes a lesson at its end", () => {
  const key = lessonProgressKey("test-course", "01", "pin");
  saveStudyProgress(key, { cursor: 2, reviewed: false, updatedAt: 1, total: 4 });
  const view = render(
    <ThemeProvider>
      <Player replay={replay} study={study} />
    </ThemeProvider>,
  );
  expect(window.location.hash).toContain("at=2");
  expect(screen.getByText(/Picked up where you left off/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Speed" })).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark as done" }).closest("footer"),
  ).not.toBeNull();
  expect(
    screen.getByRole("link", { name: "Next lesson" }).closest("footer"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next explanation →" }));
  expect(window.location.hash).toContain("at=3");
  expect(readStudyProgress(key)?.reviewed).toBe(false);
  // The last explanation is the end of the lesson: reaching it completes it.
  fireEvent.click(screen.getByRole("button", { name: "Next explanation →" }));
  expect(window.location.hash).toContain("at=4");
  expect(readStudyProgress(key)).toMatchObject({
    reviewed: true,
    furthest: 4,
    total: 4,
  });
  expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("Lesson complete")).toBeInTheDocument();
  // Marked not done by hand, it stays so, even standing at the end.
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(readStudyProgress(key)?.reviewed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
  expect(readStudyProgress(key)?.reviewed).toBe(true);
  view.unmount();
  render(
    <ThemeProvider>
      <Player replay={replay} study={study} at={2} />
    </ThemeProvider>,
  );
  expect(window.location.hash).toContain("at=2");
  expect(screen.queryByText(/Picked up where you left off/)).toBeNull();
  expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  cleanup();
});
it("counts a lesson left at its end before lessons completed themselves as done", () => {
  const key = lessonProgressKey("test-course", "01", "pin");
  saveStudyProgress(key, { cursor: 4, reviewed: false, updatedAt: 1 });
  render(
    <ThemeProvider>
      <Player replay={replay} study={study} />
    </ThemeProvider>,
  );
  expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(readStudyProgress(key)?.reviewed).toBe(true);
  cleanup();
});
it("keeps a course's progress under the replay too, for lists that do not know the curriculum", () => {
  render(
    <ThemeProvider>
      <Player replay={replay} study={study} at={3} />
    </ThemeProvider>,
  );
  expect(readStudyProgress(replayProgressKey("one", "pin"))).toMatchObject({
    cursor: 3,
    total: 4,
  });
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
  fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
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
