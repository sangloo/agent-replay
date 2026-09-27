/**
 * `replay` — agent sessions and git history, replayed change by change. The
 * commands are in `USAGE` below, which `replay help` prints.
 *
 * Runs straight from source under Node's type stripping (Node ≥ 22.18) from a
 * checkout, and as one bundled file in the published package (`pnpm package`),
 * so nothing here may depend on where its own source lives.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  annotate,
  concernsOf,
  outline,
  parseRanges,
  evidenceOf,
  isChange,
  play,
  readNotes,
  type Replay,
} from "@agent-replay/core";

import { captureSession } from "./capture.ts";
import * as git from "./git.ts";
import {
  currentSessionId,
  findSession,
  listSessions,
  type SessionSummary,
} from "./sessions.ts";
import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_MODEL, explain } from "./explain.ts";
import {
  addExplain,
  addLesson,
  courseTarget,
  example,
  fill,
  loadCourse,
  progressOf,
  startCourse,
  take,
  undo,
  write,
  type Course,
} from "./course.ts";
import { exportHtml, hasPlayer, playerDist } from "./export.ts";
import { captureHistory } from "./history.ts";
import { readPayload, runHook } from "./hook.ts";
import { serve } from "./serve.ts";
import { claudeSettings, hookCommand, installClaude, snippets } from "./setup.ts";
import { installSkills, skill, skills } from "./skills.ts";
import { saveReplay } from "./store.ts";

const USAGE = `\`replay\` — agent sessions and git history, replayed change by change.
Works with Claude Code, Codex and Gemini CLI sessions, in any git repository.

  replay [open] [--port 5180] [--no-browser]  the player (the default command)
  replay list                                 agent sessions on this machine
  replay capture [options]                    save a session to <repo>/.replays/
    --session <id|log file>                   default: this session, else the latest here
    --repo <dir>                              default: the repository you are in
    --title "<what it did>"                   default: the first prompt's first line
    --base <rev> / --end <rev>                override either end
    --thinking                                keep the agent's thinking, if recorded
  replay history [options]                    the repository itself, commit by commit
    --from <rev> / --to <rev>                 default: the root (or last --limit) → HEAD
    --path <dir>                              only this part of the repository (repeatable)
    --learn                                   introduce the files at --from first, in
                                              reading order, then follow the commits
    --limit <n>                               most commits without --from (300)
  replay explain <replay.json> [--model <id>] a small model's notes: per commit or turn,
                                              and a tour where many files arrive at once
  replay export [<replay.json>] [options]     one HTML file that plays the replay
                                              anywhere, offline — attach it to a PR
    --session <id|log file>                   a session instead of a saved replay
    -o, --out <file.html>                     default: beside the replay, or here
  replay check [<replay.json>] [--session]    what the agent checked, and whether it
                                              held — exits 1 when something needs a look
  replay course <command>                     teach a repository: rebuild it from nothing,
                                              lesson by lesson — \`replay course help\`
  replay skills [<name> | install [--user]]   the skills that teach a model these tools
  replay steps <replay.json>                  the steps a note can attach to
  replay annotate <replay.json> <notes.json|->
  replay setup [--project]                    capture automatically after every turn
  replay hook                                 what an agent's hook runs (reads its JSON)
`;

const COURSE_USAGE = `\`replay course\` — rebuild a repository from nothing, as lessons, for someone
learning it. Every command appends one step to the course in .replays/ and
prints where it stands; open it in the player at any moment to see it play.

  start --title "<course>" [--to <rev>] [--path <dir>]…
                              begin a course towards <rev> (HEAD), all of it or part
  status [--all]              progress: files complete, partial, not started; next up
  outline <path> [--lines a-b]
                              the target file, numbered, with where each definition starts
  lesson "<title>" [--goal "<what they will be able to do>"]
                              start a lesson
  explain [--file <path>] [--lines a-b] ["<markdown>" | -]
                              teaching text (Markdown, $math$), about code when --file;
                              --lines are the real file's (as outline and take count)
  take <path> [--lines 1-20,45-80] [--why "<text>"]
                              the next piece of a real file: those lines of it at the
                              target — or all of it — exactly as they are there
  write <path> [--why "<text>"] < content
                              a hand-written version of a real file (a simpler draft)
  example <path> [--why "<text>"] < content
                              teaching material that is not part of the repository
  fill [<path or glob>…] [--why "<text>"]
                              bring every remaining matching file to the target
  undo [<n>]                  take back the last step (or the last n)
  check                       exit 0 only when every file matches the target

All of them take --course <name> to pick a course other than the newest.`;

const here = process.env.INIT_CWD ?? process.cwd();

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    fail(`${flag} needs a whole number above 0`);
  return number;
}

/** Open the page in the default browser; quietly nothing where there is none. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No opener here (a server, a container): the URL is printed above.
  }
}

/** From a checkout, the player is built on first use; a package ships it built. */
function buildPlayer(): void {
  print("Building the player once…");
  const built = spawnSync("pnpm", ["exec", "vite", "build"], {
    cwd: dirname(playerDist()),
    stdio: "inherit",
  });
  if (built.status !== 0) fail("could not build the player");
}

function lineCount(content: string): string {
  const n = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return `${n} line${n === 1 ? "" : "s"}`;
}

/** Where a course stands, in one line: what a model reads after each step. */
function courseLine(course: Course): string {
  const target = courseTarget(course);
  const p = progressOf(course, target);
  const percent = p.totalLines ? Math.round((p.lines / p.totalLines) * 100) : 100;
  return `${p.lessons} lesson${p.lessons === 1 ? "" : "s"} · ${p.steps} steps · ${p.complete}/${p.files.length} files complete${p.partial ? `, ${p.partial} partial` : ""} · ${percent}% of lines`;
}

function readStdin(): string {
  if (process.stdin.isTTY) fail("expected the text on stdin (a heredoc or a pipe)");
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runCourse(args: string[]): void {
  const [sub = "help", ...more] = args;
  if (sub === "help" || more.includes("--help") || more.includes("-h")) {
    print(COURSE_USAGE);
    return;
  }
  const { values, positionals } = parseArgs({
    args: more,
    allowPositionals: true,
    options: {
      course: { type: "string" },
      repo: { type: "string" },
      title: { type: "string" },
      to: { type: "string" },
      path: { type: "string", multiple: true },
      goal: { type: "string" },
      file: { type: "string" },
      lines: { type: "string" },
      why: { type: "string" },
      all: { type: "boolean" },
    },
  });
  const root = git.repoRoot(values.repo ? resolve(here, values.repo) : here);
  if (!root) fail("not in a git repository (pass --repo)");
  // Paths as git names them: relative to the root, whatever directory we are in.
  const repoPath = (path: string) =>
    relative(root, resolve(here, path)).split("\\").join("/");

  if (sub === "start") {
    if (!values.title)
      fail('usage: replay course start --title "<course>" [--to <rev>] [--path <dir>]');
    const course = startCourse(root, {
      title: values.title,
      rev: values.to,
      paths: values.path?.map(repoPath),
    });
    const target = courseTarget(course);
    const order = [...target.files.entries()];
    print(
      [
        `Started "${values.title}" → ${relative(here, course.file) || course.file}`,
        `  towards ${target.rev.slice(0, 7)}: ${order.length} files to build${target.skipped.length ? `, ${target.skipped.length} left out (lockfiles, binaries, very large)` : ""}`,
        "  In build order (what a file uses comes first):",
        ...order
          .slice(0, 60)
          .map(([path, content]) => `    ${path}  (${lineCount(content)})`),
        ...(order.length > 60
          ? [`    … and ${order.length - 60} more — \`replay course status --all\``]
          : []),
      ].join("\n"),
    );
    return;
  }

  let course = loadCourse(root, values.course);
  const target = courseTarget(course);
  const ranges = values.lines ? parseRanges(values.lines) : undefined;

  switch (sub) {
    case "status": {
      const p = progressOf(course, target);
      const lines = [
        `"${course.replay.title}" → ${target.rev.slice(0, 7)}  (${course.name})`,
        `  ${courseLine(course)}`,
      ];
      const partial = p.files.filter((f) => f.status === "partial");
      if (partial.length) {
        lines.push("  Partial:");
        for (const f of partial)
          lines.push(`    ${f.path}  ${f.lines}/${f.totalLines} lines`);
      }
      const missing = p.files.filter((f) => f.status === "missing");
      if (missing.length) {
        lines.push(values.all ? "  Not started:" : "  Next, in build order:");
        for (const f of values.all ? missing : missing.slice(0, 8))
          lines.push(
            `    ${f.path}  (${f.totalLines} line${f.totalLines === 1 ? "" : "s"})`,
          );
        if (!values.all && missing.length > 8)
          lines.push(`    … ${missing.length - 8} more (--all)`);
      }
      if (p.extra.length)
        lines.push(
          `  ! Not in the target (undo them, or make them examples): ${p.extra.join(", ")}`,
        );
      if (!partial.length && !missing.length && !p.extra.length)
        lines.push("  Complete: every file matches the target.");
      print(lines.join("\n"));
      return;
    }
    case "outline": {
      const [path] = positionals;
      if (!path) fail("usage: replay course outline <path> [--lines a-b]");
      const content = target.files.get(repoPath(path));
      if (content === undefined) fail(`${path} is not in the course's target`);
      const symbols = outline(content);
      const numbered = content.split("\n");
      if (content.endsWith("\n")) numbered.pop();
      const [from, to] = ranges?.[0] ?? [1, numbered.length];
      print(
        [
          `${repoPath(path)} — ${numbered.length} lines at ${target.rev.slice(0, 7)}`,
          ...(symbols.length
            ? [
                "  Definitions:",
                ...symbols.map(
                  (s) => `    ${String(s.line).padStart(5)}  ${s.kind} ${s.name}`,
                ),
              ]
            : []),
          "",
          ...numbered
            .slice(from - 1, to)
            .map((line, i) => `${String(from + i).padStart(5)}  ${line}`),
        ].join("\n"),
      );
      return;
    }
    case "lesson": {
      const title = positionals.join(" ").trim();
      if (!title) fail('usage: replay course lesson "<title>" [--goal "<text>"]');
      course = addLesson(course, title, values.goal);
      break;
    }
    case "explain": {
      const text =
        positionals.length === 0 || positionals[0] === "-"
          ? readStdin()
          : positionals.join(" ");
      const about = values.file
        ? {
            path: repoPath(values.file),
            ...(ranges
              ? { lines: [ranges[0]![0], ranges.at(-1)![1]] as [number, number] }
              : {}),
          }
        : undefined;
      course = addExplain(course, target, text, about);
      break;
    }
    case "take": {
      const [path] = positionals;
      if (!path)
        fail("usage: replay course take <path> [--lines 1-20,45-80] [--why <text>]");
      course = take(course, target, repoPath(path), ranges, values.why);
      break;
    }
    case "write":
    case "example": {
      const [path] = positionals;
      if (!path) fail(`usage: replay course ${sub} <path> [--why <text>] < content`);
      const content = readStdin();
      course =
        sub === "write"
          ? write(course, target, repoPath(path), content, values.why)
          : example(course, target, repoPath(path), content, values.why);
      break;
    }
    case "fill": {
      const result = fill(course, target, positionals.map(repoPath), values.why);
      course = result.course;
      print(
        `Filled ${result.filled.length} file${result.filled.length === 1 ? "" : "s"}.`,
      );
      break;
    }
    case "undo": {
      const count = positionals[0] ? positiveInteger(positionals[0], "undo") : 1;
      const result = undo(course, count);
      course = result.course;
      print(
        `Took back ${result.removed.map((step) => step.kind).join(", ") || "nothing"}.`,
      );
      break;
    }
    case "check": {
      const p = progressOf(course, target);
      const wrong = p.files.filter((f) => f.status !== "complete");
      if (!wrong.length && !p.extra.length) {
        print(
          `Complete: all ${p.files.length} files match ${target.rev.slice(0, 7)}. ${courseLine(course)}`,
        );
        return;
      }
      print(
        [
          `Not complete: ${courseLine(course)}`,
          ...wrong
            .slice(0, 20)
            .map(
              (f) =>
                `  ${f.status === "missing" ? "·" : "◐"} ${f.path}  ${f.lines}/${f.totalLines} lines`,
            ),
          ...(wrong.length > 20 ? [`  … ${wrong.length - 20} more`] : []),
          ...p.extra.map((path) => `  ! not in the target: ${path}`),
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }
    default:
      fail(`unknown course command "${sub}" — see \`replay course help\``);
  }
  print(`✓ ${courseLine(course)}`);
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

function fail(message: string): never {
  console.error(`replay: ${message}`);
  process.exit(1);
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/** `inner` is `outer` or inside it — on a path boundary, not a prefix. */
function within(inner: string, outer: string): boolean {
  const rel = relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pickSession(
  explicit: string | undefined,
  root: string | undefined,
): SessionSummary {
  if (explicit) {
    const target = /\.jsonl?(\.zst)?$/.test(explicit)
      ? resolve(here, explicit)
      : explicit;
    return findSession(target) ?? fail(`no session ${explicit} — see \`replay list\``);
  }
  const current = currentSessionId();
  if (current) {
    const found = findSession(current, undefined, { exact: true });
    if (found) return found;
  }
  if (!root) fail("not in a git repository — pass --repo, or --session");
  // The latest session that ran in this repository, or in a folder above it
  // (an agent started one level up, over several checkouts) — never `/`.
  const session = listSessions().find(
    (s) => s.cwd && s.cwd !== "/" && (within(s.cwd, root) || within(root, s.cwd)),
  );
  return session ?? fail(`no agent session found for ${root} — see \`replay list\``);
}

function load(path: string): { file: string; replay: Replay } {
  const file = resolve(here, path);
  try {
    return { file, replay: JSON.parse(readFileSync(file, "utf8")) as Replay };
  } catch {
    return fail(`cannot read ${path}`);
  }
}

function printSteps(replay: Replay): void {
  const playback = play(replay);
  for (const frame of playback.frames) {
    const { step, change } = frame;
    if (!change && !(step.kind === "command" && step.failed)) continue;
    const what = change
      ? `${step.kind.padEnd(8)} ${change.path}  +${change.added} −${change.removed}`
      : `command  ${step.kind === "command" ? step.command.split("\n")[0] : ""} (failed)`;
    const why = step.why?.split("\n")[0]?.slice(0, 90);
    const note = replay.notes[step.id];
    print(
      `${step.id}\n    ${what}${why ? `\n    why: ${why}` : ""}${note ? `\n    note [${note.level}]: ${note.text}` : ""}`,
    );
  }
}

// No command opens the player: `npx agentreplay` should show something.
const [given = "open", ...rest] = process.argv.slice(2);
// `replay <command> --help` is the usage, like `replay help`.
const command =
  given !== "course" && (rest.includes("--help") || rest.includes("-h"))
    ? "help"
    : given;

switch (command) {
  case "list": {
    for (const session of listSessions(20)) {
      print(
        `${session.id}  ${session.agent.padEnd(11)} ${ago(session.updatedAt).padStart(8)}  ${session.cwd ?? ""}\n    ${session.title}`,
      );
    }
    break;
  }

  case "capture": {
    const { values } = parseArgs({
      args: rest,
      options: {
        session: { type: "string" },
        repo: { type: "string" },
        base: { type: "string" },
        end: { type: "string" },
        thinking: { type: "boolean" },
        title: { type: "string" },
      },
    });
    const root = values.repo ? resolve(here, values.repo) : git.repoRoot(here);
    const session = pickSession(values.session, root);
    const {
      replay,
      root: repo,
      warnings,
    } = captureSession({
      session,
      root,
      base: values.base,
      end: values.end,
      thinking: values.thinking,
      title: values.title,
    });
    const file = saveReplay(repo, replay);
    const playback = play(replay);
    const changes = replay.steps.filter(isChange).length;
    const short = (sha?: string) => sha?.slice(0, 7) ?? "?";
    print(
      [
        `Captured "${replay.title}"`,
        `  ${replay.steps.length} steps · ${changes} changes · ${playback.totals.files} files · +${playback.totals.added} −${playback.totals.removed}`,
        `  base ${short(replay.repo.base)} → end ${short(replay.repo.end)}${replay.repo.dirty ? " + uncommitted" : ""} · ${replay.repo.commits.length} commits`,
        `  → ${relative(here, file) || file}`,
        ...warnings.map((warning) => `  ! ${warning}`),
      ].join("\n"),
    );
    break;
  }

  case "history": {
    const { values } = parseArgs({
      args: rest,
      options: {
        repo: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "string" },
        learn: { type: "boolean" },
        path: { type: "string", multiple: true },
        title: { type: "string" },
      },
    });
    const root = git.repoRoot(values.repo ? resolve(here, values.repo) : here);
    if (!root) fail("not in a git repository (pass --repo)");
    const { replay, warnings } = captureHistory({
      root,
      from: values.from,
      to: values.to,
      limit:
        values.limit === undefined
          ? undefined
          : positiveInteger(values.limit, "--limit"),
      learn: values.learn,
      paths: values.path,
      title: values.title,
    });
    const file = saveReplay(root, replay);
    const playback = play(replay);
    const coverage = playback.coverageAt(playback.length);
    print(
      [
        `Replayed "${replay.title}"`,
        `  ${replay.repo.commits.length} commits · ${replay.steps.filter(isChange).length} file changes · ${coverage.totalFiles} files at the end`,
        `  → ${relative(here, file) || file}`,
        ...warnings.map((warning) => `  ! ${warning}`),
      ].join("\n"),
    );
    break;
  }

  case "explain": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { model: { type: "string" } },
    });
    const [path] = positionals;
    if (!path) fail("usage: replay explain <replay.json> [--model <id>]");
    const { file, replay } = load(path);
    const model = values.model ?? DEFAULT_MODEL;
    let result;
    try {
      result = await explain(replay, new Anthropic(), {
        model,
        onProgress: (done, total) => process.stderr.write(`\r  ${done}/${total}`),
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        fail(
          "the API key was refused — check ANTHROPIC_API_KEY, or run `ant auth login`",
        );
      } else if (error instanceof Anthropic.RateLimitError) {
        fail("rate limited on every request — try again in a minute");
      } else if (error instanceof Anthropic.APIError) {
        fail(`the API answered ${error.status}: ${error.message}`);
      } else if (error instanceof Error && /authentication/i.test(error.message)) {
        // No credentials at all: the SDK says so with a plain Error.
        fail(
          "no Anthropic credentials — set ANTHROPIC_API_KEY, or run `ant auth login`",
        );
      }
      throw error;
    }
    process.stderr.write("\n");
    writeFileSync(file, `${JSON.stringify(result.replay, null, 1)}\n`);
    print(
      `${result.added} notes from ${model} · ${result.requests} requests${result.failed ? ` (${result.failed} failed — run again to fill them in)` : ""} · ${result.inputTokens} in / ${result.outputTokens} out tokens → ${relative(here, file) || file}`,
    );
    break;
  }

  case "export": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        session: { type: "string" },
        repo: { type: "string" },
        out: { type: "string", short: "o" },
      },
    });
    const [path] = positionals;
    let replay: Replay;
    let near = here;
    if (path) {
      const loaded = load(path);
      replay = loaded.replay;
      near = dirname(loaded.file);
    } else {
      const root = values.repo ? resolve(here, values.repo) : git.repoRoot(here);
      replay = captureSession({
        session: pickSession(values.session, root),
        root,
      }).replay;
    }
    const dist = playerDist();
    if (!hasPlayer(dist)) buildPlayer();
    const slug =
      replay.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "replay";
    const out = resolve(here, values.out ?? resolve(near, `${slug}.html`));
    writeFileSync(out, exportHtml(replay, dist));
    print(`Exported "${replay.title}" → ${relative(here, out) || out}`);
    break;
  }

  case "check": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { session: { type: "string" }, repo: { type: "string" } },
    });
    const [path] = positionals;
    let replay: Replay;
    if (path) replay = load(path).replay;
    else {
      const root = values.repo ? resolve(here, values.repo) : git.repoRoot(here);
      replay = captureSession({
        session: pickSession(values.session, root),
        root,
      }).replay;
    }
    const playback = play(replay);
    const ledger = evidenceOf(replay, (index) => playback.frames[index]?.change);
    const kinds: Record<string, string> = {
      test: "tests",
      typecheck: "type check",
      lint: "lint",
      format: "format",
      build: "build",
    };
    const lines = [`Evidence for "${replay.title}"`];
    for (const { kind, check, changedAfter } of ledger.latest) {
      lines.push(
        `  ${check.passed ? "✓" : "✗"} ${kinds[kind]!.padEnd(10)} ${check.summary ?? (check.passed ? "passed" : "failed")}${changedAfter.length ? ` — ${changedAfter.length} file(s) changed since` : ""}`,
      );
    }
    if (!ledger.latest.length) lines.push("  No checks ran.");
    const concerns = concernsOf(ledger);
    for (const concern of concerns) {
      switch (concern.kind) {
        case "unresolved":
          for (const check of ledger.unresolved)
            lines.push(`  ! failed and never passed after: $ ${check.command}`);
          break;
        case "weakened":
          for (const edit of ledger.testEdits)
            lines.push(`  ! test weakened: ${edit.path} (${edit.concerns.join(", ")})`);
          break;
        case "unbacked":
          for (const claim of ledger.claims.filter((c) => c.backedBy === undefined))
            lines.push(`  ! claim no check backs: "${claim.text}"`);
          break;
        case "stale":
          lines.push(
            `  ! changed after the last passing check: ${ledger.unverified.slice(0, 6).join(", ")}${ledger.unverified.length > 6 ? ", …" : ""}`,
          );
          break;
      }
    }
    if (!concerns.length) lines.push("  Every check passed after the last change.");
    print(lines.join("\n"));
    process.exitCode = concerns.length ? 1 : 0;
    break;
  }

  case "course": {
    runCourse(rest);
    break;
  }

  case "skills": {
    const [name] = rest;
    if (name === "install") {
      const { values } = parseArgs({
        args: rest.slice(1),
        options: { user: { type: "boolean" } },
      });
      const into = values.user
        ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "skills")
        : join(git.repoRoot(here) ?? here, ".claude", "skills");
      const names = installSkills(into);
      print(`Installed ${names.join(", ")} → ${relative(here, into) || into}`);
      break;
    }
    if (name) {
      const text = skill(name);
      if (!text) fail(`no skill "${name}" — \`replay skills\` lists them`);
      print(text);
    } else {
      print(
        [
          "Skills that teach a model to use replay — print one and give it to any agent:",
          "",
          ...skills().map((s) => `  ${s.name.padEnd(16)} ${s.description}`),
          "",
          "  replay skills <name>             the skill itself (Markdown), for any agent",
          "  replay skills install [--user]   copy them into .claude/skills (or ~/.claude/skills)",
        ].join("\n"),
      );
    }
    break;
  }

  case "steps": {
    const [path] = rest;
    if (!path) fail("usage: replay steps <replay.json>");
    printSteps(load(path).replay);
    break;
  }

  case "annotate": {
    const [path, notesPath] = rest;
    if (!path || !notesPath)
      fail("usage: replay annotate <replay.json> <notes.json|->");
    const { file, replay } = load(path);
    const source =
      notesPath === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(resolve(here, notesPath), "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch {
      fail("notes are not valid JSON");
    }
    const { replay: annotated, unknown } = annotate(replay, readNotes(raw));
    writeFileSync(file, `${JSON.stringify(annotated, null, 1)}\n`);
    print(
      `${Object.keys(annotated.notes).length} notes in ${relative(here, file) || file}`,
    );
    if (unknown.length) print(`  ! no step with id: ${unknown.join(", ")}`);
    break;
  }

  case "hook": {
    // Never in the agent's way: the agent waits for its hook, and a capture
    // of a long session takes seconds. So the hook hands the work to a
    // detached copy of itself and returns at once, always with 0. (Two
    // overlapping captures are safe: saves are atomic renames.)
    const payload = readPayload(rest.filter((arg) => arg !== "--wait"));
    if (rest.includes("--wait")) {
      process.stderr.write(`replay: ${runHook(payload, here)}\n`);
      process.exit(0);
    }
    try {
      spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "hook", "--wait", JSON.stringify(payload)],
        {
          cwd: here,
          detached: true,
          stdio: "ignore",
        },
      ).unref();
    } catch {
      // Nothing to do about it here that would not bother the agent.
    }
    process.exit(0);
    break;
  }

  case "setup": {
    const { values } = parseArgs({
      args: rest,
      options: { user: { type: "boolean" }, project: { type: "boolean" } },
    });
    const project = git.repoRoot(here) ?? here;
    const scope = values.project ? "project" : "user";
    const file = claudeSettings(scope, project);
    const command = hookCommand(scope === "project" ? project : undefined);
    const done = installClaude(file, command);
    print(
      [
        `Claude Code: ${done === "added" ? "added a Stop hook to" : "hook already in"} ${file}`,
        "",
        snippets(hookCommand()),
      ].join("\n"),
    );
    break;
  }

  case "open": {
    const { values } = parseArgs({
      args: rest,
      options: {
        port: { type: "string" },
        repo: { type: "string", multiple: true },
        "no-browser": { type: "boolean" },
      },
    });
    const dist = playerDist();
    if (!hasPlayer(dist)) buildPlayer();
    const repos = [
      ...(values.repo ?? []).map((path) => resolve(here, path)),
      git.repoRoot(here),
      ...(process.env.REPLAY_REPOS ?? "")
        .split(":")
        .filter(Boolean)
        .map((path) => resolve(path)),
    ].filter((path): path is string => Boolean(path));
    const url = await serve({
      dist,
      repos: [...new Set(repos)],
      port: values.port ? positiveInteger(values.port, "--port") : 5180,
    });
    print(`Replay is open at ${url} — Ctrl-C to stop.`);
    if (!values["no-browser"]) openBrowser(url);
    break;
  }

  default:
    if (command !== "help" && command !== "--help" && command !== "-h") {
      process.stderr.write(`replay: unknown command "${command}"\n\n`);
      process.exitCode = 1;
    }
    print(USAGE);
}
