import type { TreeLine } from "@/ui";

import { fileName } from "../labels";

export const DIR_ID = "d:";
export const FILE_ID = "f:";

interface Dir {
  path: string;
  dirs: Map<string, Dir>;
  files: string[];
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Folders and files as tree lines — folders first, each level sorted, and a
 * chain of folders with nothing else in them folded into one row
 * (`packages/app/src`), the way an editor's explorer compacts them.
 */
export function treeLines(paths: Iterable<string>): TreeLine[] {
  const root: Dir = { path: "", dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (const name of parts.slice(0, -1)) {
      let next = node.dirs.get(name);
      if (!next) {
        next = {
          path: node.path ? `${node.path}/${name}` : name,
          dirs: new Map(),
          files: [],
        };
        node.dirs.set(name, next);
      }
      node = next;
    }
    node.files.push(path);
  }
  const lines: TreeLine[] = [];
  const emit = (node: Dir, parentId: string | null) => {
    for (const name of [...node.dirs.keys()].sort(byName)) {
      let dir = node.dirs.get(name)!;
      let label = name;
      while (dir.files.length === 0 && dir.dirs.size === 1) {
        const [[next, child]] = [...dir.dirs.entries()] as [[string, Dir]];
        label = `${label}/${next}`;
        dir = child;
      }
      const id = DIR_ID + dir.path;
      lines.push({ id, parentId, container: true, label });
      emit(dir, id);
    }
    for (const path of node.files.sort((a, b) => byName(fileName(a), fileName(b)))) {
      lines.push({ id: FILE_ID + path, parentId, label: fileName(path) });
    }
  };
  emit(root, null);
  return lines;
}

/** Every folder above `path`, as tree ids. */
export function ancestorIds(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => DIR_ID + parts.slice(0, i + 1).join("/"));
}
