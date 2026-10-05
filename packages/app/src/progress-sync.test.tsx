import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  theirs: {} as Record<string, unknown>,
  saved: [] as { entries: Record<string, unknown>; keepalive: boolean }[],
}));
vi.mock("./api", () => ({
  api: {
    progress: async () => ({ ok: true, data: calls.theirs }),
    saveProgress: async (entries: Record<string, unknown>, keepalive = false) => {
      calls.saved.push({ entries, keepalive });
      return { ok: true, data: { kept: 0 } };
    },
  },
}));

import { useProgressSync } from "./progress-sync";
import { positionKey, readStudyProgress, saveStudyProgress } from "./study-progress";

function Probe({ onState }: { onState: (state: { ready: boolean }) => void }) {
  onState(useProgressSync());
  return null;
}

beforeEach(() => {
  localStorage.clear();
  calls.saved.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("takes in newer progress from the service, and sends what only this browser knows", async () => {
  saveStudyProgress(positionKey("mine"), { cursor: 4, reviewed: false, updatedAt: 5 });
  saveStudyProgress(positionKey("both"), { cursor: 1, reviewed: false, updatedAt: 1 });
  calls.theirs = {
    [positionKey("both")]: { cursor: 30, reviewed: false, updatedAt: 9 },
    [positionKey("theirs")]: { cursor: 7, reviewed: true, updatedAt: 3 },
  };
  let state = { ready: false };
  render(<Probe onState={(next) => (state = next)} />);
  await act(async () => {});
  expect(state.ready).toBe(true);
  expect(readStudyProgress(positionKey("both"))?.cursor).toBe(30);
  expect(readStudyProgress(positionKey("theirs"))?.reviewed).toBe(true);
  expect(calls.saved).toHaveLength(1);
  expect(Object.keys(calls.saved[0]!.entries)).toEqual([positionKey("mine")]);
});

it("sends saves together, and the last of them as the page closes", async () => {
  calls.theirs = {};
  const view = render(<Probe onState={() => {}} />);
  await act(async () => {});
  calls.saved.length = 0;
  saveStudyProgress(positionKey("a"), { cursor: 1, reviewed: false, updatedAt: 10 });
  saveStudyProgress(positionKey("a"), { cursor: 2, reviewed: false, updatedAt: 11 });
  expect(calls.saved).toHaveLength(0);
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(calls.saved).toHaveLength(1);
  expect(calls.saved[0]!.entries[positionKey("a")]).toMatchObject({ cursor: 2 });
  saveStudyProgress(positionKey("b"), { cursor: 5, reviewed: false, updatedAt: 12 });
  window.dispatchEvent(new Event("pagehide"));
  expect(calls.saved.at(-1)).toMatchObject({ keepalive: true });
  view.unmount();
});
