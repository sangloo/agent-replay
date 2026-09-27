/**
 * The order to meet a codebase in, when a replay has to introduce many files
 * at once — the first commit of a history, or a snapshot to learn from.
 *
 * Alphabetical is the order nobody reads in. This is the order a person
 * explaining the repository would take: what it is (README), how it is put
 * together (manifests and config), where it starts (entry points), then
 * down the import graph from there, each file after the one that first uses
 * it — and tests and leftovers last. A model can reorder it (`order` in the
 * history options); this is the answer without one.
 */

import { joinPath } from "./paths.ts";

export interface SourceFile {
  path: string;
  content: string | null;
}

const MANIFEST =
  /(^|\/)(package\.json|pnpm-workspace\.yaml|go\.mod|Cargo\.toml|pyproject\.toml|setup\.py|requirements\.txt|Gemfile|pom\.xml|build\.gradle(\.kts)?|composer\.json|Makefile|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|tsconfig\.json)$/;
const ENTRY =
  /(^|\/)(main|index|app|server|cli|mod|lib|__main__|__init__)\.(ts|tsx|js|jsx|mjs|go|py|rs)$|(^|\/)cmd\/[^/]+\/main\.go$/;
const TEST =
  /(^|\/)(__tests__|tests?|spec|e2e|testdata)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/;
const SOURCE =
  /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|php|swift|c|h|cpp|cs|vue|svelte)$/;

function depth(path: string): number {
  return path.split("/").length - 1;
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** The repository files a file imports, as best a regex can tell. */
export function importsOf(
  file: SourceFile,
  paths: ReadonlySet<string>,
  goModule?: string,
): string[] {
  const text = file.content ?? "";
  const dir = dirOf(file.path);
  const found: string[] = [];
  const add = (candidate: string) => {
    if (paths.has(candidate) && candidate !== file.path && !found.includes(candidate)) {
      found.push(candidate);
    }
  };

  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(file.path)) {
    const specs = text.matchAll(
      /(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)["']([^"']+)["']/g,
    );
    for (const [, spec] of specs) {
      if (!spec || !spec.startsWith(".")) continue;
      const base = joinPath(dir, spec).replace(/\.(js|mjs|cjs)$/, "");
      for (const suffix of [
        "",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        "/index.ts",
        "/index.tsx",
        "/index.js",
      ]) {
        add(base + suffix);
      }
    }
  } else if (file.path.endsWith(".go")) {
    const block = /import\s*\(([\s\S]*?)\)|import\s+"([^"]+)"/g;
    for (const match of text.matchAll(block)) {
      const specs = match[1]
        ? [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
        : [match[2]!];
      for (const spec of specs) {
        if (!goModule || !spec.startsWith(`${goModule}/`)) continue;
        const pkg = spec.slice(goModule.length + 1);
        for (const path of paths) {
          if (dirOf(path) === pkg && path.endsWith(".go") && !path.endsWith("_test.go"))
            add(path);
        }
      }
    }
  } else if (file.path.endsWith(".py")) {
    for (const [, spec] of text.matchAll(
      /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm,
    )) {
      if (!spec) continue;
      const rel = spec.startsWith(".")
        ? joinPath(dir, spec.replace(/^\.+/, "").replaceAll(".", "/"))
        : spec.replaceAll(".", "/");
      add(`${rel}.py`);
      add(`${rel}/__init__.py`);
    }
  }
  return found;
}

/** `top` is the shallowest depth among the files: the root of what is shown. */
function rank(path: string, top: number): number {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/^readme(\.|$)/i.test(name)) return depth(path) === top ? 0 : 5;
  if (MANIFEST.test(path)) return depth(path) === top ? 1 : 2;
  if (ENTRY.test(path) && !TEST.test(path)) return 3;
  if (TEST.test(path)) return 7;
  if (SOURCE.test(path)) return 4;
  return 6;
}

export function readingOrder(files: readonly SourceFile[]): string[] {
  const paths = new Set(files.map((file) => file.path));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const goModule = /^module\s+(\S+)/m.exec(byPath.get("go.mod")?.content ?? "")?.[1];
  // A package's own README leads when only that package is being shown.
  const top = Math.min(...[...paths].map(depth));
  const sorted = [...paths].sort(
    (a, b) => rank(a, top) - rank(b, top) || depth(a) - depth(b) || a.localeCompare(b),
  );

  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string) => {
    // Depth-first from each file: a file, then what it uses, before moving on.
    const stack = [path];
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      const file = byPath.get(next);
      if (!file || TEST.test(next)) continue;
      const imports = importsOf(file, paths, goModule).filter(
        (p) => !seen.has(p) && !TEST.test(p),
      );
      stack.push(...imports.reverse());
    }
  };
  for (const path of sorted) {
    // Docs and manifests first as themselves; entry points pull in their graph.
    if (rank(path, top) <= 4) visit(path);
  }
  for (const path of sorted) if (!seen.has(path)) visit(path);
  return order;
}

/**
 * The order to BUILD files in, rather than read them: what a file uses comes
 * before it, so nothing is written against code that does not exist yet.
 * The README and manifests still lead, and tests follow what they test.
 */
export function buildOrder(files: readonly SourceFile[]): string[] {
  const paths = new Set(files.map((file) => file.path));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const goModule = /^module\s+(\S+)/m.exec(byPath.get("go.mod")?.content ?? "")?.[1];
  const top = Math.min(...[...paths].map(depth));
  const sorted = [...paths].sort(
    (a, b) => rank(a, top) - rank(b, top) || depth(a) - depth(b) || a.localeCompare(b),
  );
  const order: string[] = [];
  const seen = new Set<string>();
  // Post-order without recursion: a file is placed once everything it
  // imports has been.
  const visit = (start: string) => {
    const stack: { path: string; expanded: boolean }[] = [
      { path: start, expanded: false },
    ];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.expanded) {
        order.push(item.path);
        continue;
      }
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      stack.push({ path: item.path, expanded: true });
      const file = byPath.get(item.path);
      if (!file) continue;
      const imports = importsOf(file, paths, goModule).filter(
        (p) => !seen.has(p) && !TEST.test(p),
      );
      for (const next of imports.reverse()) stack.push({ path: next, expanded: false });
    }
  };
  for (const path of sorted) if (!TEST.test(path)) visit(path);
  for (const path of sorted) visit(path);
  return order;
}
