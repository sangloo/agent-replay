import {
  agentName,
  concernsOf,
  countLines,
  diffHunks,
  evidenceOf,
  isChange,
  play,
  preparePlayback,
  sourceReferenceIndex,
  type Playback,
  type SourceDestination,
  type Replay,
  type StudyContext,
} from "@agent-replay/core";
import {
  ArrowLeft,
  Check,
  Download,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import * as React from "react";

import {
  Button,
  buttonClass,
  cn,
  IconButton,
  ResizablePanel,
  Scrubber,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShortcutsSheet,
  type ScrubStep,
  type ShortcutGroup,
  type Tone,
} from "@/ui";

import { api, type ReplaySource } from "../api";
import { Choice } from "../choice";
import { CourseOutline, LessonActions } from "../course-navigation";
import { firstLine, stepLabel, when } from "../labels";
import { isBoolean, isNumber, oneOf, usePersistent } from "../persist";
import {
  furthestOf,
  progressKeys,
  readStudyProgress,
  saveStudyProgress,
} from "../study-progress";
import { Caption } from "./caption";
import { CodeView, type Blame, type CodeViewProps, type Origin } from "./code-view";
import type { Diffable } from "./compose";
import { EvidencePanel } from "./evidence";
import { FilesPanel } from "./files";
import { LessonPanel } from "./lesson";
import { lessonsOf } from "./lessons";
import { SourceNavigationContext } from "./source-context";
import { PlayerMenu } from "./player-menu";
import { StepFilter, StepList, type Filter } from "./steps";
import {
  SPEEDS,
  usePlayback,
  useProgress,
  type ProgressStore,
  type Speed,
} from "./use-playback";
import { PlayerSkeleton } from "./skeleton";
import { useRepo } from "./use-repo";

const countOf = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

const isFilter = oneOf<Filter>("all", "changes", "notes");

/**
 * What the code pane shows for a file: the diff of the last change to it
 * (played in as it happens), everything that changed since the base commit,
 * or the file as it stands, with who wrote each line in the gutter.
 */
type View = "change" | "base" | "file";
const VIEWS = [
  {
    value: "change",
    label: "Change",
    hint: "The last change to this file, as a diff (V)",
  },
  {
    value: "base",
    label: "Since base",
    hint: "Everything that changed in this file since the base commit (V)",
  },
  {
    value: "file",
    label: "File",
    hint: "The file as it reads now, the change being made marked (V)",
  },
] as const;
const isView = oneOf<View>("change", "base", "file");

type Side = "steps" | "evidence" | "lesson" | "courses";
const isSide = oneOf<Side>("steps", "evidence", "lesson", "courses");

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Playback",
    shortcuts: [
      { keys: "space", description: "Play or pause — mid-change too" },
      { keys: "arrowright", description: "Play the next step (or finish this one)" },
      { keys: "arrowleft", description: "Previous step" },
      { keys: "shift+arrowright", description: "Next prompt (in a course: lesson)" },
      { keys: "shift+arrowleft", description: "Previous prompt (in a course: lesson)" },
      { keys: "home", description: "Back to the start" },
      { keys: "end", description: "To the end" },
      { keys: "n", description: "Next note" },
      { keys: "p", description: "Previous note" },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { keys: "v", description: "Last change, since base, or the file" },
      { keys: "[", description: "Show or hide the files" },
      { keys: "]", description: "Show or hide the side panel" },
      { keys: "e", description: "Steps or evidence (in a course: lesson or steps)" },
      { keys: "/", description: "Filter the files" },
      { keys: "?", description: "These shortcuts" },
    ],
  },
];

/** A panel's width, persisted on release rather than on every frame of a drag. */
function usePanelWidth(key: string, initial: number) {
  const [saved, save] = usePersistent(key, initial, isNumber);
  const [dragging, setDragging] = React.useState<number>();
  return {
    size: dragging ?? saved,
    onSizeChange: setDragging,
    onSizeCommit: (size: number) => {
      save(size);
      setDragging(undefined);
    },
    defaultSize: initial,
  };
}

/** Header and footer buttons: plain, with no hover flourish. */
function Tool(props: React.ComponentProps<typeof IconButton>) {
  return <IconButton variant="ghost" size="sm" {...props} />;
}

/**
 * Work that would hold up the first paint of a long replay — the net totals,
 * coverage — done just after it, so the player is on screen at once and the
 * numbers arrive a moment later.
 */
function useAfterPaint<K, T>(
  key: K | undefined,
  compute: (key: K) => T,
): T | undefined {
  const [done, setDone] = React.useState<{ key: K; value: T }>();
  React.useEffect(() => {
    if (key === undefined) return;
    const timer = setTimeout(() => setDone({ key, value: compute(key) }), 30);
    return () => clearTimeout(timer);
  }, [key, compute]);
  return done && done.key === key ? done.value : undefined;
}
const totalsOf = (playback: Playback) => playback.totals;
const coverageReady = (playback: Playback) => (playback.coverageAt(0), true);

/** The code, typing in as the step plays: the one part that redraws every frame. */
function LiveCode({
  store,
  live,
  origins,
  ...props
}: Omit<CodeViewProps, "progress"> & { store: ProgressStore; live: boolean }) {
  const progress = useProgress(store);
  const shown = live ? progress : 1;
  return (
    <CodeView {...props} progress={shown} origins={shown >= 1 ? origins : undefined} />
  );
}

/** How far the change on screen has played, under the file bar. */
function LiveBar({ store, live }: { store: ProgressStore; live: boolean }) {
  const progress = useProgress(store);
  if (!live || progress >= 1) return null;
  return (
    <span
      aria-hidden
      className="absolute bottom-0 left-0 h-0.5 bg-emphasis"
      style={{ width: `${progress * 100}%` }}
    />
  );
}

export interface PlayerProps {
  replay: Replay;
  study?: StudyContext;
  /** Where it came from — for the rest of its repository's files. */
  source?: ReplaySource;
  /** The step to open on, from a link. */
  at?: number;
  /** The repository's name, when known better than the replay says. */
  repo?: string;
  warnings?: readonly string[];
  /** Offered for a live session: save it, or refresh its saved copy. */
  onSave?: () => void;
  /** It already has a saved copy, which saving replaces. */
  saved?: boolean;
  saving?: boolean;
  /** Back to where the reader came from; absent in a replay exported as a file. */
  onBack?: () => void;
  /** Where Back goes, in a word: "Sessions", "Saved", "Learn". */
  backLabel?: string;
  /** Something to say above the panels: a newer version of a course, say. */
  notice?: React.ReactNode;
}

function ReadyPlayer({
  replay,
  study,
  source,
  at,
  repo,
  warnings = [],
  onSave,
  saved,
  saving,
  onBack,
  backLabel,
  notice,
  prepared,
}: PlayerProps & { prepared?: Playback }) {
  const playback = React.useMemo(() => prepared ?? play(replay), [replay, prepared]);
  // A course teaches: its lessons lead, and there is nothing to audit.
  const isCourse = replay.source === "course";
  const [storedFilter, setFilter] = usePersistent<Filter>(
    "filter",
    "changes",
    isFilter,
  );
  const filter = isCourse ? "all" : storedFilter;
  const visible = React.useMemo(
    () =>
      playback.frames
        .filter(
          ({ step }) =>
            filter === "all" ||
            (step.kind === "prompt" && step.agent === "main") ||
            step.kind === "commit" ||
            step.kind === "lesson" ||
            step.kind === "explain" ||
            Boolean(replay.notes[step.id]) ||
            (filter === "changes" && isChange(step)),
        )
        .map((frame) => frame.index),
    [filter, playback, replay.notes],
  );

  // Where the reader left this replay, the last time it was open here.
  const keys = progressKeys(replay, study);
  const [savedProgress] = React.useState(() => readStudyProgress(keys[0]!));
  // Saves from before lessons completed themselves knew no total: one left
  // at the end was finished.
  const [reviewed, setReviewed] = React.useState(
    Boolean(
      savedProgress &&
      (savedProgress.reviewed ||
        (savedProgress.total === undefined &&
          replay.steps.length > 0 &&
          savedProgress.cursor >= replay.steps.length)),
    ),
  );
  const [studyPane, setStudyPane] = React.useState<"reading" | "code">("reading");
  const resumed =
    at === undefined && savedProgress && savedProgress.cursor > 0
      ? Math.min(savedProgress.cursor, replay.steps.length)
      : undefined;
  const initial = at ?? resumed ?? (isCourse ? Math.min(2, replay.steps.length) : 0);
  const transport = usePlayback(playback.frames, visible, initial);
  const { cursor, playing } = transport;
  // Said once, on opening where the reader left off; gone once they move.
  const [resumeDismissed, setResumeDismissed] = React.useState(false);
  const resumeNote = resumed !== undefined && !resumeDismissed && cursor === initial;

  // The address says where the replay is, so a link opens on this moment.
  React.useEffect(() => {
    const [path = ""] = window.location.hash.split("?");
    const next = isCourse || cursor > 0 ? `${path || "#"}?at=${cursor}` : path || "#";
    if (next !== window.location.hash) window.history.replaceState(null, "", next);
  }, [cursor, isCourse]);

  const [view, setView] = usePersistent<View>(
    isCourse ? "course-view" : "view",
    isCourse ? "file" : "change",
    isView,
  );
  // On a narrow screen the code comes first: panels open over it, on request.
  const narrow = window.innerWidth < 760;
  const [storedFilesOpen, setFilesOpen] = usePersistent(
    isCourse ? "course-files-open" : "files-open",
    !isCourse,
    isBoolean,
  );
  const [narrowFiles, setNarrowFiles] = React.useState(false);
  const filesOpen = narrow ? narrowFiles : storedFilesOpen;
  // Three panels crowd a laptop screen: the steps start shut below 1200px,
  // until the reviewer opens them (which is then remembered).
  const [storedStepsOpen, setStepsOpen] = usePersistent(
    isCourse ? "course-notes-open" : "notes-open",
    isCourse || window.innerWidth >= 1200,
    isBoolean,
  );
  const [narrowSteps, setNarrowSteps] = React.useState(false);
  const stepsOpen = narrow && !isCourse ? narrowSteps : storedStepsOpen;
  const filesWidth = usePanelWidth("files-width", 272);
  const stepsWidth = usePanelWidth(
    isCourse ? "course-notes-width" : "notes-width",
    isCourse ? 480 : 360,
  );
  const [storedSide, setSide] = usePersistent<Side>(
    isCourse ? "course-side" : "side",
    isCourse ? "lesson" : "steps",
    isSide,
  );
  const side: Side =
    isCourse && storedSide === "evidence"
      ? "lesson"
      : !isCourse && (storedSide === "lesson" || storedSide === "courses")
        ? "steps"
        : storedSide === "courses" && !study
          ? "lesson"
          : storedSide;
  const [help, setHelp] = React.useState(false);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const repoFiles = useRepo(source);

  const frame = cursor > 0 ? playback.frames[cursor - 1] : undefined;
  // The last change so far — or, before any, the file the next one touches.
  const explained =
    frame?.step.kind === "explain" && frame.step.path ? frame.step : undefined;
  const followed =
    explained?.path ??
    playback.focusAt(cursor) ??
    playback.frames.find((f) => f.index >= cursor && f.change)?.change?.path;
  // A file the reviewer picked holds the view until a change elsewhere
  // arrives at a different cursor; then the replay takes it back.
  const [pin, setPin] = React.useState<{ path: string; at: number }>();
  const pinned = pin && (pin.at === cursor || !frame?.change) ? pin.path : undefined;
  const setPinned = React.useCallback(
    (path: string | undefined) =>
      setPin(path === undefined ? undefined : { path, at: cursor }),
    [cursor],
  );
  const [reference, setReference] = React.useState<
    SourceDestination & { returnCursor: number }
  >();
  const selectFile = React.useCallback(
    (path: string) => {
      setPinned(path);
      setReference(undefined);
    },
    [setPinned],
  );
  const { jump, toggle, forward, back, setSpeed } = transport;
  const jumpToPosition = React.useCallback(
    (next: number) => jump(next === 0 ? 0 : visible[next - 1]! + 1),
    [jump, visible],
  );
  const activeReference = reference?.cursor === cursor ? reference : undefined;

  // Progress: where the reader is, the furthest they have been, and — for a
  // lesson — done once they reach its end. Saved as they go, so closing the
  // tab loses nothing.
  const total = replay.steps.length;
  const [furthest, setFurthest] = React.useState(
    savedProgress ? furthestOf(savedProgress) : 0,
  );
  // Following a source reference is a look ahead, not progress.
  if (!activeReference && cursor > furthest) {
    setFurthest(cursor);
    // Reaching the end of a lesson completes it — once: marked not done by
    // hand afterwards, it stays so.
    if (isCourse && total > 0 && cursor >= total && furthest < total) setReviewed(true);
  }
  React.useEffect(() => {
    if (activeReference) return;
    for (const key of keys)
      saveStudyProgress(key, {
        cursor,
        reviewed,
        furthest,
        total,
        updatedAt: Date.now(),
      });
    // `keys` is derived from the replay and study, both fixed for a player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, reviewed, furthest, total, activeReference]);

  const sourceIndex = React.useMemo(() => sourceReferenceIndex(replay), [replay]);
  const navigation = React.useMemo(
    () => ({
      resolve: (href: string) => sourceIndex.resolve(href, cursor),
      navigate: (destination: SourceDestination) => {
        setStudyPane("code");
        setReference({ ...destination, returnCursor: cursor });
        setPin(undefined);
        jump(destination.cursor);
      },
    }),
    [sourceIndex, cursor, jump],
  );
  const sourceCoverage = React.useMemo(
    () => sourceIndex.coverage(cursor),
    [sourceIndex, cursor],
  );
  const path = activeReference?.path ?? pinned ?? followed;
  const files = React.useMemo(() => playback.filesAt(cursor), [playback, cursor]);
  const entry = files.find((file) => file.path === path);

  // Per file, the steps that changed it and could be applied — to find the
  // last change so far that has a diff to show.
  const changesOf = React.useMemo(() => {
    const map = new Map<string, number[]>();
    for (const f of playback.frames) {
      if (!f.change?.applied) continue;
      const list = map.get(f.change.path);
      if (list) list.push(f.index);
      else map.set(f.change.path, [f.index]);
    }
    return map;
  }, [playback]);
  const lastChange = path
    ? changesOf
        .get(path)
        ?.filter((index) => index < cursor)
        .at(-1)
    : undefined;

  // A file outside the replay: the repository's, unchanged throughout.
  const { requestFile, fileAt } = repoFiles;
  React.useEffect(() => {
    if (path && !entry) requestFile(path);
  }, [path, entry, requestFile]);
  const outside = path && !entry ? fileAt(path) : undefined;

  const inReplay = Boolean(entry);
  // Since the base: diffed once per file and cursor — never per frame.
  const sinceBase = React.useMemo(() => {
    if (view !== "base" || !path || !inReplay) return undefined;
    const base = playback.contentAt(path, 0);
    const now = playback.contentAt(path, cursor);
    if (base === now) return undefined;
    const hunks = diffHunks(base ?? "", now ?? "");
    return {
      diff: { before: base, after: now, hunks },
      counts: countLines(hunks, base ?? ""),
    };
  }, [view, path, inReplay, playback, cursor]);

  // What the code pane shows at this cursor. `live`: it is the change being
  // made, so it types in as the step plays.
  const shown = React.useMemo((): {
    diff?: Diffable;
    content: string | null;
    live: boolean;
    counts?: { added: number; removed: number };
    hideRemoved?: boolean;
    focus?: readonly [number, number];
  } => {
    if (!path || !inReplay) return { content: null, live: false };
    const now = playback.contentAt(path, cursor);
    if (activeReference && activeReference.path === path)
      return { content: now, live: false, focus: activeReference.displayed };
    // An explanation about code shows the file as it stands, those lines lit.
    if (explained && explained.path === path) {
      const count = (now ?? "").split("\n").length;
      return {
        content: now,
        live: false,
        focus: explained.lines ?? [1, count],
      };
    }
    const changeStep =
      lastChange === undefined ? undefined : playback.frames[lastChange]?.step;
    // Material included for completeness arrives whole, not typed.
    const typed = !(
      changeStep &&
      "sourceMode" in changeStep &&
      changeStep.sourceMode === "included"
    );
    // The file as it reads — but a change being made to it still plays, its
    // new lines typed in place and marked, so playback is never a jump cut.
    if (view === "file" && lastChange !== undefined && lastChange === cursor - 1) {
      const change = playback.frames[lastChange]!.change!;
      return {
        diff: change,
        content: now,
        live: typed,
        counts: change,
        hideRemoved: true,
      };
    }
    if (view === "change" && lastChange !== undefined) {
      const change = playback.frames[lastChange]!.change!;
      if (change.applied) {
        return {
          diff: change,
          content: now,
          live: typed && lastChange === cursor - 1,
          counts: change,
        };
      }
    }
    if (view === "base" && sinceBase)
      return { ...sinceBase, content: now, live: false };
    return { content: now, live: false };
  }, [
    path,
    inReplay,
    playback,
    cursor,
    view,
    lastChange,
    sinceBase,
    explained,
    activeReference,
  ]);

  // What the agent checked, and whether it held.
  const ledger = React.useMemo(
    () => evidenceOf(replay, (index) => playback.frames[index]?.change),
    [replay, playback],
  );
  const worries = concernsOf(ledger).length;

  const noted = React.useMemo(
    () => playback.frames.filter((f) => replay.notes[f.step.id]).map((f) => f.index),
    [playback, replay.notes],
  );
  const nextNote = noted.find((index) => index + 1 > cursor);
  const prevNote = noted.filter((index) => index + 1 < cursor).at(-1);
  // Where each turn starts: a prompt of the person's, or a course's lesson.
  const turns = React.useMemo(
    () =>
      playback.frames
        .filter(
          ({ step }) =>
            (step.kind === "prompt" && step.agent === "main") || step.kind === "lesson",
        )
        .map((frame) => frame.index),
    [playback],
  );
  const nextTurn = turns.find((index) => index + 1 > cursor);
  const prevTurn = turns.filter((index) => index + 1 < cursor).at(-1);

  // Scrubber over the visible steps; its cursor counts visible steps applied.
  const position = React.useMemo(
    () => visible.filter((index) => index < cursor).length,
    [visible, cursor],
  );
  const scrubSteps = React.useMemo((): ScrubStep[] => {
    const checks = new Map(ledger.checks.map((check) => [check.index, check]));
    return visible.map((index) => {
      const { step } = playback.frames[index]!;
      const check = checks.get(index);
      const tone: Tone | undefined = replay.notes[step.id]
        ? "note"
        : check
          ? check.passed
            ? "pass"
            : "fail"
          : step.kind === "prompt" && step.agent === "main"
            ? "prompt"
            : step.kind === "commit" || step.kind === "lesson"
              ? "commit"
              : undefined;
      return tone ? { tone } : {};
    });
  }, [playback, visible, ledger, replay.notes]);
  const scrubLabel = React.useCallback(
    (at: number) => stepLabel(playback.frames[visible[at - 1]!]!),
    [playback, visible],
  );

  const cycleView = React.useCallback(() => {
    const at = VIEWS.findIndex((v) => v.value === view);
    setView(VIEWS[(at + 1) % VIEWS.length]!.value);
  }, [view, setView]);
  const toggleFiles = React.useCallback(
    () => (narrow ? setNarrowFiles(!filesOpen) : setFilesOpen(!filesOpen)),
    [narrow, filesOpen, setFilesOpen],
  );
  const toggleSteps = React.useCallback(
    () => (narrow && !isCourse ? setNarrowSteps(!stepsOpen) : setStepsOpen(!stepsOpen)),
    [narrow, isCourse, stepsOpen, setStepsOpen],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A focused control keeps its own keys: Space presses a button (the
      // shortcut on top would undo it), arrows move within the scrubber,
      // the tree or a list. Everything else is the player's.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=listbox]"))
        return;
      if (
        event.key === " " &&
        target?.closest("button, a, [role=radio], [role=combobox]")
      )
        return;
      if (
        event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End"
          ? target?.closest("[role=slider], [role=tree], [role=separator]")
          : false
      ) {
        return;
      }
      if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        const to = event.key === "ArrowRight" ? nextTurn : prevTurn;
        if (to !== undefined) jump(to + 1);
        return;
      }
      const keys: Record<string, () => void> = {
        " ": toggle,
        ArrowRight: forward,
        ArrowLeft: back,
        Home: () => jump(0),
        End: () => jump(playback.length),
        n: () => nextNote !== undefined && jump(nextNote + 1),
        p: () => prevNote !== undefined && jump(prevNote + 1),
        v: cycleView,
        "[": toggleFiles,
        "]": toggleSteps,
        e: () => {
          if (narrow && !isCourse) setNarrowSteps(true);
          else setStepsOpen(true);
          setSide(
            isCourse
              ? side === "lesson"
                ? "steps"
                : "lesson"
              : side === "evidence"
                ? "steps"
                : "evidence",
          );
        },
        "/": () => {
          if (narrow) setNarrowFiles(true);
          else setFilesOpen(true);
          requestAnimationFrame(() => filterRef.current?.focus());
        },
        "?": () => setHelp(true),
      };
      const run = keys[event.key];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    toggle,
    forward,
    back,
    jump,
    playback.length,
    nextNote,
    prevNote,
    nextTurn,
    prevTurn,
    cycleView,
    toggleFiles,
    toggleSteps,
    setFilesOpen,
    setStepsOpen,
    narrow,
    side,
    setSide,
    isCourse,
  ]);

  const short = (sha?: string) => sha?.slice(0, 7);

  // Blame for the file on screen; the code pane shows it once the step settles.
  const origins = React.useMemo((): Origin[] | undefined => {
    if (!path || !inReplay) return undefined;
    return playback.blameAt(path, cursor).map((index) => {
      if (index < 0) return "base";
      if (index === cursor - 1) return "current";
      return playback.frames[index]!.step.kind === "external" ? "outside" : "agent";
    });
  }, [path, inReplay, playback, cursor]);

  const blameOf = React.useCallback(
    (line: number): Blame | undefined => {
      if (!path) return undefined;
      const index = playback.blameAt(path, cursor)[line] ?? -1;
      if (index < 0) return { text: "Unchanged since the base commit" };
      const origin = playback.frames[index]!;
      const why = origin.step.why ? ` — ${firstLine(origin.step.why, 90)}` : "";
      return {
        step: index,
        text: `${when(origin.step.at, replay)} · ${stepLabel(origin)}${why}`,
      };
    },
    [path, playback, cursor, replay],
  );
  const onBlame = React.useCallback((index: number) => jump(index + 1), [jump]);
  // Stand just before a step and play it, so its change is seen being made.
  const jumpBefore = React.useCallback(
    (index: number) => {
      jump(index);
      requestAnimationFrame(forward);
    },
    [jump, forward],
  );

  // How far along a history is: how much of the end state exists yet. The
  // first answer reads every file's blame, so it waits for the first paint.
  const measured = useAfterPaint(
    replay.source === "git" || isCourse ? playback : undefined,
    coverageReady,
  );
  const coverage = React.useMemo(
    () => (measured ? playback.coverageAt(cursor) : undefined),
    [measured, playback, cursor],
  );
  const totals = useAfterPaint(playback, totalsOf);

  const tree = repoFiles.tree;
  const repoState =
    tree?.state === "loading"
      ? ("loading" as const)
      : tree?.state === "failed"
        ? { failed: tree.message }
        : undefined;

  const lessons = React.useMemo(
    () => (isCourse ? lessonsOf(playback.frames) : []),
    [isCourse, playback],
  );

  let body: React.ReactNode;
  if (!path) {
    body = isCourse ? (
      <Message>
        The code arrives as the lesson goes on. Read alongside, or press{" "}
        <kbd className="font-sans font-medium">Space</kbd> to play.
      </Message>
    ) : (
      <Message>No files changed.</Message>
    );
  } else if (
    source &&
    isImage(path) &&
    // Not there yet, or deleted by now: said in words below.
    !(entry && !shown.diff && shown.content === null)
  ) {
    // A picture cannot be typed in: it is shown as the replay ends (a
    // changed one) or as the base has it (one the replay leaves alone).
    const rev = entry
      ? replay.repo.dirty
        ? undefined
        : replay.repo.end
      : tree?.state === "ready"
        ? tree.data.rev
        : replay.repo.base;
    body = (
      <ImagePreview
        key={path}
        src={api.imageUrl(
          source,
          path,
          rev && /^[0-9a-f]{40}$/.test(rev) ? rev : undefined,
        )}
        note={entry ? "As it is at the end" : undefined}
      />
    );
  } else if (entry?.omitted) {
    body = (
      <Message>
        Changed, but too large or binary to replay. Lockfiles are never stored.
      </Message>
    );
  } else if (!entry) {
    body =
      tree?.state === "failed" ? (
        <Message>{tree.message}</Message>
      ) : !outside || outside.state === "loading" ? (
        <Message>Loading…</Message>
      ) : outside.state === "failed" ? (
        <Message>{outside.message}</Message>
      ) : outside.data.omitted ? (
        <Message>
          {outside.data.omitted === "binary"
            ? "Not a text file."
            : "Too large to show here."}
        </Message>
      ) : (
        <CodeView key={path} path={path} content={outside.data.content} progress={1} />
      );
  } else if (!shown.diff && shown.content === null) {
    const created = playback.frames.find(
      (f) => f.index >= cursor && f.change?.path === path && f.change.after !== null,
    );
    body =
      entry.status === "deleted" && !created ? (
        <Message>Deleted at this point.</Message>
      ) : created ? (
        <Message>
          {isCourse ? `${path.split("/").pop()} is written ` : "Not written yet — "}
          {isCourse
            ? `at step ${created.index + 1}. `
            : `step ${created.index + 1} creates it. `}
          <button
            type="button"
            onClick={() => jumpBefore(created.index)}
            className="rounded-control font-medium text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
          >
            Watch it being written
          </button>
        </Message>
      ) : (
        <Message>Not in the repository at this point.</Message>
      );
  } else {
    body = (
      <LiveCode
        key={path}
        store={transport.progress}
        live={shown.live}
        path={path}
        diff={shown.diff}
        content={shown.content}
        origins={origins}
        blameOf={blameOf}
        onBlame={onBlame}
        hideRemoved={shown.hideRemoved}
        focus={shown.focus}
      />
    );
  }

  const dir = path ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const name = path ? path.slice(path.lastIndexOf("/") + 1) : "";
  // The open side panel already narrates — a course's lesson, or the step
  // on screen opened in the list — so the caption would only say it twice.
  const narrated = stepsOpen && side === (isCourse ? "lesson" : "steps");
  const lessonDone = isCourse && reviewed;

  return (
    <SourceNavigationContext.Provider value={navigation}>
      <div
        className={`flex h-dvh flex-col overflow-hidden bg-surface-low text-text-high ${isCourse ? "study-player" : ""}`}
        data-study-pane={studyPane}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 px-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label={
                study ? "Course map" : `Back to ${backLabel ?? "all replays"}`
              }
              title={
                study
                  ? "Back to the course map"
                  : `Back to ${backLabel ?? "all replays"}`
              }
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              <ArrowLeft aria-hidden />
              <span className="hidden sm:inline">{backLabel ?? "Back"}</span>
            </button>
          ) : (
            <span aria-hidden className="w-1" />
          )}
          <div className="flex min-w-0 flex-col justify-center pl-1 leading-tight">
            <h1 className="min-w-0 truncate text-sm font-medium">{replay.title}</h1>
            <p className="hidden min-w-0 truncate text-2xs text-text-low sm:block">
              {repo ?? replay.repo.name}
              {replay.repo.base && !isCourse ? (
                <span className="font-mono">
                  {" · "}
                  {short(replay.repo.base)} → {short(replay.repo.end) ?? "…"}
                  {replay.repo.dirty ? "+" : ""}
                </span>
              ) : null}
              {isCourse
                ? ` · ${countOf(lessons.filter((l) => l.frame).length, "lesson")}`
                : ` · ${agentName(replay.source)}`}
            </p>
          </div>
          <span
            className="mr-1 ml-auto hidden shrink-0 font-mono text-xs text-text-low tabular-nums md:inline"
            title="The net change, from the start to the end"
          >
            {totals ? (
              <>
                <span className="text-success-ink">+{totals.added}</span>{" "}
                <span className="text-danger-ink">−{totals.removed}</span>
                {"  "}
                {totals.files} {totals.files === 1 ? "file" : "files"}
              </>
            ) : null}
          </span>
          {onSave ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSave}
              loading={saving}
              title={
                saved
                  ? "Update the saved copy in the repository"
                  : "Save to the repository’s .replays/"
              }
            >
              <span className="hidden md:inline">
                {saved ? "Update saved copy" : "Save to repo"}
              </span>
              <span className="md:hidden">Save</span>
            </Button>
          ) : null}
          {source ? (
            <a
              href={`/api/${source.kind}/${encodeURIComponent(source.id)}/export`}
              download
              title="One HTML file that plays this replay anywhere, offline"
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              <Download aria-hidden />
              <span className="hidden md:inline">Export</span>
            </a>
          ) : null}
          <PlayerMenu onShortcuts={() => setHelp(true)} />
        </header>
        {isCourse && (
          <div className="study-mobile-tabs" role="group" aria-label="Study pane">
            <button
              type="button"
              aria-pressed={studyPane === "reading"}
              onClick={() => {
                setStudyPane("reading");
                setStepsOpen(true);
                setSide("lesson");
              }}
            >
              Read lesson
            </button>
            <button
              type="button"
              aria-pressed={studyPane === "code"}
              onClick={() => setStudyPane("code")}
            >
              Inspect source
            </button>
          </div>
        )}
        <ShortcutsSheet open={help} onOpenChange={setHelp} groups={SHORTCUTS} />

        {warnings.length ? (
          <p className="mx-2 mb-2 rounded-panel bg-warning-subtle px-4 py-2 text-xs text-warning-ink">
            {warnings.join(" ")}
          </p>
        ) : null}
        {notice ? (
          <p className="mx-2 mb-2 rounded-panel bg-emphasis-subtle px-4 py-2 text-xs text-text-mid">
            {notice}
          </p>
        ) : null}
        {resumeNote && !notice ? (
          <p className="mx-2 mb-2 flex animate-rise items-center gap-3 rounded-panel bg-emphasis-subtle px-4 py-2 text-xs text-text-mid">
            <span>
              Picked up where you left off
              {isCourse ? "" : ` — step ${position} of ${visible.length}`}.
            </span>
            <button
              type="button"
              onClick={() => jump(0)}
              className="rounded-control font-medium text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
            >
              Start from the beginning
            </button>
            <button
              type="button"
              onClick={() => setResumeDismissed(true)}
              className="ml-auto rounded-control text-text-low focus-bar hover:text-text-high"
            >
              Dismiss
            </button>
          </p>
        ) : null}

        <div className="relative flex min-h-0 flex-1">
          {filesOpen ? (
            <ResizablePanel
              side="right"
              min={200}
              max={560}
              label="Resize the files panel"
              {...filesWidth}
              className="study-files player-panel left-0 animate-slide-in-left md:pr-1 md:pl-2"
            >
              <nav
                aria-label="Files"
                className="h-full overflow-hidden bg-surface-panel shadow-sheet md:rounded-surface"
              >
                <FilesPanel
                  files={files}
                  repo={tree?.state === "ready" ? tree.data.paths : undefined}
                  repoState={repoState}
                  onWantRepo={source ? repoFiles.loadTree : undefined}
                  current={path}
                  active={frame?.change?.path}
                  onSelect={selectFile}
                  filterRef={filterRef}
                  onHide={toggleFiles}
                />
              </nav>
            </ResizablePanel>
          ) : null}

          {/* The code on its own sheet: the one thing in the frame that is not chrome. */}
          <main
            className={cn(
              "study-code flex min-w-0 flex-1 animate-fade-in flex-col overflow-hidden bg-surface-base shadow-sheet md:rounded-surface",
              filesOpen ? "md:ml-1" : "md:ml-2",
              stepsOpen ? "md:mr-1" : "md:mr-2",
            )}
          >
            <div className="relative flex h-10 shrink-0 items-center gap-3 px-2 text-xs">
              {filesOpen ? null : (
                <Tool label="Show files ( [ )" onClick={toggleFiles}>
                  <PanelLeftOpen />
                </Tool>
              )}
              <span
                className={cn(
                  "min-w-0 truncate font-mono text-text-low",
                  filesOpen && "pl-2",
                )}
                title={path}
              >
                {dir}
                <span className="text-text-high">{name}</span>
              </span>
              {path && !entry ? (
                <span className="shrink-0 text-text-low">Unchanged in this replay</span>
              ) : null}
              {shown.counts && (shown.counts.added || shown.counts.removed) ? (
                <span className="shrink-0 font-mono tabular-nums">
                  <span className="text-success-ink">+{shown.counts.added}</span>{" "}
                  <span className="text-danger-ink">−{shown.counts.removed}</span>
                </span>
              ) : null}
              {pinned ? (
                <button
                  type="button"
                  onClick={() => setPinned(undefined)}
                  className="shrink-0 rounded-control text-text-low focus-bar hover:text-text-high"
                >
                  Follow the replay
                </button>
              ) : null}
              <Choice
                label="Show"
                value={view}
                options={VIEWS}
                onChange={setView}
                className="ml-auto shrink-0"
              />
              {stepsOpen ? null : (
                <Tool
                  label={`Show the ${isCourse ? "lesson" : "steps"} ( ] )`}
                  onClick={toggleSteps}
                >
                  <PanelRightOpen />
                </Tool>
              )}
              <LiveBar store={transport.progress} live={shown.live} />
            </div>
            {narrated ? null : (
              // Keyed by step, so each one's words fade in rather than swap.
              <Caption key={cursor} replay={replay} frame={frame} onJump={jump} />
            )}
            <div className="min-h-0 flex-1">{body}</div>
          </main>

          {stepsOpen ? (
            <ResizablePanel
              side="left"
              min={260}
              max={720}
              label="Resize the side panel"
              {...stepsWidth}
              className="study-reading player-panel right-0 animate-slide-in-right md:pr-2 md:pl-1"
            >
              <aside
                aria-label="Session"
                className="flex h-full flex-col overflow-hidden bg-surface-panel shadow-sheet md:rounded-surface"
              >
                <div className="flex h-10 shrink-0 items-center gap-1 px-2">
                  <Choice
                    label="Side panel"
                    value={side}
                    onChange={setSide}
                    options={
                      isCourse
                        ? [
                            {
                              value: "lesson",
                              label: "Lesson",
                              hint: "The lesson, as it is taught (E)",
                            },
                            {
                              value: "steps",
                              label: "Steps",
                              hint: "Every step of the course (E)",
                            },
                            ...(study
                              ? [
                                  {
                                    value: "courses" as const,
                                    label: "Courses",
                                    hint: "Chapters and lessons",
                                  },
                                ]
                              : []),
                          ]
                        : [
                            {
                              value: "steps",
                              label: "Steps",
                              hint: "Every step of the session (E)",
                            },
                            {
                              value: "evidence",
                              hint: "What the agent checked, and whether it held (E)",
                              label: (
                                <>
                                  Evidence
                                  {worries ? (
                                    <span className="rounded-full bg-warning-subtle px-1.5 text-2xs font-medium text-warning-ink tabular-nums">
                                      {worries}
                                    </span>
                                  ) : null}
                                </>
                              ),
                            },
                          ]
                    }
                  />
                  {side === "steps" && !isCourse ? (
                    <StepFilter
                      filter={filter}
                      onFilter={setFilter}
                      notes={noted.length}
                      className="ml-auto"
                    />
                  ) : null}
                  <Tool
                    label={`Hide the ${isCourse ? "lesson" : "steps"} ( ] )`}
                    onClick={toggleSteps}
                    className={side === "steps" && !isCourse ? undefined : "ml-auto"}
                  >
                    <PanelRightClose />
                  </Tool>
                </div>
                <div key={side} className="min-h-0 flex-1 overflow-auto">
                  {side === "courses" && study ? (
                    <CourseOutline study={study} reviewed={lessonDone} />
                  ) : side === "lesson" ? (
                    <LessonPanel
                      replay={replay}
                      frames={playback.frames}
                      cursor={cursor}
                      furthest={furthest}
                      onJump={jump}
                      study={study}
                      onInspect={(next) => {
                        const step = playback.frames[next - 1]?.step;
                        const path = step && "path" in step ? step.path : undefined;
                        const lineCount =
                          path && replay.course?.sources?.[path]?.lineCount;
                        const result =
                          path && lineCount
                            ? sourceIndex.resolve(
                                `source:${path}#L1-L${lineCount}`,
                                next,
                              )
                            : undefined;
                        if (result && "destination" in result)
                          navigation.navigate(result.destination);
                        else {
                          setStudyPane("code");
                          jump(next);
                        }
                      }}
                    />
                  ) : side === "steps" ? (
                    <StepList
                      replay={replay}
                      frames={playback.frames}
                      visible={visible}
                      cursor={cursor}
                      onJump={jump}
                      {...(isCourse ? {} : { filter })}
                    />
                  ) : (
                    <EvidencePanel
                      ledger={ledger}
                      replay={replay}
                      cursor={cursor}
                      onJump={jump}
                    />
                  )}
                </div>
              </aside>
            </ResizablePanel>
          ) : null}
        </div>

        {activeReference ? (
          <div className="mx-2 mt-2 flex items-center gap-3 rounded-panel bg-surface-mid px-4 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              Pinned source: {activeReference.path} · original lines{" "}
              {activeReference.lines.join("–")} → replay lines{" "}
              {activeReference.displayed.join("–")}
            </span>
            <button
              type="button"
              className="shrink-0 text-emphasis-ink underline focus-bar"
              onClick={() => {
                jump(activeReference.returnCursor);
                setReference(undefined);
                setStudyPane("reading");
              }}
            >
              Return to explanation
            </button>
          </div>
        ) : null}
        <footer className="study-transport flex h-14 shrink-0 items-center gap-3 px-3">
          <div className="flex items-center gap-1">
            <Tool label="Previous step (←)" onClick={back}>
              <SkipBack />
            </Tool>
            <IconButton
              label={playing ? "Pause (space)" : "Play (space)"}
              variant="emphasis"
              size="md"
              className="rounded-full"
              onClick={toggle}
            >
              {playing ? <Pause /> : <Play />}
            </IconButton>
            <Tool label="Play the next step (→)" onClick={forward}>
              <SkipForward />
            </Tool>
          </div>
          <div className="min-w-0 flex-1">
            <Scrubber
              steps={scrubSteps}
              cursor={position}
              label={isCourse ? "Lesson timeline" : "Session timeline"}
              baseLabel={isCourse ? "Empty repository" : "Base commit"}
              labelOf={scrubLabel}
              onJump={jumpToPosition}
            />
          </div>
          <StepCount
            position={position}
            shown={visible.length}
            all={total}
            coverage={coverage}
            source={sourceCoverage}
            isCourse={isCourse}
          />
          {isCourse ? (
            <LessonActions
              study={study}
              done={lessonDone}
              onDone={() => setReviewed(!reviewed)}
            />
          ) : (
            <Select
              value={String(transport.speed)}
              onValueChange={(next) => setSpeed(Number(next) as Speed)}
            >
              <SelectTrigger
                size="sm"
                variant="ghost"
                className="shrink-0 tabular-nums"
                aria-label="Speed"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((speed) => (
                  <SelectItem key={speed} value={String(speed)}>
                    {speed}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </footer>
      </div>
    </SourceNavigationContext.Provider>
  );
}

/**
 * Where the replay is, in one number that means the same everywhere: the
 * step among those shown. The detail says what else is known — how much of
 * a course's repository exists yet.
 */
function StepCount({
  position,
  shown,
  all,
  coverage,
  source,
  isCourse,
}: {
  position: number;
  shown: number;
  all: number;
  coverage?: ReturnType<Playback["coverageAt"]>;
  source?: { explained: number; included: number; total: number };
  isCourse: boolean;
}) {
  return (
    <details className="study-progress-detail">
      <summary
        aria-label="Playback progress"
        title={
          shown === all
            ? `Step ${position} of ${all}`
            : `Step ${position} of ${shown} shown (${all} in all)`
        }
        className={cn("text-xs tabular-nums", !isCourse && "cursor-default")}
      >
        <span className="study-step-count">
          {position} / {shown}
        </span>
        {isCourse ? (
          <span className="study-session-percent">{percent(position, shown)}</span>
        ) : null}
      </summary>
      <div>
        <p>
          Step {position} of {shown}
          {shown === all ? "" : ` shown — ${all} in all`}
        </p>
        {coverage && (
          <p>
            Files {percent(coverage.files, coverage.totalFiles)} · Lines{" "}
            {percent(coverage.lines, coverage.totalLines)} of the repository exist
          </p>
        )}
        {source && (
          <p>
            Selected source: {source.explained} explained · {source.included} included /{" "}
            {source.total} lines
          </p>
        )}
        {isCourse ? (
          <p className="flex items-center gap-1.5">
            <Check aria-hidden className="size-3.5 text-success-ink" />A lesson is done
            once you reach its end; you can also mark it by hand.
          </p>
        ) : null}
      </div>
    </details>
  );
}

// Raster images only: an SVG is text, and reads (and diffs) as code.
const isImage = (path: string) => /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(path);

/** An image the replay cannot type in: shown as it is, not as bytes. */
function ImagePreview({ src, note }: { src: string; note?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed)
    return <Message>This image could not be read from the repository.</Message>;
  return (
    <figure className="flex h-full flex-col items-center justify-center gap-3 overflow-auto p-8">
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="max-h-full max-w-full animate-fade-in rounded-panel object-contain shadow-popover"
      />
      {note ? <figcaption className="text-2xs text-text-low">{note}</figcaption> : null}
    </figure>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="max-w-prose p-6 text-sm text-text-mid">{children}</p>;
}

/**
 * Preparing a replay applies every step once; diffs wait until a change is
 * shown. That is a few milliseconds for an ordinary session, so it happens
 * at once; a very long history is prepared in slices that yield to the
 * browser, with the player's shape and a count on screen meanwhile.
 */
export function Player(props: PlayerProps) {
  const { replay } = props;
  const large =
    replay.steps.length > 4000 ||
    replay.steps.reduce(
      (sum, step) =>
        sum +
        ("content" in step && typeof step.content === "string"
          ? step.content.length
          : 0),
      0,
    ) > 8_000_000 ||
    Object.values(replay.files).reduce((sum, text) => sum + (text?.length ?? 0), 0) >
      8_000_000;
  return large ? (
    <PreparingPlayer key={replay.endedAt} {...props} />
  ) : (
    <ReadyPlayer {...props} />
  );
}

function PreparingPlayer(props: PlayerProps) {
  const [prepared, setPrepared] = React.useState<Playback>();
  const [count, setCount] = React.useState(0);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void preparePlayback(props.replay, setCount, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setPrepared(result);
        },
        (reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not prepare this session.",
            );
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [props.replay]);
  if (prepared) return <ReadyPlayer {...props} prepared={prepared} />;
  return (
    <PlayerSkeleton
      title={props.replay.title}
      what={
        error ?? `Preparing the player — ${count} of ${props.replay.steps.length} steps`
      }
      backLabel={props.backLabel}
      onBack={props.onBack}
    />
  );
}
