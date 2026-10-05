import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { Worker } from "node:worker_threads";

import type { Replay, ReplayRepo } from "@agent-replay/core";

import { findSession } from "./sessions.ts";

/** Where a captured session's repository is, and which commits it spans. */
export interface CapturedPlace {
  root: string;
  repo: ReplayRepo;
}

export interface WholeCapture {
  replay: Replay;
  root: string;
  warnings: string[];
}

export interface StreamerOptions {
  /** Told where each session's repository is, as soon as it is captured. */
  onCaptured?: (id: string, place: CapturedPlace) => void;
  /**
   * What identifies a session's log as it stands — when it is unchanged, a
   * finished stream is sent again rather than captured again. Defaults to
   * the log's modification time and size.
   */
  stampOf?: (id: string) => string | undefined;
}

/** Captures at once, across streams and whole captures: each holds a session in memory. */
const CONCURRENT = 2;
/** Finished streams kept for reopening, and the most bytes one may hold to be kept. */
const KEPT = 2;
const KEEP_BYTES = 96 * 1024 * 1024;

const defaultStamp = (id: string) => {
  const session = findSession(id, undefined, { exact: true });
  return session ? `${session.updatedAt}:${session.bytes}` : undefined;
};

function spawn(data: Record<string, unknown>) {
  const bundled = new URL("./capture-worker.mjs", import.meta.url);
  const source = new URL("./capture-worker.ts", import.meta.url);
  return new Worker(existsSync(bundled) ? bundled : source, { workerData: data });
}

/** Write lines with the response's backpressure; resolves when all are written or it closes. */
function replayLines(lines: readonly string[], response: ServerResponse) {
  let at = 0;
  let closed = false;
  response.on("close", () => {
    closed = true;
  });
  const pump = () => {
    while (!closed && at < lines.length) {
      if (!response.write(lines[at++]!)) {
        response.once("drain", pump);
        return;
      }
    }
    if (!closed) response.end();
  };
  pump();
}

/**
 * Live sessions, captured in a worker so the service keeps answering while
 * a long one is read. Bounded concurrency; closing the page terminates its
 * worker; a session opened again unchanged is sent from what was kept.
 */
export function sessionStreamer(
  repos: readonly string[],
  options: StreamerOptions = {},
) {
  let active = 0;
  const stampOf = options.stampOf ?? defaultStamp;
  const kept = new Map<string, { stamp: string; lines: string[] }>();
  const keep = (id: string, stamp: string, lines: string[]) => {
    kept.delete(id);
    kept.set(id, { stamp, lines });
    for (const key of kept.keys()) {
      if (kept.size <= KEPT) break;
      kept.delete(key);
    }
  };

  const stream = (id: string, response: ServerResponse) => {
    const stamp = stampOf(id);
    const earlier = kept.get(id);
    response.setHeader("Content-Type", "application/x-ndjson");
    response.setHeader("Cache-Control", "no-store");
    if (stamp && earlier?.stamp === stamp) {
      response.flushHeaders();
      replayLines(earlier.lines, response);
      return;
    }
    if (active >= CONCURRENT) {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          detail: "Two sessions are already loading. Retry when one finishes.",
        }),
      );
      return;
    }
    const worker = spawn({ id, repos, mode: "stream" });
    active++;
    response.flushHeaders();
    const first =
      JSON.stringify({ kind: "progress", message: "Locating session" }) + "\n";
    response.write(first);
    // What was sent, to send again if the session is reopened unchanged.
    let lines: string[] | undefined = stamp ? [first] : undefined;
    let bytes = first.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      active--;
      clearTimeout(timer);
      void worker.terminate();
    };
    const fail = (message: string) => {
      if (finished) return;
      lines = undefined;
      response.end(JSON.stringify({ kind: "error", message }) + "\n");
      finish();
    };
    const timer = setTimeout(
      () =>
        fail(
          "Session capture exceeded three minutes. Try saving the replay through the CLI.",
        ),
      180_000,
    );
    response.on("close", finish);
    worker.on(
      "message",
      (message: { line?: string; acknowledge?: boolean; captured?: CapturedPlace }) => {
        if (finished) return;
        if (message.captured) {
          options.onCaptured?.(id, message.captured);
          return;
        }
        const line = message.line!;
        if (lines) {
          if (line.startsWith('{"kind":"error"')) lines = undefined;
          else if (!line.startsWith('{"kind":"progress"')) {
            bytes += line.length;
            if (bytes > KEEP_BYTES) lines = undefined;
            else lines.push(line);
          }
        }
        const writable = response.write(line);
        if (!message.acknowledge) return;
        if (writable) worker.postMessage("next");
        else
          response.once("drain", () => {
            if (!finished) worker.postMessage("next");
          });
      },
    );
    worker.on("error", (error) =>
      fail(error instanceof Error ? error.message : String(error)),
    );
    worker.on("exit", (code) => {
      if (finished) return;
      if (code !== 0) fail(`Session capture exited (${code}).`);
      else {
        if (lines && stamp) keep(id, stamp, lines);
        response.end();
        finish();
      }
    });
  };

  /** The whole capture, off the event loop — for saving and exporting. */
  const capture = (id: string): Promise<WholeCapture> => {
    if (active >= CONCURRENT)
      return Promise.reject(
        new Error("Two sessions are already loading. Retry when one finishes."),
      );
    active++;
    const worker = spawn({ id, repos, mode: "replay" });
    return new Promise<WholeCapture>((resolve, reject) => {
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        active--;
        clearTimeout(timer);
        void worker.terminate();
        done();
      };
      const timer = setTimeout(
        () =>
          settle(() => reject(new Error("Session capture exceeded three minutes."))),
        180_000,
      );
      worker.on("message", (message: { result?: WholeCapture; error?: string }) => {
        if (message.result) {
          options.onCaptured?.(id, {
            root: message.result.root,
            repo: message.result.replay.repo,
          });
          settle(() => resolve(message.result!));
        } else settle(() => reject(new Error(message.error ?? "Capture failed.")));
      });
      worker.on("error", (error) => settle(() => reject(error)));
      worker.on("exit", (code) =>
        settle(() => reject(new Error(`Session capture exited (${code}).`))),
      );
    });
  };

  /** Drop what was kept of a session, so its next opening captures it afresh. */
  const forget = (id: string) => kept.delete(id);

  return Object.assign(stream, { capture, forget });
}
