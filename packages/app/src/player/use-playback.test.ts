import { play, type Replay } from "@agent-replay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Engine, isTyped, stepSeconds, type Snapshot } from "./use-playback";

const replay: Replay = {
  version: 1,
  id: "r",
  title: "t",
  source: "claude-code",
  startedAt: "2026-01-01T00:00:00Z",
  endedAt: "2026-01-01T00:01:00Z",
  repo: { name: "repo", dirty: false, commits: [] },
  files: { "a.ts": "one\ntwo\nthree\n" },
  omitted: [],
  notes: {},
  steps: [
    {
      kind: "edit",
      id: "e1",
      at: "2026-01-01T00:00:10Z",
      agent: "main",
      turn: 0,
      path: "a.ts",
      oldString: "two",
      newString: "TWO",
      replaceAll: false,
    },
    {
      kind: "edit",
      id: "e2",
      at: "2026-01-01T00:00:20Z",
      agent: "main",
      turn: 0,
      path: "a.ts",
      oldString: "three",
      newString: "THREE",
      replaceAll: false,
    },
  ],
};

describe("the playback clock", () => {
  it("imports completeness material without a long typing animation", () => {
    const full: Replay = {
      ...replay,
      steps: [
        {
          ...replay.steps[0]!,
          kind: "write",
          path: "a.ts",
          content: "reference\n".repeat(1000),
          sourceMode: "included",
        },
      ],
    };
    const frame = play(full).frames[0];
    expect(isTyped(frame)).toBe(false);
    expect(stepSeconds(frame)).toBe(1);
  });
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
  });
  afterEach(() => vi.useRealTimers());

  const engine = () => {
    const { frames } = play(replay);
    let last: Snapshot | undefined;
    const clock = new Engine(frames, (snapshot) => (last = snapshot));
    clock.setVisible(frames.map((frame) => frame.index));
    return { clock, now: () => last!, frames };
  };

  it("pauses mid-change and plays on from exactly there", () => {
    const { clock, now, frames } = engine();
    clock.toggle();
    vi.advanceTimersByTime(stepSeconds(frames[0]) * 400);
    clock.toggle();
    const held = now();
    expect(held.mode).toBe("paused");
    expect(held.cursor).toBe(1);
    expect(held.progress).toBeGreaterThan(0.2);
    expect(held.progress).toBeLessThan(0.6);
    vi.advanceTimersByTime(5000);
    expect(now().progress).toBe(held.progress);
    clock.toggle();
    vi.advanceTimersByTime(50);
    expect(now().progress).toBeGreaterThan(held.progress);
  });

  it("→ finishes the step playing, then plays exactly one more", () => {
    const { clock, now, frames } = engine();
    clock.forward();
    expect(now()).toMatchObject({ cursor: 1, progress: 0, mode: "stepping" });
    clock.forward();
    expect(now()).toMatchObject({ cursor: 1, progress: 1, mode: "paused" });
    clock.forward();
    vi.advanceTimersByTime(stepSeconds(frames[1]) * 1000 + 200);
    expect(now()).toMatchObject({ cursor: 2, progress: 1, mode: "paused" });
  });

  it("runs faster at a higher speed, from the moment it is set", () => {
    const { clock, now, frames } = engine();
    clock.toggle();
    vi.advanceTimersByTime(100);
    const before = now().progress;
    clock.setSpeed(4);
    vi.advanceTimersByTime(100);
    const after = now().progress;
    expect(after - before).toBeGreaterThan(3 * before * 0.8);
    expect(stepSeconds(frames[0])).toBeGreaterThan(1.5);
  });
  it("moves straight past a step with nothing to type, rather than waiting it out", () => {
    const talky: Replay = {
      ...replay,
      steps: [
        {
          kind: "prompt",
          id: "p1",
          at: "2026-01-01T00:00:01Z",
          agent: "main",
          turn: 0,
          text: "Rename the second line.",
        },
        ...replay.steps,
      ],
    };
    const { frames } = play(talky);
    let last: Snapshot | undefined;
    const clock = new Engine(frames, (snapshot) => (last = snapshot));
    clock.setVisible(frames.map((frame) => frame.index));
    clock.forward();
    expect(last).toMatchObject({ cursor: 1, mode: "stepping" });
    // Still reading the prompt: → goes on to the edit and plays it.
    clock.forward();
    expect(last).toMatchObject({ cursor: 2, progress: 0, mode: "stepping" });
    // Mid-typing, → finishes the edit instead.
    vi.advanceTimersByTime(100);
    clock.forward();
    expect(last).toMatchObject({ cursor: 2, progress: 1, mode: "paused" });
  });
});
