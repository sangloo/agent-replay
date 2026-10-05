import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { play, type Replay } from "@agent-replay/core";
import { StepList } from "./steps";

it("mounts a bounded step window for very long histories and keeps distant steps accessible", () => {
  const replay: Replay = {
    version: 1,
    id: "large",
    title: "large",
    source: "codex",
    startedAt: "",
    endedAt: "",
    repo: { name: "r", commits: [] },
    files: {},
    notes: {},
    omitted: [],
    steps: Array.from({ length: 13100 }, (_, i) => ({
      kind: "say",
      id: String(i),
      text: `Reply ${i}`,
      at: "",
      agent: "main",
      turn: 0,
    })),
  };
  const playback = play(replay),
    jump = vi.fn();
  const { container } = render(
    <StepList
      replay={replay}
      frames={playback.frames}
      visible={playback.frames.map((f) => f.index)}
      cursor={0}
      onJump={jump}
    />,
  );
  expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100);
  const tree = container.querySelector('[role="tree"]')!;
  fireEvent.scroll(tree, { target: { scrollTop: 320000 } });
  expect(container.textContent).toContain("10001.");
  expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100);
});
