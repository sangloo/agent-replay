/**
 * The player's client for the local service in `server/api.ts`. Every call
 * answers a result, never throws: `{ ok: true, data }` or `{ ok: false,
 * failure }` with a sentence a person can read. A request that takes too
 * long is abandoned with a message that says so, rather than spinning.
 */

import type { Replay } from "@agent-replay/core";
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

type Method = "GET" | "POST" | "DELETE";

// Listings answer in well under a second; a live capture reads a whole
// session log and asks git about every file it touched.
const TIMEOUT = { quick: 30_000, slow: 180_000 } as const;

async function call<T>(
  method: Method,
  path: string,
  body?: unknown,
  timeout: keyof typeof TIMEOUT = "quick",
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT[timeout]);
  try {
    // The one place the player reaches the network.
    const response = await fetch(path, {
      method,
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

export const api = {
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
