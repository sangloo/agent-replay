// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { cleanProgress, mergeProgress, readProgress } from "./progress.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "progress-")), "progress.json");

it("keeps the newer of each entry and only positions under the player's keys", () => {
  const at = file();
  mergeProgress(
    {
      "replay:study:course-1:rev": { cursor: 3, reviewed: false, updatedAt: 10 },
      "replay:position:session-1": { cursor: 9, reviewed: false, updatedAt: 10 },
    },
    at,
  );
  const kept = mergeProgress(
    {
      "replay:study:course-1:rev": { cursor: 1, reviewed: false, updatedAt: 5 },
      "replay:position:session-1": {
        cursor: 12,
        furthest: 20,
        total: 40,
        reviewed: false,
        updatedAt: 20,
      },
    },
    at,
  );
  expect(kept["replay:study:course-1:rev"]?.cursor).toBe(3);
  expect(kept["replay:position:session-1"]).toEqual({
    cursor: 12,
    furthest: 20,
    total: 40,
    reviewed: false,
    updatedAt: 20,
  });
  expect(readProgress(at)).toEqual(kept);
});

it("drops anything that is not a position, and reads a damaged file as empty", () => {
  expect(
    cleanProgress({
      "replay:study:a:b": { cursor: 1, reviewed: true, updatedAt: 1, text: "secret" },
      theme: { cursor: 1, reviewed: true, updatedAt: 1 },
      "replay:position:x": { cursor: -1, reviewed: false, updatedAt: 1 },
      "replay:position:y": "not an object",
    }),
  ).toEqual({ "replay:study:a:b": { cursor: 1, reviewed: true, updatedAt: 1 } });
  const at = file();
  writeFileSync(at, "{ not json");
  expect(readProgress(at)).toEqual({});
  mergeProgress(
    { "replay:position:z": { cursor: 2, reviewed: false, updatedAt: 1 } },
    at,
  );
  expect(JSON.parse(readFileSync(at, "utf8")).progress).toHaveProperty(
    "replay:position:z",
  );
});
