import { sessionStreamer } from "./session-stream.ts";
/**
 * The local service: a Vite plugin, so `pnpm dev:replay` is the whole tool —
 * no second process to start, no port to agree on, and it only ever listens
 * where the dev server does (localhost, unless someone passes `--host`).
 *
 * It answers in one envelope (`{ data, meta }`, and problems as
 * `application/problem+json`), which the player's client in `src/api.ts`
 * reads.
 *
 *   GET    /api/projects              the repositories it knows (see projects.ts)
 *   POST   /api/projects              add a folder: { "path": "~/code/app" }
 *   DELETE /api/projects?root=        forget a folder added by hand
 *   GET    /api/folders?path=         the folders in a folder, to choose one
 *
 *   GET    /api/replays               saved replays, in every known repository
 *   GET    /api/replays/:id           one saved replay
 *   GET    /api/sessions              agent sessions on this machine
 *   GET    /api/sessions/:id          a session captured live (not saved)
 *   POST   /api/sessions/:id/save     capture a session into its repo's .replays/
 *
 *   GET    /api/{replays,sessions}/:id/tree   every file in the repository at
 *                                             the replay's base commit
 *   GET    /api/{replays,sessions}/:id/file   one of them (?rev=&path=)
 *   GET    /api/{replays,sessions}/:id/export the replay as one HTML file
 *
 * The two listings take `?q=` (every word must match), `?agent=`,
 * `?project=` (a repository's root) and `?offset=` / `?limit=`, and answer a
 * page with the total and per-agent and per-project counts of everything
 * the search matched.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { basename } from "node:path";

import {
  curriculumLessons,
  type Replay,
  type StudyCatalog,
  type StudyContext,
} from "@agent-replay/core";
import type { Plugin } from "vite";

import { captureSession, type Captured } from "./capture.ts";
import { readStudyCourse } from "./curriculum.ts";
import { exportHtml, hasPlayer } from "./export.ts";
import * as git from "./git.ts";
import {
  addProject,
  listFolders,
  projectName,
  readAdded,
  removeProject,
  rootOf,
  type FolderListing,
} from "./projects.ts";
import { findSession, listSessions } from "./sessions.ts";
import {
  findSaved,
  idKey,
  listSaved,
  readReplay,
  saveReplay,
  replayStamp,
} from "./store.ts";

export type { FolderListing };

export interface ReplayApiOptions {
  /** Repositories whose `.replays/` are listed, and sessions are matched to. */
  repos: readonly string[];
}

export interface SavedListing {
  id: string;
  /** The replay's own id (the session's), which progress in the player is kept by. */
  replayId: string;
  /** The revision its steps arrive at, which a course's progress is kept by. */
  revision?: string;
  /** The repository's name, and its root. */
  repo: string;
  project: string;
  /** Which agent's session: `claude-code`, `codex`, … */
  agent: string;
  title: string;
  startedAt: string;
  endedAt: string;
  steps: number;
  changes: number;
  notes: number;
  lessons?: number;
}

export interface SessionListing {
  id: string;
  agent: string;
  title: string;
  cwd?: string;
  /** The repository it ran in (its root), or its directory outside one. */
  project?: string;
  startedAt?: string;
  updatedAt: string;
  bytes: number;
  /** The saved replay of this session, when there is one. */
  saved?: string;
}

export interface LiveReplay {
  replay: Replay;
  repo: string;
  warnings: string[];
  saved?: string;
}

export interface Page<T> {
  items: T[];
  /** How many match the search and the agent filter. */
  total: number;
  offset: number;
  limit: number;
  /** Per agent, how many match the search — before the agent filter. */
  agents: Record<string, number>;
  /** Per project (a session's directory, a replay's repo), likewise. */
  projects: Record<string, number>;
}

export interface Project {
  root: string;
  name: string;
  /** Agent sessions that ran in it, on this machine. */
  sessions: number;
  /** Replays saved in its `.replays/`. */
  saved: number;
  lastActive?: string;
  /** Added by hand — the only kind that can be forgotten. */
  added: boolean;
}

/** Every path in the repository at `rev`, the replay's base commit. */
export interface RepoTree {
  rev: string;
  paths: string[];
}

export interface RepoFile {
  path: string;
  content: string | null;
  /** Why there is no content: too large to show, or not text. */
  omitted?: "large" | "binary";
}

const PAGE = 25;
const MAX_PAGE = 100;
const MAX_FILE_BYTES = 1024 * 1024;

function count(value: string | null, fallback: number, max: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

/** Search, filter by agent and project, and cut a page. */
export function pageOf<T extends { agent: string }>(
  all: readonly T[],
  query: URLSearchParams,
  text: (item: T) => string,
  projectOf: (item: T) => string,
): Page<T> {
  const terms = (query.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = terms.length
    ? all.filter((item) => {
        const haystack = text(item).toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
    : all;
  // Each facet counts what the other filter leaves, so its numbers say what
  // choosing it would show.
  const agent = query.get("agent");
  const project = query.get("project");
  const byAgent = agent ? matched.filter((item) => item.agent === agent) : matched;
  const byProject = project
    ? matched.filter((item) => projectOf(item) === project)
    : matched;
  const agents: Record<string, number> = {};
  for (const item of byProject) agents[item.agent] = (agents[item.agent] ?? 0) + 1;
  const projects: Record<string, number> = {};
  for (const item of byAgent) {
    const name = projectOf(item);
    if (name) projects[name] = (projects[name] ?? 0) + 1;
  }
  const filtered = project
    ? byAgent.filter((item) => projectOf(item) === project)
    : byAgent;
  const limit = Math.max(1, count(query.get("limit"), PAGE, MAX_PAGE));
  const offset = count(query.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
    agents,
    projects,
  };
}

/** A path inside the repository, as git names it — never out of it. */
function repoPath(path: string | null): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Problem(400, "invalid_request", "Not a path in the repository.");
  }
  return path;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

class Problem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(
  response: ServerResponse,
  requestId: string,
  status: number,
  body: unknown,
  type = "application/json",
) {
  response.statusCode = status;
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-ID", requestId);
  response.end(JSON.stringify(body));
}

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 64 * 1024) throw new Problem(413, "too_large", "Body too large.");
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem(400, "invalid_request", "The body is not JSON.");
  }
}

export function createHandler(options: ReplayApiOptions) {
  // Real paths, as git reports a capture's root — so a symlinked or
  // non-top-level entry still finds the replays saved there.
  const configured = options.repos.map(real);
  const streamSession = sessionStreamer(configured);

  // Every repository the player knows: the ones it was started for, the
  // ones added by hand, and every one a session ran in. A saved replay's id
  // names its repository by a hash of the root, so it survives a restart.
  const byKey = new Map<string, string>(
    [...configured, ...readAdded()].map((root) => [idKey(root), root]),
  );
  const knownRoots = (): string[] => {
    const fromSessions = listSessions().flatMap((session) =>
      session.cwd ? [rootOf(session.cwd)] : [],
    );
    const roots = [...new Set([...configured, ...readAdded(), ...fromSessions])];
    for (const root of roots) byKey.set(idKey(root), root);
    return roots;
  };
  const rootByKey = (key: string): string | undefined => {
    if (!byKey.has(key)) knownRoots();
    return byKey.get(key);
  };
  const savedId = (root: string, name: string) => `${idKey(root)}:${name}`;
  const savedIdIn = (root: string, sessionId: string) => {
    const name = findSaved(root, sessionId);
    return name ? savedId(root, name) : undefined;
  };

  // A live capture reads git for every touched file; a session is only
  // re-captured when its transcript has moved on.
  const live = new Map<string, { updatedAt: string; captured: Captured }>();

  /** A session's repository: from the capture already made, when there is one. */
  const liveRoot = (id: string): Captured => live.get(id)?.captured ?? liveCapture(id);

  const liveCapture = (id: string): Captured => {
    const session = findSession(id, undefined, { exact: true });
    if (!session)
      throw new Problem(404, "not_found", `No session ${id} on this machine.`);
    const cached = live.get(id);
    if (cached && cached.updatedAt === session.updatedAt) return cached.captured;
    try {
      const captured = captureSession({ session }, knownRoots());
      // The few most recent, not every session ever opened: a capture holds
      // a copy of every file the session touched.
      live.delete(id);
      live.set(id, { updatedAt: session.updatedAt, captured });
      for (const key of live.keys()) {
        if (live.size <= 6) break;
        live.delete(key);
      }
      return captured;
    } catch (error) {
      throw new Problem(
        422,
        "validation_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Every file at a commit, kept: a tree is asked for once per replay opened.
  const trees = new Map<string, RepoTree>();
  const treeAt = (root: string, replay: Replay): RepoTree => {
    const rev = [replay.repo.base, replay.repo.end]
      .map((candidate) => candidate && git.resolve(root, candidate))
      .find(Boolean);
    if (!rev) {
      throw new Problem(
        404,
        "not_found",
        "This replay's commits are not in this clone, so its other files cannot be shown.",
      );
    }
    const key = `${root}\u0000${rev}`;
    let tree = trees.get(key);
    if (!tree) {
      tree = { rev, paths: git.filesAt(root, rev) };
      trees.set(key, tree);
    }
    return tree;
  };
  const fileAt = (root: string, query: URLSearchParams): RepoFile => {
    const rev = query.get("rev") ?? "";
    if (!/^[0-9a-f]{40}$/.test(rev))
      throw new Problem(400, "invalid_request", "Not a commit.");
    const path = repoPath(query.get("path"));
    const content = git.showFile(root, rev, path);
    if (content === null) throw new Problem(404, "not_found", `No ${path} at ${rev}.`);
    if (content === "\u0000binary") return { path, content: null, omitted: "binary" };
    if (content.length > MAX_FILE_BYTES)
      return { path, content: null, omitted: "large" };
    return { path, content };
  };
  const saved = (key: string, name: string): { root: string; replay: Replay } => {
    const root = rootByKey(key);
    const replay = root ? readReplay(root, name) : undefined;
    if (!root || !replay) throw new Problem(404, "not_found", "No such replay.");
    return { root, replay };
  };

  const projects = (): Project[] => {
    const sessions = new Map<string, { count: number; last: string }>();
    for (const session of listSessions()) {
      if (!session.cwd) continue;
      const root = rootOf(session.cwd);
      const known = sessions.get(root);
      sessions.set(root, {
        count: (known?.count ?? 0) + 1,
        last: known && known.last > session.updatedAt ? known.last : session.updatedAt,
      });
    }
    const added = new Set(readAdded());
    return knownRoots()
      .map((root): Project => {
        const saved = listSaved(root);
        const last = [sessions.get(root)?.last, saved[0]?.startedAt]
          .filter((at): at is string => Boolean(at))
          .sort()
          .at(-1);
        return {
          root,
          name: projectName(root),
          sessions: sessions.get(root)?.count ?? 0,
          saved: saved.length,
          ...(last ? { lastActive: last } : {}),
          added: added.has(root),
        };
      })
      .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  };

  type Handler = (
    match: RegExpMatchArray,
    query: URLSearchParams,
    body: unknown,
  ) => unknown;
  const REPLAY = String.raw`\/replays\/([0-9a-f]{8}):([\w.-]+)`;
  const SESSION = String.raw`\/sessions\/([\w.:-]+)`;
  const routes: [string, RegExp, Handler][] = [
    ["GET", /^\/projects$/, (): Project[] => projects()],
    [
      "GET",
      /^\/curricula$/,
      (): StudyCatalog => {
        const catalog: StudyCatalog = { courses: [], problems: [] };
        for (const root of new Set([...configured, ...readAdded()])) {
          byKey.set(idKey(root), root);
          try {
            const course = readStudyCourse(root);
            if (course) catalog.courses.push(course);
          } catch (error) {
            catalog.problems.push({
              project: projectName(root),
              message:
                error instanceof Error
                  ? error.message
                  : "Could not read the curriculum.",
            });
          }
        }
        return catalog;
      },
    ],
    [
      "POST",
      /^\/projects$/,
      (_, __, body): Project => {
        const path =
          body && typeof body === "object" && "path" in body
            ? (body as { path: unknown }).path
            : undefined;
        if (typeof path !== "string" || !path.trim())
          throw new Problem(400, "invalid_request", "Name a folder to add.");
        let root: string;
        try {
          root = addProject(path.trim());
        } catch (error) {
          throw new Problem(
            422,
            "validation_failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        return projects().find((project) => project.root === root)!;
      },
    ],
    [
      "DELETE",
      /^\/projects$/,
      (_, query): { removed: string } => {
        const root = query.get("root");
        if (!root)
          throw new Problem(400, "invalid_request", "Name the folder to forget.");
        removeProject(root);
        return { removed: root };
      },
    ],
    [
      "GET",
      /^\/folders$/,
      (_, query): FolderListing => {
        try {
          return listFolders(query.get("path") || undefined);
        } catch (error) {
          throw new Problem(
            404,
            "not_found",
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ],
    [
      "GET",
      /^\/replays$/,
      (_, query): Page<SavedListing> => {
        const project = query.get("project");
        const roots = project ? [project] : knownRoots();
        return pageOf(
          roots
            .flatMap((root) =>
              listSaved(root).map(({ name, file: _file, ...saved }) => ({
                ...saved,
                replayId: saved.id,
                id: savedId(root, name),
                repo: projectName(root),
                project: root,
              })),
            )
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
          query,
          (item) => `${item.title} ${item.repo} ${item.agent} ${item.id}`,
          (item) => item.project,
        );
      },
    ],
    [
      "GET",
      new RegExp(`^${REPLAY}\\/stamp$`),
      (match) => {
        const root = rootByKey(match[1]!);
        const stamp = root && replayStamp(root, match[2]!);
        if (!stamp) throw new Problem(404, "not_found", "No such replay.");
        return { stamp };
      },
    ],
    [
      "GET",
      new RegExp(`^${REPLAY}$`),
      (match): Replay => saved(match[1]!, match[2]!).replay,
    ],
    [
      "GET",
      new RegExp(`^${REPLAY}\\/tree$`),
      (match): RepoTree => {
        const { root, replay } = saved(match[1]!, match[2]!);
        return treeAt(root, replay);
      },
    ],
    [
      "GET",
      new RegExp(`^${REPLAY}\\/file$`),
      (match, query): RepoFile => fileAt(saved(match[1]!, match[2]!).root, query),
    ],
    [
      "GET",
      /^\/sessions$/,
      (_, query): Page<SessionListing> => {
        const page = pageOf(
          listSessions().map((session) => ({
            ...session,
            ...(session.cwd ? { project: rootOf(session.cwd) } : {}),
          })),
          query,
          (item) => `${item.title} ${item.cwd ?? ""} ${item.agent} ${item.id}`,
          (item) => item.project ?? "",
        );
        // Which sessions are saved is asked of the page only.
        const byId = new Map(
          [
            ...new Set(
              page.items.flatMap((item) => (item.project ? [item.project] : [])),
            ),
          ].flatMap((root) =>
            listSaved(root).map((item) => [item.id, savedId(root, item.name)] as const),
          ),
        );
        return {
          ...page,
          items: page.items.map(({ file: _file, ...session }) => ({
            ...session,
            saved: byId.get(session.id),
          })),
        };
      },
    ],
    [
      "GET",
      new RegExp(`^${SESSION}$`),
      (match): LiveReplay => {
        const { replay, root, warnings } = liveCapture(match[1]!);
        return {
          replay,
          repo: basename(root),
          warnings,
          saved: savedIdIn(root, replay.id),
        };
      },
    ],
    [
      "GET",
      new RegExp(`^${SESSION}\\/tree$`),
      (match): RepoTree => {
        const { replay, root } = liveRoot(match[1]!);
        return treeAt(root, replay);
      },
    ],
    [
      "GET",
      new RegExp(`^${SESSION}\\/file$`),
      (match, query): RepoFile => fileAt(liveRoot(match[1]!).root, query),
    ],
    [
      "POST",
      new RegExp(`^${SESSION}\\/save$`),
      (match): { id?: string; file: string } => {
        const { replay, root } = liveCapture(match[1]!);
        const file = saveReplay(root, replay);
        return { id: savedIdIn(root, replay.id), file };
      },
    ],
  ];

  const problem = (response: ServerResponse, requestId: string, error: Problem) =>
    send(
      response,
      requestId,
      error.status,
      {
        type: "about:blank",
        title: error.code,
        status: error.status,
        code: error.code,
        detail: error.message,
        request_id: requestId,
      },
      "application/problem+json",
    );

  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const header = request.headers["x-request-id"];
    const requestId =
      typeof header === "string" && ID.test(header) ? header : randomUUID();
    let path: string;
    let query: URLSearchParams;
    try {
      const [raw = "/", search = ""] = (request.url ?? "/").split("?");
      path = decodeURIComponent(raw);
      query = new URLSearchParams(search);
    } catch {
      problem(
        response,
        requestId,
        new Problem(400, "invalid_request", "Malformed URL."),
      );
      return;
    }
    const stream =
      request.method === "GET" && path.match(new RegExp(`^${SESSION}\\/stream$`));
    if (stream) {
      try {
        streamSession(stream[1]!, response);
      } catch (error) {
        problem(
          response,
          requestId,
          new Problem(
            500,
            "capture_failed",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      return;
    }
    // A replay as one HTML file: a download, not an envelope.
    const exporting =
      request.method === "GET"
        ? (path.match(new RegExp(`^${REPLAY}\\/export$`)) ??
          path.match(new RegExp(`^${SESSION}\\/export$`)))
        : null;
    if (exporting) {
      try {
        const savedReplay =
          exporting.length === 3 ? saved(exporting[1]!, exporting[2]!) : undefined;
        const replay = savedReplay?.replay ?? liveCapture(exporting[1]!).replay;
        let study: StudyContext | undefined;
        let exportFile: string | undefined;
        if (savedReplay && replay.source === "course") {
          // A malformed optional map is reported in Learn; plain exports still work.
          try {
            const course = readStudyCourse(savedReplay.root);
            const lesson =
              course &&
              curriculumLessons(course.curriculum).find(
                (l) => l.replay === exporting[2],
              );
            if (course && lesson) {
              study = { curriculum: course.curriculum, lessonId: lesson.id };
              exportFile = lesson.exportFile;
            }
          } catch {
            /* Optional metadata cannot break an existing replay. */
          }
        }
        if (!hasPlayer()) {
          throw new Problem(
            409,
            "not_built",
            "Exporting needs the built player — run `pnpm build` once, then try again.",
          );
        }
        const html = exportHtml(replay, undefined, study);
        const name =
          replay.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "replay";
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${exportFile ?? `${name}.html`}"`,
        );
        response.setHeader("Cache-Control", "no-store");
        response.end(html);
      } catch (error) {
        problem(
          response,
          requestId,
          error instanceof Problem
            ? error
            : new Problem(
                500,
                "internal",
                error instanceof Error ? error.message : "Export failed.",
              ),
        );
      }
      return;
    }

    const route = routes.find(
      ([method, pattern]) => method === request.method && pattern.test(path),
    );
    if (!route) return next();

    // Writes come only from the player: it always sends X-Request-ID, which
    // a cross-site form or image cannot without a preflight this server
    // never grants — and when a browser names an Origin, it must be local.
    if (request.method !== "GET") {
      const origin = request.headers.origin;
      const local =
        !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
      if (typeof header !== "string" || !local) {
        problem(
          response,
          requestId,
          new Problem(403, "forbidden", "Writes come from the player only."),
        );
        return;
      }
    }

    try {
      const body = request.method === "GET" ? undefined : await readBody(request);
      const data = route[2](path.match(route[1])!, query, body);
      send(response, requestId, 200, { data, meta: { request_id: requestId } });
    } catch (error) {
      problem(
        response,
        requestId,
        error instanceof Problem
          ? error
          : error instanceof RangeError && /string length/i.test(error.message)
            ? new Problem(
                413,
                "too_large",
                "This replay is too large to send to the player in one piece.",
              )
            : new Problem(
                500,
                "internal",
                error instanceof Error ? error.message : "Unexpected failure.",
              ),
      );
    }
  };
}

export function replayApi(options: ReplayApiOptions): Plugin {
  const handler = createHandler(options);
  return {
    name: "agent-replay-api",
    configureServer(server) {
      server.middlewares.use("/api", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api", handler);
    },
  };
}
