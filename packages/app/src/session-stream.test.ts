import { afterEach, expect, it, vi } from "vitest";
import { streamSession } from "./api";

afterEach(() => vi.unstubAllGlobals());
const header = {
  kind: "header",
  replay: {
    id: "s",
    title: "Session",
    version: 1,
    source: "codex",
    repo: { name: "repo", commits: [] },
    notes: {},
    omitted: [],
    startedAt: "",
    endedAt: "",
  },
  total: 1,
  fileTotal: 1,
  repo: "repo",
  warnings: [],
};
function response(events: unknown[]) {
  const bytes = new TextEncoder().encode(
    events.map((event) => JSON.stringify(event) + "\n").join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        // Arbitrary transport boundaries, including inside UTF-8 characters.
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
  );
}
it("reassembles bounded stream records with exact Unicode source and steps", async () => {
  const step = { kind: "say", text: "héllo", id: "a", at: "", agent: "main", turn: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response([
        { kind: "progress", message: "Reading" },
        header,
        { kind: "files", items: [["a.ts", "é\n"]] },
        { kind: "steps", items: [step] },
        { kind: "done" },
      ]),
    ),
  );
  const update = vi.fn();
  const result = await streamSession("s", update, new AbortController().signal);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.replay.files).toEqual({ "a.ts": "é\n" });
    expect(result.data.replay.steps).toEqual([step]);
  }
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ message: "Reading" }));
});
it("rejects truncated captures rather than presenting a partial replay as complete", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response([header, { kind: "done" }])),
  );
  const result = await streamSession("s", () => {}, new AbortController().signal);
  expect(result.ok).toBe(false);
});
