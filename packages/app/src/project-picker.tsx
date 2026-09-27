import { attachedItem, cn, Input, Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Check, ChevronDown, FolderGit2, FolderPlus, Layers } from "lucide-react";
import * as React from "react";

import type { Project } from "./api";
import { ago } from "./labels";

/**
 * Which repository the list is about: all of them, one the agents worked in,
 * or a folder added by hand — "Open folder…" at the bottom.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  onOpenFolder,
}: {
  projects: readonly Project[];
  /** A repository's root; empty for all of them. */
  value: string;
  onChange: (root: string) => void;
  onOpenFolder: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const current = projects.find((project) => project.root === value);
  const shown = query
    ? projects.filter((project) =>
        `${project.name} ${project.root}`.toLowerCase().includes(query.toLowerCase()),
      )
    : projects;
  const choose = (root: string) => {
    onChange(root);
    setOpen(false);
    setQuery("");
  };
  const row =
    "focus-bar flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-xs hover:bg-hover";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 max-w-72 items-center gap-2 rounded-control px-2 text-sm focus-bar hover:bg-hover"
        >
          {current ? (
            <FolderGit2 aria-hidden className="icon-sm shrink-0 text-text-low" />
          ) : (
            <Layers aria-hidden className="icon-sm shrink-0 text-text-low" />
          )}
          <span className="truncate font-medium">
            {current?.name ?? (value ? value : "All projects")}
          </span>
          <ChevronDown aria-hidden className="icon-sm shrink-0 text-text-low" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        {projects.length > 7 ? (
          <div className="p-1 pb-2">
            <Input
              size="xs"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a project"
              aria-label="Find a project"
            />
          </div>
        ) : null}
        <ul className="flex max-h-96 flex-col overflow-auto">
          {!query ? (
            <li>
              <button
                type="button"
                onClick={() => choose("")}
                className={cn(attachedItem, row)}
              >
                <Layers aria-hidden className="icon-sm shrink-0 text-text-low" />
                <span className="flex-1">All projects</span>
                {!value ? <Check aria-hidden className="icon-sm shrink-0" /> : null}
              </button>
            </li>
          ) : null}
          {shown.map((project) => (
            <li key={project.root}>
              <button
                type="button"
                onClick={() => choose(project.root)}
                title={project.root}
                className={cn(attachedItem, row)}
              >
                <FolderGit2 aria-hidden className="icon-sm shrink-0 text-text-low" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-text-high">{project.name}</span>
                  <span className="truncate text-2xs text-text-low">
                    {[
                      project.sessions
                        ? `${project.sessions} session${project.sessions === 1 ? "" : "s"}`
                        : "",
                      project.saved ? `${project.saved} saved` : "",
                      project.lastActive ? ago(project.lastActive) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || project.root}
                  </span>
                </span>
                {project.root === value ? (
                  <Check aria-hidden className="icon-sm shrink-0" />
                ) : null}
              </button>
            </li>
          ))}
          {query && shown.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-text-low">No project matches.</li>
          ) : null}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenFolder();
            }}
            className={cn(attachedItem, row)}
          >
            <FolderPlus aria-hidden className="icon-sm shrink-0 text-text-low" />
            <span className="flex-1">Open folder…</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
