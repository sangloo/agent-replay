import { agentName } from "@agent-replay/core";
import {
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";

import {
  api,
  useLoad,
  type ApiResult,
  type Page,
  type Project,
  type SavedListing,
  type SessionListing,
} from "./api";
import { Choice } from "./choice";
import { FolderDialog } from "./folder-dialog";
import { ago, dayGroup, project as folderName } from "./labels";
import { PAGE_SIZE, type LibraryParams, type Tab } from "./library-params";
import { ProjectPicker } from "./project-picker";
import { ThemeToggle } from "./theme-toggle";

interface Item {
  id: string;
  href: string;
  title: string;
  /** Quiet words under the title. */
  meta: string;
  /** For the day it is filed under. */
  at?: string;
  when: string;
  badge?: React.ReactNode;
}

interface PageState<T> {
  /** The last page that arrived, kept on screen while the next one loads. */
  page?: Page<T>;
  error?: string;
  busy: boolean;
}

/** A page of a listing, fetched while `query` is defined. */
function usePage<T>(
  query: string | undefined,
  load: (query: string) => Promise<ApiResult<Page<T>>>,
): PageState<T> {
  const [settled, setSettled] = React.useState<{
    query: string;
    page?: Page<T>;
    error?: string;
  }>();
  React.useEffect(() => {
    if (query === undefined) return;
    let current = true;
    void load(query).then((result) => {
      if (!current) return;
      setSettled((last) =>
        result.ok
          ? { query, page: result.data }
          : {
              query,
              page: last?.page,
              error: result.failure.message,
            },
      );
    });
    return () => {
      current = false;
    };
  }, [query, load]);
  return {
    page: settled?.page,
    error: settled?.query === query ? settled?.error : undefined,
    busy: settled?.query !== query,
  };
}

function Rows({ items }: { items: readonly Item[] }) {
  const list = React.useRef<HTMLDivElement>(null);
  // ↑ and ↓ move between rows; Enter opens one (it is a link).
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)] ?? rows[0];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  const groups: { title: string; items: Item[] }[] = [];
  for (const item of items) {
    const title = dayGroup(item.at);
    const group = groups.at(-1);
    if (group?.title === title) group.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return (
    <div ref={list} onKeyDown={onKeyDown} className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-1">
          <h3 className="px-3 text-2xs font-medium tracking-wide text-text-low uppercase">
            {group.title}
          </h3>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  data-row
                  href={item.href}
                  className="flex items-center gap-4 rounded-control px-3 py-2.5 focus-bar hover:bg-hover"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-text-high">
                      {item.title}
                    </span>
                    <span className="truncate text-xs text-text-low">{item.meta}</span>
                  </span>
                  {item.badge ?? null}
                  <span className="w-16 shrink-0 text-right text-xs text-text-low tabular-nums">
                    {item.when}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Library({
  params,
  onParams,
}: {
  params: LibraryParams;
  onParams: (next: LibraryParams) => void;
}) {
  const { tab, agent, page, project } = params;
  const [refresh, setRefresh] = React.useState(0);
  const projects = useLoad(`projects:${refresh}`, loadProjects);
  const known: readonly Project[] = projects.state === "ready" ? projects.data : [];
  const [opening, setOpening] = React.useState(false);

  // The field answers at once; the list follows a moment later.
  const [typed, setTyped] = React.useState(params.q);
  React.useEffect(() => {
    if (typed === params.q) return;
    const timer = setTimeout(() => onParams({ ...params, q: typed, page: 1 }), 180);
    return () => clearTimeout(timer);
  }, [typed, params, onParams]);

  const query = new URLSearchParams({
    ...(params.q ? { q: params.q } : {}),
    ...(agent ? { agent } : {}),
    ...(project ? { project } : {}),
    offset: String((page - 1) * PAGE_SIZE),
    limit: String(PAGE_SIZE),
  }).toString();
  const sessions = usePage(tab === "sessions" ? query : undefined, api.sessions);
  const saved = usePage(tab === "saved" ? query : undefined, api.replays);
  const current = tab === "sessions" ? sessions : saved;
  const data: Page<unknown> | undefined = current.page;
  const nameOf = (root?: string) =>
    root ? (known.find((p) => p.root === root)?.name ?? folderName(root)) : "";
  const items: Item[] =
    tab === "sessions"
      ? (sessions.page?.items.map((item: SessionListing): Item => ({
          id: item.id,
          href: `#/session/${encodeURIComponent(item.id)}`,
          title: item.title,
          meta: [agentName(item.agent), project ? "" : nameOf(item.project ?? item.cwd)]
            .filter(Boolean)
            .join(" · "),
          at: item.updatedAt,
          when: ago(item.updatedAt),
          badge: item.saved ? (
            <span className="shrink-0 text-2xs text-text-low">Saved</span>
          ) : undefined,
        })) ?? [])
      : (saved.page?.items.map((item: SavedListing): Item => ({
          id: item.id,
          href: `#/replay/${encodeURIComponent(item.id)}`,
          title: item.title,
          meta: [
            agentName(item.agent),
            project ? "" : item.repo,
            item.lessons !== undefined
              ? `${item.lessons} lesson${item.lessons === 1 ? "" : "s"}`
              : `${item.changes} changes`,
          ]
            .filter(Boolean)
            .join(" · "),
          at: item.startedAt,
          when: ago(item.startedAt),
          badge: item.notes ? (
            <span className="shrink-0 text-2xs text-warning-ink">
              {item.notes} {item.notes === 1 ? "note" : "notes"}
            </span>
          ) : undefined,
        })) ?? []);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const agents = Object.entries(data?.agents ?? {}).sort((a, b) => b[1] - a[1]);

  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea")) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const turn = (next: number) => {
    onParams({ ...params, page: next });
    window.scrollTo({ top: 0 });
  };

  const empty =
    params.q || agent
      ? "Nothing matches."
      : tab === "sessions"
        ? project
          ? "No agent sessions ran in this project on this machine."
          : "No Claude Code, Codex or Gemini CLI sessions found on this machine."
        : project
          ? "Nothing saved in this project yet. Open a session and save it, or run `replay capture` there."
          : "Nothing saved yet. Open a session and save it, or run `replay capture` in a repository.";

  return (
    <div className="min-h-dvh bg-surface-base text-text-high">
      <div className="sticky top-0 z-raised bg-surface-base">
        <header className="flex h-12 items-center gap-3 border-b border-line px-3">
          <span className="px-1 text-sm font-medium">Replay</span>
          <span aria-hidden className="text-text-low">
            /
          </span>
          <ProjectPicker
            projects={known}
            value={project}
            onChange={(root) => onParams({ ...params, project: root, page: 1 })}
            onOpenFolder={() => setOpening(true)}
          />
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </header>
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 pt-6 pb-4">
          <Choice<Tab>
            label="Which replays"
            value={tab}
            onChange={(next) => onParams({ ...params, tab: next, agent: "", page: 1 })}
            options={[
              { value: "sessions", label: "Sessions" },
              { value: "saved", label: "Saved" },
            ]}
          />
          <div className="relative min-w-40 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 z-raised icon-sm -translate-y-1/2 text-text-low"
            />
            <Input
              ref={search}
              size="sm"
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setTyped("");
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  document.querySelector<HTMLElement>("[data-row]")?.focus();
                }
              }}
              placeholder={
                tab === "sessions" ? "Search sessions" : "Search saved replays"
              }
              aria-label="Search"
              className="pl-8"
            />
          </div>
          <Select
            value={agent || "all"}
            onValueChange={(next) =>
              onParams({ ...params, agent: next === "all" ? "" : next, page: 1 })
            }
          >
            <SelectTrigger size="sm" className="w-40 shrink-0" aria-label="Agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map(([value, n]) => (
                <SelectItem key={value} value={value}>
                  {agentName(value)} · {n}
                </SelectItem>
              ))}
              {agent && !agents.some(([value]) => value === agent) ? (
                <SelectItem value={agent}>{agentName(agent)}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-3 pb-24">
        <p className="-mt-2 px-3 text-xs text-text-low">
          {tab === "sessions"
            ? "Agent sessions on this machine — Claude Code, Codex and Gemini CLI. Each is read live when you open it."
            : "Replays and courses saved into a repository’s .replays/ folder — with their notes, ready to share."}
        </p>
        <div
          className={cn(
            "px-3 transition-opacity duration-fast",
            current.busy && data && "opacity-60",
          )}
        >
          {current.error ? (
            <p className="py-3 text-sm text-danger-ink">{current.error}</p>
          ) : !data ? (
            <p className="py-3 text-sm text-text-low">Loading…</p>
          ) : items.length === 0 ? (
            <p className="max-w-prose py-3 text-sm text-text-low">{empty}</p>
          ) : (
            <Rows items={items} />
          )}
        </div>

        {data && data.total > PAGE_SIZE ? (
          <nav
            aria-label="Pages"
            className="mx-6 flex items-center justify-between border-t border-line pt-4 text-xs text-text-low"
          >
            <span className="tabular-nums">
              {data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} of{" "}
              {data.total}
            </span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"

                disabled={page <= 1}
                onClick={() => turn(page - 1)}
              >
                <ChevronLeft />
                Newer
              </Button>
              <span className="tabular-nums">
                {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"

                disabled={page >= pages}
                onClick={() => turn(page + 1)}
              >
                Older
                <ChevronRight />
              </Button>
            </span>
          </nav>
        ) : null}
      </main>

      <FolderDialog
        open={opening}
        onOpenChange={setOpening}
        onAdded={(added) => {
          setRefresh((n) => n + 1);
          onParams({ ...params, project: added.root, page: 1 });
        }}
      />
    </div>
  );
}

const loadProjects = () => api.projects();
