import * as React from "react";

import {
  api,
  type ApiResult,
  type RepoFile,
  type RepoTree,
  type ReplaySource,
} from "../api";

export type Fetched<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "failed"; message: string };

function settle<T>(result: ApiResult<T>): Fetched<T> {
  return result.ok
    ? { state: "ready", data: result.data }
    : {
        state: "failed",
        message: result.failure.message,
      };
}

export interface Repo {
  /** The repository at the replay's base, once asked for. */
  tree?: Fetched<RepoTree>;
  /** Ask for the tree; it is loaded once. */
  loadTree: () => void;
  /** A file outside the replay, at the base, once asked for. */
  fileAt: (path: string) => Fetched<RepoFile> | undefined;
  /** Ask for a file outside the replay; it is loaded once. */
  requestFile: (path: string) => void;
}

/**
 * The rest of the repository a replay happened in — every other file, as it
 * was at the base commit, which is also how it stayed: the replay changed
 * none of them. Loaded lazily, from the local service, only when the
 * reviewer opens the whole tree.
 */
export function useRepo(source: ReplaySource | undefined): Repo {
  const [tree, setTree] = React.useState<Fetched<RepoTree>>();
  const [files, setFiles] = React.useState<ReadonlyMap<string, Fetched<RepoFile>>>(
    new Map(),
  );
  const asked = React.useRef(new Set<string>());

  const loadTree = React.useCallback(() => {
    if (!source || asked.current.has("\u0000tree")) return;
    asked.current.add("\u0000tree");
    setTree({ state: "loading" });
    void api.tree(source).then((result) => setTree(settle<RepoTree>(result)));
  }, [source]);

  const rev = tree?.state === "ready" ? tree.data.rev : undefined;
  React.useEffect(() => {
    // Any file asked for before the tree arrived is fetched now.
    if (!source || !rev) return;
    for (const [path, fetched] of files) {
      if (fetched.state !== "loading" || asked.current.has(path)) continue;
      asked.current.add(path);
      void api
        .file(source, rev, path)
        .then((result) =>
          setFiles((all) => new Map(all).set(path, settle<RepoFile>(result))),
        );
    }
  }, [source, rev, files]);

  const fileAt = React.useCallback((path: string) => files.get(path), [files]);
  const requestFile = React.useCallback(
    (path: string) => {
      if (!source) return;
      // Queued as loading; the effect above fetches it once the base is known.
      setFiles((all) =>
        all.has(path) ? all : new Map(all).set(path, { state: "loading" }),
      );
      loadTree();
    },
    [source, loadTree],
  );

  return { tree, loadTree, fileAt, requestFile };
}
