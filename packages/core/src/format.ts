/**
 * The replay file: what an agent session did to a repository, as a list of
 * operations a player can apply one at a time.
 *
 * It stores OPERATIONS, not snapshots. An edit is the two strings the agent
 * sent, a write is the content it wrote, and the only full file bodies are the
 * state at the base commit (`files`) and the changes nobody recorded
 * (`external`). A player rebuilds every intermediate state by applying the
 * steps in order (`play.ts`), so a hundred edits to one file cost a hundred
 * small strings, not a hundred copies of it.
 *
 * Self-contained on purpose: a replay opens without the repository, without
 * git and without the transcript it came from, so it can be committed, sent
 * or opened years later against a history that has since been rewritten.
 */

export const REPLAY_VERSION = 1;

/** Where replays live in a repository — and so never part of one. */
export const REPLAY_DIR = ".replays";

interface StepBase {
  /**
   * Stable across re-captures of the same session: the tool call's id, or one
   * derived from it. Notes are keyed by it, so annotating a replay and then
   * capturing it again keeps the notes attached.
   */
  id: string;
  /** ISO-8601, from the transcript. */
  at: string;
  /** `main`, or the id of the subagent that made the call. */
  agent: string;
  /** Which prompt this step answers, counting from 0. -1 before the first. */
  turn: number;
  /** What the agent said since its previous step — its own account of why. */
  why?: string;
}

/** Something the person asked. */
export interface PromptStep extends StepBase {
  kind: "prompt";
  text: string;
}

/** What the agent said with no tool call after it: usually its report back. */
export interface SayStep extends StepBase {
  kind: "say";
  text: string;
}

/** A string replacement, exactly as the Edit tool received it. */
export interface EditStep extends StepBase {
  kind: "edit";
  path: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
  /** The command step that made it, when a shell command did rather than a tool. */
  via?: string;
  /** Teaching material — an example, a worked note — not part of the repository. */
  aside?: true;
}

/** A whole-file write: a new file, or a rewrite of an existing one. */
export interface WriteStep extends StepBase {
  kind: "write";
  path: string;
  content: string;
  /** The command step that made it, when a shell command did rather than a tool. */
  via?: string;
  /** Teaching material — an example, a worked note — not part of the repository. */
  aside?: true;
}

/** A file removed by a tool call (Codex's `*** Delete File:`, say). */
export interface DeleteStep extends StepBase {
  kind: "delete";
  path: string;
}

/**
 * A change the transcript does not describe — a formatter, a codegen step, a
 * `sed`, a `git rm`, a subagent whose transcript was not found, a person
 * typing in the editor. The replay never pretends these came from a tool
 * call: they are shown as what they are, at the first moment the change
 * became visible.
 */
export interface ExternalStep extends StepBase {
  kind: "external";
  path: string;
  /** The file's content from here on. `null` means the file was deleted. */
  content: string | null;
  /**
   * `drift` — a later tool call saw a file that differed from the replay's
   * state, so something changed it in between.
   * `untracked` — the file differs at the end of the session from what the
   * recorded calls produced.
   */
  reason: "drift" | "untracked";
  /** The command step that most likely caused it, when one names the file. */
  cause?: string;
  /** Too large or binary to store; `content` is then only a placeholder. */
  omitted?: true;
}

/** A commit, in a replay built from git history rather than a session. */
export interface CommitStep extends StepBase {
  kind: "commit";
  sha: string;
  subject: string;
  body?: string;
  author?: string;
}

/**
 * A chapter of a course: what the steps after it build, and what the learner
 * will be able to do at its end. Courses rebuild a repository from nothing,
 * for someone learning it, rather than record what an agent did.
 */
export interface LessonStep extends StepBase {
  kind: "lesson";
  title: string;
  goal?: string;
}

/**
 * Teaching prose, in Markdown — with `$…$` and `$$…$$` for mathematics. When
 * it is about particular code, `path` and `lines` (1-based, inclusive, in the
 * file as it stands at this step) say which, and the player shows them.
 */
export interface ExplainStep extends StepBase {
  kind: "explain";
  text: string;
  path?: string;
  lines?: [number, number];
}

/** A shell command and what it printed (truncated, secrets redacted). */
export interface CommandStep extends StepBase {
  kind: "command";
  command: string;
  description?: string;
  output?: string;
  failed?: boolean;
}

export type Step =
  | PromptStep
  | SayStep
  | EditStep
  | WriteStep
  | DeleteStep
  | ExternalStep
  | CommandStep
  | CommitStep
  | LessonStep
  | ExplainStep;

export type StepKind = Step["kind"];

/** A step that changes a file. */
export type ChangeStep = EditStep | WriteStep | DeleteStep | ExternalStep;

export function isChange(step: Step): step is ChangeStep {
  return (
    step.kind === "edit" ||
    step.kind === "write" ||
    step.kind === "delete" ||
    step.kind === "external"
  );
}

/** How much attention a step deserves from a reviewer. */
export type NoteLevel = "info" | "review" | "risk";

export interface Note {
  text: string;
  level: NoteLevel;
}

export interface Commit {
  sha: string;
  subject: string;
}

export interface ReplayRepo {
  /** The repository's directory name — never the absolute path. */
  name: string;
  branch?: string;
  /** HEAD when the session started: what the first step applies to. */
  base?: string;
  /** HEAD when the replay was captured. */
  end?: string;
  /** The working tree had uncommitted changes at capture. */
  dirty?: boolean;
  /** Commits made between `base` and `end`, oldest first. */
  commits: Commit[];
}

/** What a course rebuilds: a repository at one revision, or part of it. */
export interface CourseTarget {
  /** The commit whose files the course arrives at. */
  rev: string;
  /** Only these paths (directories or files); every file when absent. */
  paths?: string[];
}

export interface Replay {
  version: typeof REPLAY_VERSION;
  /** The session id. */
  id: string;
  title: string;
  /** The agent that produced the transcript: `claude-code`, `codex`, … */
  source: string;
  startedAt: string;
  endedAt: string;
  repo: ReplayRepo;
  /**
   * Every touched file's content before the first step, by repo-relative
   * path. `null`: the file did not exist.
   */
  files: Record<string, string | null>;
  /** Paths in `files` whose base content was too large or binary to store. */
  omitted: string[];
  steps: Step[];
  /** Reviewer-facing explanations, by step id. */
  notes: Record<string, Note>;
  /** Present on a course (`source: "course"`): what it rebuilds. */
  course?: CourseTarget;
}
