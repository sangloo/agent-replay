import { beforeEach, expect, it, vi } from "vitest";
import {
  courseProgress,
  readStudyProgress,
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
