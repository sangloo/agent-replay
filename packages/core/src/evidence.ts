/**
 * What the agent checked, and what that evidence is worth.
 *
 * A reviewer reading "all tests pass" at the end of a session wants to know
 * three things the transcript holds but never says: which checks actually
 * ran, whether they passed or only looked like it, and whether anything
 * changed after the last one. This reads that from the steps — commands,
 * their exit status and output, and every change — and says it plainly.
 *
 * Heuristic by nature (it recognises commands and output by shape), and
 * written to err towards telling the reviewer to look.
 */

import type { CommandStep, Replay, Step } from "./format.ts";

export type CheckKind = "test" | "typecheck" | "lint" | "build" | "format";

export interface Check {
  /** The command's index in `replay.steps`. */
  index: number;
  kind: CheckKind;
  command: string;
  passed: boolean;
  /**
   * The command exited 0 but its output reports failures — usually a pipe
   * (`| tail`, `| grep`) or `|| true` swallowing the exit status.
   */
  masked?: boolean;
  /** What the output says about the run, when it says: "73 passed". */
  summary?: string;
}

export interface TestEdit {
  index: number;
  path: string;
  /** What about the edit weakens the tests. */
  concerns: string[];
}

export interface Claim {
  /** The step whose text makes the claim. */
  index: number;
  text: string;
  kind: CheckKind;
  /** A passing check of that kind after the last change before the claim. */
  backedBy?: number;
}

export interface Ledger {
  checks: Check[];
  /** Per kind, the last run and what changed after it. */
  latest: { kind: CheckKind; check: Check; changedAfter: string[] }[];
  /** Files changed after the last passing check of any kind. */
  unverified: string[];
  /** Failing checks never followed by a passing run of the same kind. */
  unresolved: Check[];
  testEdits: TestEdit[];
  claims: Claim[];
}

const KINDS: readonly [CheckKind, RegExp][] = [
  [
    "test",
    /\b(vitest|jest|mocha|ava|pytest|py\.test|go\s+test|cargo\s+(?:test|nextest)|rspec|phpunit|dotnet\s+test|playwright\s+test|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|verify|check)\b|node\s+--test|deno\s+test|mix\s+test|gradle\w*\s+test|mvn\s+test)\b/,
  ],
  [
    "typecheck",
    /\b(tsc\b(?![^\n]*--init)|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?typecheck|mypy|pyright|cargo\s+check|go\s+vet)\b/,
  ],
  [
    "lint",
    /\b(eslint|biome\s+(?:check|lint)|ruff\s+check|clippy|golangci-lint|rubocop|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?lint)\b/,
  ],
  [
    "format",
    /\b(prettier\s+[^\n]*--check|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?format:check|gofmt\s+-l|ruff\s+format\s+--check|black\s+--check)\b/,
  ],
  [
    "build",
    /\b((?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build|vite\s+build|next\s+build|cargo\s+build|go\s+build|tsc\s+-b|make\b(?!\s+-n))\b/,
  ],
];

// A command's first line only: a heredoc body is not the command.
const commandLine = (command: string) => command.split("\n")[0] ?? "";

/** What kind of check a command is, if it is one. */
export function checkKind(command: string): CheckKind | undefined {
  const line = commandLine(command);
  // `cat`, `grep`, `sed -n` over a file named like a runner is not a run.
  if (
    /^\s*(cat|grep|rg|sed|head|tail|less|ls|echo|git\s+(?:log|show|diff))\b/.test(line)
  )
    return undefined;
  return KINDS.find(([, pattern]) => pattern.test(line))?.[0];
}

const FAILED_OUTPUT =
  /(\b[1-9]\d* (?:failed|failing|errors?)\b|^\s*FAIL\b|\bTests?:\s+[1-9]\d* failed|✗|×\s|\bERR!|error TS\d+|^error(?:\[\w+\])?:|Command failed|exited with (?:code )?[1-9]|\bpanicked\b|^FAILED\b|AssertionError)/im;
const SWALLOWS =
  /\|\s*(?:tail|head|grep|sed|awk|tee|cut|sort|less)\b|\|\|\s*true\b|;\s*true\s*$|;\s*echo\b|\bset \+e\b/m;

function summaryOf(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const patterns = [
    /Tests\s+(\d+ failed[^\n]*?)(?:\n|$)/,
    /Tests\s+(\d+ passed[^\n]*?)(?:\n|$)/,
    /(\d+ (?:passed|failed)(?:, \d+ (?:passed|failed|skipped))*)/,
    /(Found \d+ errors?)/,
    /(\d+ problems? \([^)]*\))/,
    /(ok\s+\S+\s+[\d.]+s)/,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1]!.trim().replace(/\s+/g, " ");
  }
  return undefined;
}

function checkOf(step: CommandStep, index: number): Check | undefined {
  const kind = checkKind(step.command);
  if (!kind) return undefined;
  const output = step.output ?? "";
  const failedByOutput = FAILED_OUTPUT.test(output);
  const masked = !step.failed && failedByOutput && SWALLOWS.test(step.command);
  const check: Check = {
    index,
    kind,
    command: commandLine(step.command),
    passed: !step.failed && !masked,
  };
  if (masked) check.masked = true;
  const summary = summaryOf(output);
  if (summary) check.summary = summary;
  return check;
}

const TEST_FILE =
  /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|^test_[^/]*\.py$|\/test_[^/]*\.py$|Tests?\.(cs|java|kt)$/;

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

const ASSERTION =
  /\b(expect|assert\w*|should|t\.(?:Error|Fatal|Fail)\w*|require\.\w+|toBe|toEqual)\b/g;
const SKIP =
  /\.(skip|only|todo)\(|\b(xit|xdescribe|xtest)\(|@pytest\.mark\.skip|t\.Skip\(|#\[ignore\]|@Disabled|@Ignore/g;

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

/** Why an edit to a test file might weaken it, from its before and after. */
function weakeningOf(before: string, after: string): string[] {
  const concerns: string[] = [];
  const lost = count(before, ASSERTION) - count(after, ASSERTION);
  if (lost > 0) concerns.push(`${lost} assertion${lost === 1 ? "" : "s"} fewer`);
  const skipped = count(after, SKIP) - count(before, SKIP);
  if (skipped > 0)
    concerns.push(`${skipped} test${skipped === 1 ? "" : "s"} skipped or focused`);
  if (before.trim() && !after.trim()) concerns.push("emptied");
  return concerns;
}

function changedPath(step: Step): string | undefined {
  return step.kind === "edit" ||
    step.kind === "write" ||
    step.kind === "delete" ||
    step.kind === "external"
    ? step.path
    : undefined;
}

// Prose does not make a test run stale: a README edited after the last run
// leaves the run's verdict standing.
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)(docs?|\.replays)\//i;

/** A change that could alter what a check would say. */
function codeChange(step: Step): string | undefined {
  const path = changedPath(step);
  return path && !PROSE.test(path) ? path : undefined;
}

const CLAIMS: readonly [CheckKind, RegExp][] = [
  [
    "test",
    /\b(all (?:\d+ )?tests? (?:now )?pass(?:es|ing)?|tests? (?:are |all |now )*(?:pass(?:es|ing)?|green)|(?:\d+|every) tests? pass)/i,
  ],
  [
    "typecheck",
    /\b(type-?checks? (?:pass(?:es)?|clean|green)|no type errors|tsc (?:passes|is clean))/i,
  ],
  [
    "lint",
    /\b(lint(?:s|ing)? (?:passes|is clean|clean|green)|no lint (?:errors|warnings))/i,
  ],
  ["build", /\b(builds? (?:passes|succeeds|successfully|green|cleanly))/i],
];

/**
 * @param contents a file's content before a step, for test-edit concerns;
 * `play(replay).frames[i].change.before` is exactly that.
 */
export function evidenceOf(
  replay: Replay,
  contents?: (
    index: number,
  ) => { before: string | null; after: string | null } | undefined,
): Ledger {
  const checks: Check[] = [];
  const testEdits: TestEdit[] = [];
  const claims: Claim[] = [];
  /** For each step, the index of the last change at or before it. */
  let lastChange = -1;
  const lastChangeBefore: number[] = [];

  replay.steps.forEach((step, index) => {
    const path = changedPath(step);
    if (codeChange(step)) lastChange = index;
    if (path) {
      if (isTestFile(path) && contents) {
        const change = contents(index);
        const concerns =
          change && change.before !== null
            ? change.after === null
              ? ["deleted"]
              : weakeningOf(change.before, change.after)
            : [];
        if (concerns.length) testEdits.push({ index, path, concerns });
      }
    }
    lastChangeBefore[index] = lastChange;
    if (step.kind === "command") {
      const check = checkOf(step, index);
      if (check) checks.push(check);
    }
  });

  // Claims in the agent's own words, each weighed against the checks.
  replay.steps.forEach((step, index) => {
    if (step.kind !== "say") return;
    const text = step.text;
    for (const [kind, pattern] of CLAIMS) {
      const match = text.match(pattern);
      if (!match) continue;
      const since = lastChangeBefore[index] ?? -1;
      const backing = checks
        .filter((c) => c.kind === kind && c.index > since && c.index < index)
        .at(-1);
      const claim: Claim = {
        index,
        text: sentenceAround(text, match.index ?? 0),
        kind,
      };
      if (backing?.passed) claim.backedBy = backing.index;
      claims.push(claim);
    }
  });

  const changedAfter = (after: number) => [
    ...new Set(
      replay.steps.flatMap((step, index) => {
        const path = index > after ? codeChange(step) : undefined;
        return path ? [path] : [];
      }),
    ),
  ];

  const latest = (["test", "typecheck", "lint", "format", "build"] as const).flatMap(
    (kind) => {
      const check = checks.filter((c) => c.kind === kind).at(-1);
      return check ? [{ kind, check, changedAfter: changedAfter(check.index) }] : [];
    },
  );
  const lastPass = checks.filter((c) => c.passed).at(-1);
  const everChanged = replay.steps.some((step) => codeChange(step) !== undefined);
  const unverified = lastPass
    ? changedAfter(lastPass.index)
    : everChanged
      ? changedAfter(-1)
      : [];
  const unresolved = checks.filter(
    (check) =>
      !check.passed &&
      !checks.some(
        (later) =>
          later.kind === check.kind && later.index > check.index && later.passed,
      ),
  );

  return { checks, latest, unverified, unresolved, testEdits, claims };
}

function sentenceAround(text: string, at: number): string {
  const start = Math.max(
    text.lastIndexOf(". ", at) + 1,
    text.lastIndexOf("\n", at) + 1,
    0,
  );
  const ends = [text.indexOf(". ", at), text.indexOf("\n", at)].filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  const sentence = text.slice(start, end).trim();
  return sentence.length > 200 ? `${sentence.slice(0, 199)}…` : sentence;
}

/**
 * What a reviewer should look at, grouped: each kind of concern once, with
 * the steps it points at. Empty when the evidence holds up.
 */
export type ConcernKind =
  "no-checks" | "unresolved" | "weakened" | "unbacked" | "stale";

export interface Concern {
  kind: ConcernKind;
  /** Steps to look at, by index. */
  steps: number[];
}

export function concernsOf(ledger: Ledger): Concern[] {
  const out: Concern[] = [];
  if (ledger.checks.length === 0) out.push({ kind: "no-checks", steps: [] });
  if (ledger.unresolved.length)
    out.push({ kind: "unresolved", steps: ledger.unresolved.map((c) => c.index) });
  if (ledger.testEdits.length)
    out.push({ kind: "weakened", steps: ledger.testEdits.map((e) => e.index) });
  const unbacked = ledger.claims.filter((claim) => claim.backedBy === undefined);
  if (unbacked.length)
    out.push({ kind: "unbacked", steps: unbacked.map((c) => c.index) });
  if (ledger.unverified.length) out.push({ kind: "stale", steps: [] });
  return out;
}
