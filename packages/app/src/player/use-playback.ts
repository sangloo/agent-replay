/**
 * The transport: where the replay is, and how it moves.
 *
 * `cursor` counts steps applied (0 is the base commit), exactly as
 * `@agent-replay/core`'s `play` and the timeline count. `progress` is
 * how far the step just applied has played: 0 is its first beat, 1 is
 * settled. A change's beats — mark, travel, type, hold — come from
 * `timelineOf`, the same timeline the code pane draws from, so the two can
 * never disagree about what a moment shows.
 *
 * The clock is a media clock, not decoration: `requestAnimationFrame`, paused
 * and resumed exactly where it stands, divided by the speed. That is why it
 * is not a CSS transition — a reduced-motion setting would land one at once,
 * and a replay whose typing vanished would be a replay of nothing. Reduced
 * motion is honoured where it is about motion: the code pane jumps rather
 * than glides when it follows the typing.
 *
 * Three modes: paused; playing, step after step; and stepping — `→` plays
 * the next step through its beats and stops, which is how a reviewer walks a
 * session change by change and still sees each one happen.
 */

import type { Frame } from "@agent-replay/core";
import * as React from "react";

import { timelineOf } from "./compose";

export const SPEEDS = [0.5, 1, 1.5, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Seconds at 1× for a step with no typing: long enough to read what the
 * caption shows, and no longer — a replay that sits still reads as stuck.
 */
function dwellSeconds(frame: Frame): number {
  const { step } = frame;
  switch (step.kind) {
    case "prompt":
      return Math.min(4, 1.4 + step.text.length / 350);
    case "say":
      return Math.min(3, 1 + step.text.length / 450);
    case "command":
      return step.failed ? 1.4 : 0.9;
    case "commit":
      return Math.min(3, 1.2 + (step.body ?? "").length / 500);
    case "lesson":
      return 2.5 + (step.goal ?? "").length / 60;
    case "explain":
      // Teaching text is read, not skimmed: about 200 words a minute.
      return Math.min(30, Math.max(2.5, step.text.split(/\s+/).length / 3.3));
    default:
      return 1;
  }
}

/** Whether a step plays as typing — the only kind worth finishing on →. */
export function isTyped(frame: Frame | undefined): boolean {
  if (frame && "sourceMode" in frame.step && frame.step.sourceMode === "included")
    return false;
  return Boolean(frame?.change?.applied && frame.change.hunks.length > 0);
}

/** How long a step plays at 1×, in seconds. */
export function stepSeconds(frame: Frame | undefined): number {
  if (!frame) return 1;
  return isTyped(frame) ? timelineOf(frame.change!).total : dwellSeconds(frame);
}

export type Mode = "paused" | "playing" | "stepping";

export interface Snapshot {
  cursor: number;
  progress: number;
  mode: Mode;
  playing: boolean;
  speed: Speed;
}

export class Engine {
  private state: Snapshot = {
    cursor: 0,
    progress: 1,
    mode: "paused",
    playing: false,
    speed: 1,
  };
  private raf = 0;
  private last = 0;
  private visible: readonly number[] = [];
  private readonly frames: readonly Frame[];
  private readonly durations = new Map<number, number>();
  private readonly emit: (snapshot: Snapshot) => void;

  constructor(
    frames: readonly Frame[],
    emit: (snapshot: Snapshot) => void,
    initial = 0,
  ) {
    this.frames = frames;
    this.emit = emit;
    this.state.cursor = Math.max(0, Math.min(frames.length, initial));
  }

  private set(patch: Partial<Snapshot>) {
    const mode = patch.mode ?? this.state.mode;
    this.state = { ...this.state, ...patch, mode, playing: mode === "playing" };
    this.emit(this.state);
  }

  private duration(cursor: number): number {
    let seconds = this.durations.get(cursor);
    if (seconds === undefined) {
      seconds = stepSeconds(this.frames[cursor - 1]);
      this.durations.set(cursor, seconds);
    }
    return seconds;
  }

  /** The cursor after the next visible step, or undefined at the end. */
  private next(): number | undefined {
    const index = this.visible.find((i) => i >= this.state.cursor);
    return index === undefined ? undefined : index + 1;
  }

  private previous(): number {
    const index = this.visible.filter((i) => i + 1 < this.state.cursor).at(-1);
    return index === undefined ? 0 : index + 1;
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private run() {
    this.stop();
    this.last = performance.now();
    const tick = (now: number) => {
      const seconds = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const { cursor, speed, mode } = this.state;
      const progress = this.state.progress + (seconds * speed) / this.duration(cursor);
      if (progress < 1) {
        this.set({ progress });
        this.raf = requestAnimationFrame(tick);
        return;
      }
      const next = mode === "playing" ? this.next() : undefined;
      if (next === undefined) {
        this.raf = 0;
        this.set({ progress: 1, mode: "paused" });
        return;
      }
      this.set({ cursor: next, progress: 0 });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setVisible(visible: readonly number[]) {
    this.visible = visible;
  }

  /** Go to a cursor, settled and paused. */
  jump(cursor: number) {
    this.stop();
    this.set({
      cursor: Math.max(0, Math.min(this.frames.length, cursor)),
      progress: 1,
      mode: "paused",
    });
  }

  /**
   * Play one step: finish the one on screen if it is still playing, else
   * play the next through its beats. While playing, skip to the next step.
   */
  forward() {
    const { progress, mode } = this.state;
    if (mode === "playing") {
      const next = this.next();
      if (next === undefined) return;
      this.set({ cursor: next, progress: 0 });
      return;
    }
    // Mid-typing, → finishes the change on screen; anywhere else it moves
    // on at once — a caption being read is not something to wait out.
    if (progress < 1 && isTyped(this.frames[this.state.cursor - 1])) {
      this.stop();
      this.set({ progress: 1, mode: "paused" });
      return;
    }
    const next = this.next();
    if (next === undefined) return;
    this.set({ cursor: next, progress: 0, mode: "stepping" });
    this.run();
  }

  back() {
    this.jump(this.previous());
  }

  /** Pause where it stands; play on from there. */
  toggle() {
    if (this.state.mode !== "paused") {
      this.stop();
      this.set({ mode: "paused" });
      return;
    }
    if (this.state.progress >= 1) {
      const next = this.next();
      // At the end, play from the beginning.
      this.set(
        next === undefined
          ? {
              cursor: this.visible[0] === undefined ? 0 : this.visible[0] + 1,
              progress: 0,
            }
          : { cursor: next, progress: 0 },
      );
    }
    this.set({ mode: "playing" });
    this.run();
  }

  /** Takes effect at once, mid-step included. */
  setSpeed(speed: Speed) {
    this.set({ speed });
  }

  destroy() {
    this.stop();
  }
}

export interface Transport extends Snapshot {
  jump: (cursor: number) => void;
  forward: () => void;
  back: () => void;
  toggle: () => void;
  setSpeed: (speed: Speed) => void;
}

export function usePlayback(
  frames: readonly Frame[],
  visible: readonly number[],
  /** The cursor to open on. */
  initial = 0,
): Transport {
  const [snapshot, setSnapshot] = React.useState<Snapshot>({
    cursor: Math.max(0, Math.min(frames.length, initial)),
    progress: 1,
    mode: "paused",
    playing: false,
    speed: 1,
  });
  const [engine] = React.useState(() => new Engine(frames, setSnapshot, initial));
  React.useEffect(() => engine.setVisible(visible), [engine, visible]);
  React.useEffect(() => () => engine.destroy(), [engine]);

  // The actions keep their identity for the engine's life, so components
  // handed one do not re-render on every frame of typing.
  const actions = React.useMemo(
    () => ({
      jump: (cursor: number) => engine.jump(cursor),
      forward: () => engine.forward(),
      back: () => engine.back(),
      toggle: () => engine.toggle(),
      setSpeed: (speed: Speed) => engine.setSpeed(speed),
    }),
    [engine],
  );
  return React.useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);
}
