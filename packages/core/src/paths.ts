/**
 * POSIX path arithmetic — the kind agent logs, shells and git all speak —
 * in one place, without `node:path`, so it runs in the player too.
 */

function collapse(path: string, keep: string[] = []): string[] {
  const parts = [...keep];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts;
}

/** `/a/./b/../c` → `/a/c`. Always absolute. */
export function normalizePath(path: string): string {
  return `/${collapse(path).join("/")}`;
}

/** `target` as a shell in `dir` would resolve it. Both absolute. */
export function resolvePath(dir: string, target: string): string {
  return normalizePath(target.startsWith("/") ? target : `${dir}/${target}`);
}

/** A repo-relative `spec` from a repo-relative `dir`: `src` + `../lib/a` → `lib/a`. */
export function joinPath(dir: string, spec: string): string {
  return collapse(spec, dir ? dir.split("/") : []).join("/");
}
