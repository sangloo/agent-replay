import { beforeEach, expect, it, vi } from "vitest";
import {
  courseProgress,
  fractionOf,
  furthestOf,
  listedProgress,
  positionKey,
  readStudyProgress,
  replayProgressKey,
  saveStudyProgress,
  lessonProgressKey,
} from "./study-progress";
beforeEach(() => localStorage.clear());
it("separates course, lesson and source revision and ignores malformed storage", () => {
  const key = lessonProgressKey("course", "01", "pin");
  saveStudyProgress(key, { cursor: 7, reviewed: false, updatedAt: 1 });
  saveStudyProgress(lessonProgressKey("course", "01", "old"), {
    cursor: 99,
    reviewed: true,
    updatedAt: 2,
  });
  expect(courseProgress("course", "pin")).toEqual({
    "01": { cursor: 7, reviewed: false, updatedAt: 1 },
  });
  expect(courseProgress("another", "pin")).toEqual({});
  localStorage.setItem(key, '{"cursor":-2,"reviewed":true,"updatedAt":4}');
  expect(readStudyProgress(key)).toBeUndefined();
  localStorage.setItem(key, "not json");
  expect(readStudyProgress(key)).toBeUndefined();
});
it("continues without storage permission", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(readStudyProgress("key")).toBeUndefined();
  expect(() =>
    saveStudyProgress("key", { cursor: 1, reviewed: false, updatedAt: 1 }),
  ).not.toThrow();
  get.mockRestore();
  set.mockRestore();
});
it("finds a listed replay's progress, and says how far along it is", () => {
  saveStudyProgress(replayProgressKey("course-1", "rev"), {
    cursor: 3,
    furthest: 8,
    total: 10,
    reviewed: false,
    updatedAt: 1,
  });
  saveStudyProgress(positionKey("session-1"), {
    cursor: 5,
    total: 20,
    reviewed: false,
    updatedAt: 1,
  });
  const course = listedProgress({
    agent: "course",
    id: "key:name",
    replayId: "course-1",
    revision: "rev",
  });
  expect(fractionOf(course, 10)).toBe(0.8);
  const session = listedProgress({ agent: "claude-code", id: "session-1" });
  expect(fractionOf(session)).toBe(0.25);
  expect(fractionOf({ ...session!, reviewed: true })).toBe(1);
  expect(fractionOf(undefined, 10)).toBe(0);
  // A save from before totals were kept still counts how far it got.
  expect(furthestOf({ cursor: 4, reviewed: false, updatedAt: 1 })).toBe(4);
});
