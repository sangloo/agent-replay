import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Replay } from "@agent-replay/core";
import { ThemeProvider } from "@/ui";
import { positionKey, readStudyProgress } from "../study-progress";
import { Player } from "./player";

it("opens a future source excerpt and returns to the explanation without a repository", () => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
  const base = { at: "2026-09-28T00:00:00Z", agent: "main", turn: 0 };
  const replay: Replay = {
    version: 1,
    id: "navigation",
    title: "Navigation",
    source: "course",
    startedAt: base.at,
    endedAt: base.at,
    repo: { name: "r", commits: [] },
    files: {},
    omitted: [],
    notes: {},
    course: { rev: "pin", sources: { "a.go": { lineCount: 9, sha256: "hash" } } },
    steps: [
      { ...base, id: "lesson", kind: "lesson", title: "Exact coordinates" },
      {
        ...base,
        id: "intro",
        kind: "explain",
        text: "Read [Target](source:a.go#L8-L9).",
      },
      {
        ...base,
        id: "code",
        kind: "write",
        path: "a.go",
        content: "func Target() {\n}\n",
        sourceLines: [[8, 9]],
      },
      { ...base, id: "next", kind: "explain", text: "After the definition." },
    ],
  };
  render(
    <ThemeProvider>
      <Player replay={replay} at={2} />
    </ThemeProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Go to Target, original lines 8–9" }),
  );
  expect(window.location.hash).toContain("at=3");
  const back = screen.getByRole("button", { name: "Return to explanation" });
  expect(back.parentElement).toHaveTextContent(/original.*8.*9.*replay.*1.*2/i);
  fireEvent.click(back);
  expect(window.location.hash).toContain("at=2");
  expect(screen.queryByRole("button", { name: "Return to explanation" })).toBeNull();
});

it("reopens a session where it was left, and offers the start", async () => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/session/s1");
  Element.prototype.scrollIntoView = () => {};
  const base = { at: "2026-09-28T00:00:00Z", agent: "main", turn: 0 };
  const replay: Replay = {
    version: 1,
    id: "s1",
    title: "Resume",
    source: "claude-code",
    startedAt: base.at,
    endedAt: base.at,
    repo: { name: "r", commits: [] },
    files: { "a.ts": "one\n" },
    omitted: [],
    notes: {},
    steps: [
      { ...base, id: "p", kind: "prompt", text: "Change it twice." },
      ...[1, 2, 3].map((n) => ({
        ...base,
        id: `e${n}`,
        kind: "write" as const,
        path: "a.ts",
        content: `${"one\n".repeat(n)}two\n`,
      })),
      { ...base, id: "q", kind: "prompt", text: "Then once more." },
      { ...base, id: "e4", kind: "write", path: "a.ts", content: "done\n" },
    ],
  };
  const first = render(
    <ThemeProvider>
      <Player replay={replay} at={3} />
    </ThemeProvider>,
  );
  // The other turn is one line; this one lists its changes.
  expect(screen.getByText(/Then once more/).closest("section")).toHaveTextContent(
    "1 change",
  );
  expect(readStudyProgress(positionKey("s1"))).toMatchObject({ cursor: 3, total: 6 });
  first.unmount();
  render(
    <ThemeProvider>
      <Player replay={replay} />
    </ThemeProvider>,
  );
  expect(window.location.hash).toContain("at=3");
  fireEvent.click(screen.getByRole("button", { name: "Start from the beginning" }));
  expect(window.location.hash).not.toContain("at=");
});
