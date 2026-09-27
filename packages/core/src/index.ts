/*
 * @agent-replay/core — an agent session, as steps a person can replay.
 *
 * Zero dependencies and browser-pure: the same code captures a replay in the
 * CLI and rebuilds it in the player, so the two can never disagree about what
 * a step did. Relative imports carry `.ts` because the CLI runs these files
 * directly under Node's type stripping, with no build in between.
 */

export { applyEdit, applyStep, editHunks, stepHunks } from "./apply.ts";
export { shellWrites, type ShellWrite } from "./shell.ts";
export {
  checkKind,
  concernsOf,
  type Concern,
  type ConcernKind,
  evidenceOf,
  isTestFile,
  type Check,
  type CheckKind,
  type Claim,
  type Ledger,
  type TestEdit,
} from "./evidence.ts";
export {
  ADAPTERS,
  agentName,
  detectAdapter,
  parseTranscript,
  type Adapter,
} from "./agents/index.ts";
export { capture, editBetween, titleOf, type CaptureOptions } from "./capture.ts";
export {
  buildHistory,
  GIT_HISTORY,
  type HistoryChange,
  type HistoryCommit,
  type HistoryOptions,
} from "./history.ts";
export { importsOf, readingOrder, type SourceFile } from "./order.ts";
export { applyHunks, countLines, diffHunks, splitLines, type Hunk } from "./diff.ts";
export { causeScore, isLockfile } from "./cause.ts";
export {
  REPLAY_DIR,
  REPLAY_VERSION,
  isChange,
  type ChangeStep,
  type CommandStep,
  type Commit,
  type CommitStep,
  type DeleteStep,
  type EditStep,
  type ExternalStep,
  type Note,
  type NoteLevel,
  type PromptStep,
  type Replay,
  type ReplayRepo,
  type SayStep,
  type Step,
  type StepKind,
  type WriteStep,
} from "./format.ts";
export { annotate, readNotes, type Annotated } from "./notes.ts";
export {
  play,
  type Change,
  type Coverage,
  type FileEntry,
  type FileStatus,
  type Frame,
  type Playback,
} from "./play.ts";
export { redact, truncate } from "./redact.ts";
export {
  applyChunks,
  extractPatch,
  parsePatch,
  type FilePatch,
  type PatchChunk,
} from "./patch.ts";
export {
  absolute,
  cleanPrompt,
  logLines,
  type Log,
  type Action,
  type Transcript,
  type TranscriptEvent,
} from "./transcript.ts";
