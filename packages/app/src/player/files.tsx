import type { FileEntry } from "@agent-replay/core";
import { cn, IconButton, Input, Tree } from "@/ui";
import { ChevronsDownUp, File, Folder, FolderOpen } from "lucide-react";
import * as React from "react";

import { Choice } from "../choice";
import { fileName } from "../labels";
import { ancestorIds, DIR_ID, FILE_ID, treeLines } from "./tree-lines";

/**
 * What a file (or everything in a folder) has become at the cursor. `ahead`
 * is a file the replay changes later: listed, quietly, so the shape of the
 * whole change is there from the first frame.
 */
type Mark = "added" | "modified" | "deleted" | "ahead" | "example";

const INK: Record<Mark, string> = {
  added: "text-success-ink",
  modified: "text-warning-ink",
  deleted: "text-danger-ink",
  ahead: "text-text-low",
  example: "text-info-ink",
};

const LETTER: Record<Exclude<Mark, "ahead">, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  example: "Ex",
};

const NAME: Record<Mark, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  ahead: "changed later",
  example: "teaching material, not part of the repository",
};

const PILL: Record<Exclude<Mark, "ahead">, string> = {
  added: "bg-success-subtle text-success-ink",
  modified: "bg-warning-subtle text-warning-ink",
  deleted: "bg-danger-subtle text-danger-ink",
  example: "bg-info-subtle text-info-ink",
};

const DOT: Record<Mark, string> = {
  added: "bg-success",
  modified: "bg-warning",
  deleted: "bg-danger",
  ahead: "bg-line-high",
  example: "bg-info",
};

function markOf(file: FileEntry): Mark | undefined {
  if (!file.touched || file.absent) return "ahead";
  if (file.aside) return "example";
  if (file.status === "unchanged") return undefined;
  return file.status;
}

/** A folder's mark: one kind throughout says so; a mix is a modification. */
function rollUp(marks: readonly Mark[]): Mark {
  const reached = marks.filter((mark) => mark !== "ahead" && mark !== "example");
  if (reached.length === 0 && marks.includes("example")) return "example";
  if (reached.length === 0) return "ahead";
  return reached.every((mark) => mark === reached[0]) ? reached[0]! : "modified";
}

export interface FilesPanelProps {
  files: readonly FileEntry[];
  /** Every path in the repository, when it can be read. */
  repo?: readonly string[];
  /** Loading or unavailable, for the whole-repository view. */
  repoState?: "loading" | { failed: string };
  /** Ask for the repository's paths. */
  onWantRepo?: () => void;
  current?: string;
  /** Changed by the step on screen. */
  active?: string;
  onSelect: (path: string) => void;
  filterRef?: React.Ref<HTMLInputElement>;
}

/**
 * The files, as an explorer: what the replay changes, or the whole
 * repository with the changes marked on every level — a changed file wears
 * its status, and so does every folder above it.
 */
export function FilesPanel({
  files,
  repo,
  repoState,
  onWantRepo,
  current,
  active,
  onSelect,
  filterRef,
}: FilesPanelProps) {
  const [scope, setScope] = React.useState<"changes" | "all">("changes");
  const [query, setQuery] = React.useState("");
  const [collapse, setCollapse] = React.useState(0);
  const changed = files.filter((file) => file.touched && !file.absent).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <Choice
          label="Files shown"
          value={scope}
          onChange={(value) => {
            setScope(value);
            if (value === "all") onWantRepo?.();
          }}
          options={[
            {
              value: "changes",
              label: (
                <>
                  Changes{" "}
                  <span className="font-normal text-text-low tabular-nums">
                    {changed}
                  </span>
                </>
              ),
            },
            ...(onWantRepo ? [{ value: "all" as const, label: "All files" }] : []),
          ]}
        />
        <IconButton
          label="Collapse all folders"
          variant="ghost"
          size="sm"

          className="ml-auto"
          onClick={() => setCollapse((n) => n + 1)}
        >
          <ChevronsDownUp />
        </IconButton>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <Input
          ref={filterRef}
          size="xs"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
          placeholder="Filter files"
          aria-label="Filter files"
        />
      </div>
      <div className="min-h-0 flex-1">
        {scope === "all" && repoState === "loading" ? (
          <p className="px-4 py-2 text-xs text-text-low">Reading the repository…</p>
        ) : scope === "all" && repoState && typeof repoState === "object" ? (
          <p className="px-4 py-2 text-xs text-text-mid">{repoState.failed}</p>
        ) : (
          <FileTree
            files={files}
            repo={scope === "all" ? repo : undefined}
            current={current}
            active={active}
            query={query}
            collapse={collapse}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}

interface FileTreeProps {
  files: readonly FileEntry[];
  repo?: readonly string[];
  current?: string;
  active?: string;
  query: string;
  /** Bumped to shut every folder (bar the way to the file on screen). */
  collapse: number;
  onSelect: (path: string) => void;
}

const FileTree = React.memo(function FileTree({
  files,
  repo,
  current,
  active,
  query,
  collapse,
  onSelect,
}: FileTreeProps) {
  // Every file the replay touches, from the first frame — the ones it has
  // not reached yet quietly. Keyed by the paths themselves, so a whole
  // repository's tree is built once, not at every step.
  const own = files.map((file) => file.path).join("\n");
  // A query with a slash filters whole paths (`server/api`); a plain word
  // filters by file name, with the match marked.
  const needle = query.trim().toLowerCase();
  const byPath = needle.includes("/");
  const lines = React.useMemo(() => {
    const all = [...new Set([...(repo ?? []), ...(own ? own.split("\n") : [])])];
    const shown = needle
      ? all.filter((path) =>
          (byPath ? path : fileName(path)).toLowerCase().includes(needle),
        )
      : all;
    return treeLines(shown);
  }, [repo, own, needle, byPath]);

  // Marks for files and, rolled up, for every folder above them.
  const marks = React.useMemo(() => {
    const out = new Map<string, Mark>();
    const under = new Map<string, Mark[]>();
    for (const file of files) {
      const mark = markOf(file);
      if (!mark) continue;
      out.set(FILE_ID + file.path, mark);
      for (const id of ancestorIds(file.path)) {
        const list = under.get(id);
        if (list) list.push(mark);
        else under.set(id, [mark]);
      }
    }
    for (const [id, list] of under) out.set(id, rollUp(list));
    return out;
  }, [files]);

  const changedDirs = React.useMemo(
    () => [...marks.keys()].filter((id) => id.startsWith(DIR_ID)),
    [marks],
  );
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(changedDirs),
  );
  const [reveal, setReveal] = React.useState<{ id: string; token: number }>();
  // When the file on screen changes, the folders on its way open and the
  // tree scrolls to it; a bumped `collapse` shuts everything else. Done as
  // the render notices the change, not in an effect after it.
  const [seen, setSeen] = React.useState<{ current?: string; collapse: number }>({
    collapse: 0,
  });
  if (seen.current !== current || seen.collapse !== collapse) {
    setSeen({ current, collapse });
    if (seen.collapse !== collapse) {
      setExpanded(new Set(current ? ancestorIds(current) : []));
    } else if (current) {
      setExpanded((open) => {
        const missing = ancestorIds(current).filter((id) => !open.has(id));
        return missing.length ? new Set([...open, ...missing]) : open;
      });
    }
    if (current) {
      setReveal((last) => ({ id: FILE_ID + current, token: (last?.token ?? 0) + 1 }));
    }
  }
  const toggle = React.useCallback(
    (id: string) =>
      setExpanded((open) => {
        const next = new Set(open);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  if (lines.length === 0) {
    return (
      <p className="px-4 py-2 text-xs text-text-low">
        {query ? "No file matches." : "No files changed yet."}
      </p>
    );
  }

  return (
    <Tree
      lines={lines}
      label="Files"
      rowHeight={28}
      indent={12}
      expanded={needle ? "all" : expanded}
      onToggle={needle ? () => {} : toggle}
      selected={current ? FILE_ID + current : undefined}
      onSelect={(id) => {
        if (id.startsWith(FILE_ID)) onSelect(id.slice(FILE_ID.length));
      }}
      reveal={reveal}
      highlight={needle && !byPath ? needle : undefined}
      labelClassName={(row) => {
        const mark = marks.get(row.id);
        if (!mark) return undefined;
        return cn(INK[mark], mark === "deleted" && !row.container && "line-through");
      }}
      icon={(row) =>
        row.container ? (
          row.expanded ? (
            <FolderOpen className="text-text-low" />
          ) : (
            <Folder className="text-text-low" />
          )
        ) : (
          <File className="text-text-low" />
        )
      }
      actions={(row) => {
        const mark = marks.get(row.id);
        const path = row.id.slice(FILE_ID.length);
        if (row.container) {
          return mark ? (
            <span
              title={`Has files ${NAME[mark]}`}
              className={cn("mr-2 size-1.5 shrink-0 rounded-full", DOT[mark])}
            />
          ) : null;
        }
        return (
          <span className="flex w-9 shrink-0 items-center justify-end gap-1.5 pr-1">
            {path === active ? (
              <span
                title="Changed by this step"
                className="size-1.5 rounded-full bg-emphasis"
              />
            ) : null}
            {mark && mark !== "ahead" ? (
              <span
                title={NAME[mark]}
                className={cn(
                  "grid h-4 min-w-4 place-items-center rounded-[4px] px-0.5 font-mono text-2xs font-medium",
                  PILL[mark],
                )}
              >
                {LETTER[mark]}
                <span className="sr-only"> {NAME[mark]}</span>
              </span>
            ) : mark === "ahead" ? (
              <span className="sr-only">{NAME[mark]}</span>
            ) : null}
          </span>
        );
      }}
      className="h-full pb-2"
    />
  );
});
