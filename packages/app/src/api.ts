/**
 * The player's client for the local service in `server/api.ts`. Every call
 * answers a result, never throws: `{ ok: true, data }` or `{ ok: false,
 * failure }` with a sentence a person can read. A request that takes too
 * long is abandoned with a message that says so, rather than spinning.
 */

import type { Replay, StudyCatalog } from "@agent-replay/core";

import type { StudyProgress } from "./study-progress";
import * as React from "react";

import type {
  FolderListing,
  LiveReplay,
  Page,
  Project,
  RepoFile,
  RepoTree,
  SavedListing,
  SessionListing,
} from "../server/api.ts";

export type {
  FolderListing,
  LiveReplay,
  Page,
  Project,
  RepoFile,
  RepoTree,
  SavedListing,
  SessionListing,
};

export interface Failure {
  /** The HTTP status, when the service answered at all. */
  status?: number;
  code?: string;
  /** What went wrong, in a sentence. */
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: Failure };

/** Where a replay in the player came from, for asking about its repository. */
export interface ReplaySource {
  kind: "replays" | "sessions";
  id: string;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

// Listings answer in well under a second; a live capture reads a whole
// session log and asks git about every file it touched.
const TIMEOUT = { quick: 30_000, slow: 180_000 } as const;

async function call<T>(
  method: Method,
  path: string,
  body?: unknown,
  timeout: keyof typeof TIMEOUT = "quick",
  /** Finish even if the page is closing — the last save of a position. */
  keepalive = false,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT[timeout]);
  try {
    // The one place the player reaches the network.
    const response = await fetch(path, {
      method,
      keepalive,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Request-ID": crypto.randomUUID(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const envelope = (json ?? {}) as { data?: T; detail?: string; code?: string };
    if (!response.ok) {
      return {
        ok: false,
        failure: {
          status: response.status,
          code: envelope.code,
          message:
            envelope.detail ||
            (response.status === 404
              ? "Not found."
              : `The replay service answered ${response.status}.`),
        },
      };
    }
    return { ok: true, data: envelope.data as T };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      failure: {
        code: aborted ? "timeout" : "network",
        message: aborted
          ? `No answer after ${TIMEOUT[timeout] / 1000} seconds. The session may be very large — try again, or capture it with \`replay capture\` and open the saved copy.`
          : "Could not reach the replay service. Is `replay` still running?",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

const sourcePath = ({ kind, id }: ReplaySource) =>
  `/api/${kind}/${encodeURIComponent(id)}`;

/** Titles the lists have shown, so a replay that is still loading can be named. */
const titles = new Map<string, string>();
export const rememberTitle = (id: string, title: string) => titles.set(id, title);
export const knownTitle = (id: string) => titles.get(id);

export const api = {
  replayStamp: (id: string) =>
    call<{ stamp: string }>("GET", `/api/replays/${encodeURIComponent(id)}/stamp`),
  curricula: () => call<StudyCatalog>("GET", "/api/curricula"),
  /** Where the reader is in each replay, as the local service keeps it. */
  progress: () => call<Record<string, StudyProgress>>("GET", "/api/progress"),
  saveProgress: (entries: Record<string, StudyProgress>, keepalive = false) =>
    call<{ kept: number }>("PUT", "/api/progress", { entries }, "quick", keepalive),
  projects: () => call<Project[]>("GET", "/api/projects"),
  addProject: (path: string) => call<Project>("POST", "/api/projects", { path }),
  forgetProject: (root: string) =>
    call<{ removed: string }>(
      "DELETE",
      `/api/projects?${new URLSearchParams({ root })}`,
    ),
  folders: (path?: string) =>
    call<FolderListing>(
      "GET",
      `/api/folders${path ? `?${new URLSearchParams({ path })}` : ""}`,
    ),
  /** `query` is a search string: `q=…&agent=…&offset=…&limit=…`. */
  replays: (query: string) => call<Page<SavedListing>>("GET", `/api/replays?${query}`),
  replay: (id: string) =>
    call<Replay>("GET", `/api/replays/${encodeURIComponent(id)}`, undefined, "slow"),
  sessions: (query: string) =>
    call<Page<SessionListing>>("GET", `/api/sessions?${query}`),
  tree: (source: ReplaySource) =>
    call<RepoTree>("GET", `${sourcePath(source)}/tree`, undefined, "slow"),
  file: (source: ReplaySource, rev: string, path: string) =>
    call<RepoFile>(
      "GET",
      `${sourcePath(source)}/file?${new URLSearchParams({ rev, path })}`,
    ),
  session: (id: string) =>
    call<LiveReplay>(
      "GET",
      `/api/sessions/${encodeURIComponent(id)}`,
      undefined,
      "slow",
    ),
  save: (id: string) =>
    call<{ id?: string; file: string }>(
      "POST",
      `/api/sessions/${encodeURIComponent(id)}/save`,
      undefined,
      "slow",
    ),
};

export type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "failed"; failure: Failure; message: string };

/**
 * Load once per `key`. `load` must be stable (the `api` functions are), and
 * an answer for a key that is no longer current is dropped.
 */
export function useLoad<T>(
  key: string,
  load: (key: string) => Promise<ApiResult<T>>,
): Loaded<T> {
  const [settled, setSettled] = React.useState<{ key: string; loaded: Loaded<T> }>();
  React.useEffect(() => {
    let current = true;
    void load(key).then((result) => {
      if (!current) return;
      setSettled({
        key,
        loaded: result.ok
          ? { state: "ready", data: result.data }
          : {
              state: "failed",
              failure: result.failure,
              message: result.failure.message,
            },
      });
    });
    return () => {
      current = false;
    };
  }, [key, load]);
  return settled?.key === key ? settled.loaded : { state: "loading" };
}

export interface SessionProgress {
  message: string;
  title?: string;
  preview?: string;
  loaded?: number;
  total?: number;
}

/** NDJSON avoids a single enormous JSON.parse and exposes capture/transfer progress. */
export async function streamSession(
  id: string,
  onProgress: (progress: SessionProgress) => void,
  signal: AbortSignal,
): Promise<ApiResult<LiveReplay>> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/stream`, {
      signal,
      headers: { Accept: "application/x-ndjson" },
    });
    if (!response.ok || !response.body)
      throw new Error(
        response.status === 503
          ? "Two sessions are already loading. Retry shortly."
          : `Could not load session (${response.status}).`,
      );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      loaded = 0,
      total = 0,
      fileTotal = 0,
      fileCount = 0;
    let data: LiveReplay | undefined;
    let preview: string | undefined;
    let done = false;
    let lastPaint = performance.now();
    try {
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.kind === "error") throw new Error(event.message);
          if (event.kind === "progress") onProgress(event);
          else if (event.kind === "header") {
            total = event.total;
            fileTotal = event.fileTotal;
            data = {
              replay: { ...event.replay, files: {}, steps: [] },
              repo: event.repo,
              warnings: event.warnings,
              saved: event.saved,
            };
          } else if (event.kind === "files" && data) {
            for (const [path, content] of event.items) {
              Object.defineProperty(data.replay.files, path, {
                value: content,
                enumerable: true,
                writable: true,
                configurable: true,
              });
              fileCount++;
            }
          } else if (event.kind === "steps" && data) {
            for (const step of event.items) {
              data.replay.steps.push(step);
              loaded++;
              if (!preview && (step.kind === "prompt" || step.kind === "say"))
                preview = step.text.slice(0, 1500);
            }
          } else if (event.kind === "done") done = true;
          if (data && (performance.now() - lastPaint > 16 || done)) {
            onProgress({
              title: data.replay.title,
              preview,
              loaded,
              total,
              message:
                fileCount < fileTotal
                  ? `Loading source files (${fileCount} of ${fileTotal})`
                  : "Loading session steps",
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            signal.throwIfAborted();
            lastPaint = performance.now();
          }
        }
        if (chunk.done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!done || !data || loaded !== total || fileCount !== fileTotal)
      throw new Error(
        "The session stream ended early. Retry to load the complete session.",
      );
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: error instanceof Error ? error.message : "Could not load session.",
      },
    };
  }
}

export function useSession(id: string) {
  const [loaded, setLoaded] = React.useState<Loaded<LiveReplay>>({ state: "loading" });
  const [progress, setProgress] = React.useState<SessionProgress>({
    message: "Locating session",
  });
  React.useEffect(() => {
    const controller = new AbortController();
    void streamSession(
      id,
      (next) => {
        if (!controller.signal.aborted) setProgress(next);
      },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setLoaded(
        result.ok
          ? { state: "ready", data: result.data }
          : {
              state: "failed",
              failure: result.failure,
              message: result.failure.message,
            },
      );
    });
    return () => controller.abort();
  }, [id]);
  return { loaded, progress };
}
