import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudyCourse } from "@agent-replay/core";
import { ThemeProvider } from "@/ui";

const calls = vi.hoisted(() => ({
  curricula: [] as string[],
  replays: [] as string[],
}));
const course: StudyCourse = {
  key: "12345678",
  unavailable: [],
  curriculum: {
    version: 1,
    id: "app",
    revision: "pin",
    title: "Understand the app",
    description: "From nothing.",
    chapters: [
      {
        id: "first",
        title: "First",
        description: "Start.",
        lessons: [
          { id: "01", title: "One", goal: "Begin.", replay: "one", prerequisites: [] },
        ],
      },
    ],
  },
};
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  api: {
    curricula: async (query = "") => {
      calls.curricula.push(query);
      return { ok: true, data: { courses: [course], problems: [] } };
    },
    replays: async (query: string) => {
      calls.replays.push(query);
      return {
        ok: true,
        data: { items: [], total: 0, offset: 0, limit: 100, agents: {}, projects: {} },
      };
    },
    projects: async () => ({
      ok: true,
      data: [{ root: "/code/app", name: "app", sessions: 0, saved: 1, added: true }],
    }),
  },
}));

import { CourseLibrary } from "./course-library";

beforeEach(() => {
  localStorage.clear();
  calls.curricula.length = 0;
  calls.replays.length = 0;
});
afterEach(cleanup);

it("lists the chosen project's courses, and keeps the project across tabs and maps", async () => {
  render(
    <ThemeProvider>
      <CourseLibrary project="/code/app" onProject={() => {}} />
    </ThemeProvider>,
  );
  const map = await screen.findByRole("link", { name: /Understand the app/ });
  expect(calls.curricula).toEqual(["project=%2Fcode%2Fapp"]);
  expect(new URLSearchParams(calls.replays[0]).get("project")).toBe("/code/app");
  expect(map).toHaveAttribute("href", "#/learn/12345678?project=%2Fcode%2Fapp");
  expect(screen.getByRole("link", { name: "Saved" })).toHaveAttribute(
    "href",
    "#/?tab=saved&project=%2Fcode%2Fapp",
  );
  expect(await screen.findByRole("button", { name: /app/ })).toBeInTheDocument();
});

it("opens a map by its own key, and goes back to the project's list", async () => {
  render(
    <ThemeProvider>
      <CourseLibrary courseKey="12345678" project="/code/app" onProject={() => {}} />
    </ThemeProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Understand the app" }),
  ).toBeInTheDocument();
  expect(calls.curricula).toEqual(["key=12345678"]);
  expect(screen.getByRole("link", { name: "All courses" })).toHaveAttribute(
    "href",
    "#/learn?project=%2Fcode%2Fapp",
  );
});

it("lists every project's courses when none is chosen", async () => {
  render(
    <ThemeProvider>
      <CourseLibrary project="" onProject={() => {}} />
    </ThemeProvider>,
  );
  await screen.findByRole("link", { name: /Understand the app/ });
  expect(calls.curricula).toEqual([""]);
  expect(new URLSearchParams(calls.replays[0]).has("project")).toBe(false);
  expect(screen.getByRole("link", { name: /Understand the app/ })).toHaveAttribute(
    "href",
    "#/learn/12345678",
  );
});
