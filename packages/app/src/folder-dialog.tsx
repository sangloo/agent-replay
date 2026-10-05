import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
} from "@/ui";
import { ArrowUp, Folder, FolderGit2, Home } from "lucide-react";
import * as React from "react";

import { api, type FolderListing, type Project } from "./api";

/**
 * Choose a folder on this machine: type or paste a path, or walk there. The
 * browser cannot hand a web page a real path, so the local service lists the
 * folders — this dialog only ever reads names.
 */
export function FolderDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (project: Project) => void;
}) {
  const [listing, setListing] = React.useState<FolderListing>();
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [adding, setAdding] = React.useState(false);

  const go = React.useCallback(async (path?: string) => {
    const result = await api.folders(path);
    if (result.ok) {
      setListing(result.data);
      setTyped(result.data.path);
      setError(undefined);
    } else {
      setError(result.failure.message);
    }
  }, []);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && !listing) void go();
  }

  const add = async () => {
    setAdding(true);
    const result = await api.addProject(typed.trim());
    setAdding(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    onAdded(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Open a folder</DialogTitle>
          <DialogDescription>
            A repository — or any folder agents worked in. Its sessions and saved
            replays are listed from then on.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void go(typed.trim());
          }}
        >
          <IconButton
            type="button"
            label="Home folder"
            variant="ghost"
            size="sm"

            onClick={() => void go()}
          >
            <Home />
          </IconButton>
          <IconButton
            type="button"
            label="Up one folder"
            variant="ghost"
            size="sm"

            disabled={!listing?.parent}
            onClick={() => listing?.parent && void go(listing.parent)}
          >
            <ArrowUp />
          </IconButton>
          <Input
            size="sm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="~/code/my-project"
            aria-label="Folder path"
            className="flex-1 font-mono"
          />
        </form>
        <ul
          aria-label="Folders"
          className="h-72 overflow-auto rounded-panel bg-surface-low py-1"
        >
          {listing?.folders.length === 0 ? (
            <li className="px-3 py-2 text-xs text-text-low">No folders inside.</li>
          ) : null}
          {listing?.folders.map((folder) => (
            <li key={folder.path}>
              <button
                type="button"
                onClick={() => void go(folder.path)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm focus-bar hover:bg-hover",
                )}
              >
                {folder.repo ? (
                  <FolderGit2 aria-hidden className="icon-sm shrink-0 text-text-mid" />
                ) : (
                  <Folder aria-hidden className="icon-sm shrink-0 text-text-low" />
                )}
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {folder.repo ? (
                  <span className="shrink-0 text-2xs text-text-low">repository</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {error ? <p className="text-xs text-danger-ink">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void add()} loading={adding} disabled={!typed.trim()}>
            {listing?.repo || !listing ? "Open this repository" : "Open this folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
