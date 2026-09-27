/**
 * Syntax colour for the code pane, in the design system's own colours.
 *
 * lowlight (highlight.js as a syntax tree) rather than a themed highlighter:
 * a theme paints with hex values that are right in one mode and unmeasured in
 * the other, while a tree lets each token class map onto a semantic `-ink`
 * token — the ones built and contrast-tested for coloured text on a surface,
 * in both themes. Seven categories, not highlight.js's forty: a reader needs
 * keywords, strings and comments apart, not a rainbow.
 */

import { common, createLowlight } from "lowlight";

export type Category =
  "keyword" | "string" | "comment" | "number" | "title" | "type" | "attr" | "regexp";

/** A coloured character range. Uncoloured text has no run. */
export interface Run {
  start: number;
  end: number;
  category: Category;
}

export const CATEGORY_CLASS: Record<Category, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  comment: "text-text-low italic",
  number: "text-syntax-number",
  title: "text-syntax-title",
  type: "text-syntax-type",
  attr: "text-syntax-attr",
  regexp: "text-syntax-regexp",
};

const CLASS_CATEGORY: Record<string, Category> = {
  "hljs-keyword": "keyword",
  "hljs-built_in": "type",
  "hljs-type": "type",
  "hljs-literal": "number",
  "hljs-number": "number",
  "hljs-string": "string",
  "hljs-template-tag": "string",
  "hljs-char": "string",
  "hljs-comment": "comment",
  "hljs-doctag": "comment",
  "hljs-quote": "comment",
  "hljs-title": "title",
  "hljs-section": "title",
  "hljs-name": "title",
  "hljs-tag": "keyword",
  "hljs-selector-tag": "keyword",
  "hljs-selector-class": "title",
  "hljs-selector-id": "title",
  "hljs-attr": "attr",
  "hljs-attribute": "attr",
  "hljs-property": "attr",
  "hljs-meta": "comment",
  "hljs-regexp": "regexp",
  "hljs-symbol": "number",
  "hljs-bullet": "keyword",
  "hljs-link": "string",
  "hljs-addition": "string",
  "hljs-deletion": "regexp",
};

const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  go: "go",
  py: "python",
  rb: "ruby",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  html: "xml",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  diff: "diff",
};

export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "Makefile") return "makefile";
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return name.includes(".") ? EXTENSIONS[extension] : undefined;
}

const lowlight = createLowlight(common);

/** Past this, highlighting costs more than it gives. */
const MAX_CHARS = 300_000;

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  properties?: { className?: unknown };
}

function categoryOf(node: Node): Category | undefined {
  const classes = node.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  for (const name of classes) {
    const category = CLASS_CATEGORY[String(name)];
    if (category) return category;
  }
  return undefined;
}

const cache = new Map<string, Run[]>();

/** Coloured runs for `text`, by character offset. Cached by content. */
export function tokenize(text: string, language: string | undefined): Run[] {
  if (!language || !text || text.length > MAX_CHARS) return [];
  const key = `${language}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const runs: Run[] = [];
  let offset = 0;
  const walk = (node: Node, inherited: Category | undefined) => {
    if (node.type === "text") {
      const length = node.value?.length ?? 0;
      if (inherited) {
        const last = runs.at(-1);
        if (last && last.end === offset && last.category === inherited)
          last.end += length;
        else runs.push({ start: offset, end: offset + length, category: inherited });
      }
      offset += length;
      return;
    }
    const category = categoryOf(node) ?? inherited;
    for (const child of node.children ?? []) walk(child, category);
  };
  try {
    walk(lowlight.highlight(language, text) as Node, undefined);
  } catch {
    return [];
  }

  cache.set(key, runs);
  // A replay touches a few dozen versions of a file; keep the recent ones.
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return runs;
}

export interface Painted {
  text: string;
  category?: Category;
}

/** Cut `text`, which starts at `at` in the tokenized source, by its runs. */
export function paint(text: string, at: number, runs: readonly Run[]): Painted[] {
  if (runs.length === 0) return [{ text }];
  const end = at + text.length;
  // First run that ends after `at`.
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid]!.end <= at) lo = mid + 1;
    else hi = mid;
  }
  const out: Painted[] = [];
  let cursor = at;
  for (let i = lo; i < runs.length && runs[i]!.start < end; i++) {
    const run = runs[i]!;
    const start = Math.max(run.start, at);
    if (start > cursor) out.push({ text: text.slice(cursor - at, start - at) });
    const stop = Math.min(run.end, end);
    out.push({ text: text.slice(start - at, stop - at), category: run.category });
    cursor = stop;
  }
  if (cursor < end) out.push({ text: text.slice(cursor - at) });
  return out;
}
