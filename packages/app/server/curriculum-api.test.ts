// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, expect, it, vi } from "vitest";
import type { Replay, StudyContext } from "@agent-replay/core";
import { createHandler } from "./api.ts";
import { idKey } from "./store.ts";
vi.mock("./sessions.ts", () => ({
  listSessions: () => [],
  findSession: () => undefined,
}));
vi.mock("./projects.ts", async (original) => ({
  ...(await original<object>()),
  readAdded: () => [],
}));
vi.mock("./export.ts", () => ({
  hasPlayer: () => true,
  exportHtml: (replay: Replay, _dist: unknown, study?: StudyContext) =>
    JSON.stringify({ replay, study }),
}));
const root = realpathSync(mkdtempSync(join(tmpdir(), "replay-map-api-")));
mkdirSync(join(root, ".replays"));
const manifest = {
  version: 1,
  id: "test",
  revision: "edition",
  title: "Test",
  description: "Learn",
  libraryFile: "index.html",
  chapters: [
    {
      id: "first",
      title: "First",
      description: "Start",
      lessons: [
        {
          id: "01",
          title: "One",
          goal: "Learn",
          replay: "one",
          prerequisites: [],
          exportFile: "one.html",
        },
        {
          id: "02",
          title: "Two",
          goal: "Continue",
          replay: "two",
          prerequisites: ["01"],
          exportFile: "two.html",
        },
      ],
    },
  ],
};
writeFileSync(
  join(root, ".replays/one.json"),
  JSON.stringify({
    version: 1,
    id: "one",
    title: "One",
    source: "course",
    startedAt: "2026-01-01",
    endedAt: "2026-01-01",
    repo: { name: "test", commits: [] },
    files: {},
    steps: [],
    omitted: [],
    notes: {},
  }),
);
const handler = createHandler({ repos: [root] });
async function request(url: string) {
  let body = "";
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    end: (value: string) => {
      body = value;
    },
  };
  await handler(
    { method: "GET", url, headers: {} } as IncomingMessage,
    response as unknown as ServerResponse,
    () => {},
  );
  return { status: response.statusCode, headers, body: JSON.parse(body) };
}
afterAll(() => rmSync(root, { recursive: true, force: true }));
it("exposes missing lessons and exports a named companion with its navigation", async () => {
  writeFileSync(join(root, ".replays/curriculum.manifest"), JSON.stringify(manifest));
  const catalog = await request("/curricula");
  expect(catalog.status).toBe(200);
  expect(catalog.body.data.courses[0].unavailable).toEqual(["02"]);
  const exported = await request(`/replays/${idKey(root)}:one/export`);
  expect(exported.headers["Content-Disposition"]).toBe(
    'attachment; filename="one.html"',
  );
  expect(exported.body.study).toEqual({ curriculum: manifest, lessonId: "01" });
});
it("reports malformed optional maps while preserving plain replay exports", async () => {
  writeFileSync(join(root, ".replays/curriculum.manifest"), "{}");
  const catalog = await request("/curricula");
  expect(catalog.body.data.courses).toEqual([]);
  expect(catalog.body.data.problems).toHaveLength(1);
  const exported = await request(`/replays/${idKey(root)}:one/export`);
  expect(exported.status).toBe(200);
  expect(exported.body.study).toBeUndefined();
});

it("loads course navigation without parsing replay bodies and offers cheap change detection", async () => {
  writeFileSync(join(root, ".replays/curriculum.manifest"), JSON.stringify(manifest));
  // A corrupt body must not take down the entire course map.
  writeFileSync(join(root, ".replays/two.json"), "not valid JSON");
  const catalog = await request("/curricula");
  expect(catalog.body.data.courses[0].unavailable).toEqual([]);
  const before = await request(`/replays/${idKey(root)}:two/stamp`);
  expect(before.status).toBe(200);
  writeFileSync(join(root, ".replays/two.json"), "a different body");
  const after = await request(`/replays/${idKey(root)}:two/stamp`);
  expect(after.body.data.stamp).not.toBe(before.body.data.stamp);
  expect((await request(`/replays/${idKey(root)}:missing/stamp`)).status).toBe(404);
});
