import {
  agentName,
  concernsOf,
  countLines,
  diffHunks,
  evidenceOf,
  isChange,
  play,
  preparePlayback,
  type Playback,
  sourceReferenceIndex,
  type SourceDestination,
  type Replay,
  type StudyContext,
} from "@agent-replay/core";
import {
  ArrowLeft,
  Download,
  Keyboard,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import * as React from "react";

import {
  Button,
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

import type { ReplaySource } from "../api";
import { Choice } from "../choice";
import { CourseActions, CourseOutline } from "../course-navigation";
import {
  readStudyProgress,
  saveStudyProgress,
  studyProgressKey,
} from "../study-progress";
import { firstLine, stepLabel, when } from "../labels";
import { isBoolean, isNumber, oneOf, usePersistent } from "../persist";
import { ThemeToggle } from "../theme-toggle";
import { Caption } from "./caption";
import { CodeView, type Blame, type Origin } from "./code-view";
import type { Diffable } from "./compose";
import { EvidencePanel } from "./evidence";
import { FilesPanel } from "./files";
import { LessonPanel } from "./lesson";
import { SourceNavigationContext } from "./source-context";
import { StepList } from "./steps";
import { SPEEDS, usePlayback, type Speed } from "./use-playback";
import { useRepo } from "./use-repo";

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

type Filter = "all" | "changes" | "notes";
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
      { keys: "home", description: "Back to the base commit" },
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
      { keys: "]", description: "Show or hide the steps" },
      { keys: "e", description: "Steps or evidence" },
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
  /** Back to the list; absent in a replay exported as a file. */
  onBack?: () => void;
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
  const progressKey = studyProgressKey(replay, study);
  const [savedProgress] = React.useState(() =>
    isCourse ? readStudyProgress(progressKey) : undefined,
  );
  const [reviewed, setReviewed] = React.useState(savedProgress?.reviewed ?? false);
  const [studyPane, setStudyPane] = React.useState<"reading" | "code">("reading");
  const initial =
    at ?? savedProgress?.cursor ?? (isCourse ? Math.min(2, replay.steps.length) : 0);
  const transport = usePlayback(playback.frames, visible, initial);
  const { cursor, progress, playing } = transport;

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
  const [filesOpen, setFilesOpen] = usePersistent(
    isCourse ? "course-files-open" : "files-open",
    !isCourse,
    isBoolean,
  );
  // Three panels crowd a laptop screen: the steps start shut below 1200px,
  // until the reviewer opens them (which is then remembered).
  const [stepsOpen, setStepsOpen] = usePersistent(
    isCourse ? "course-notes-open" : "notes-open",
    isCourse || window.innerWidth >= 1200,
    isBoolean,
  );
  const filesWidth = usePanelWidth("files-width", 272);
  const stepsWidth = usePanelWidth(
    isCourse ? "course-notes-width" : "notes-width",
    isCourse ? 480 : 340,
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
  React.useEffect(() => {
    if (isCourse && !activeReference)
      saveStudyProgress(progressKey, { cursor, reviewed, updatedAt: Date.now() });
  }, [cursor, reviewed, isCourse, progressKey, activeReference]);
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
      if (f.change?.applied)
        map.set(f.change.path, [...(map.get(f.change.path) ?? []), f.index]);
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

  const shown = React.useMemo((): {
    diff?: Diffable;
    content: string | null;
    progress: number;
    counts?: { added: number; removed: number };
    hideRemoved?: boolean;
    focus?: readonly [number, number];
  } => {
    if (!path || !inReplay) return { content: null, progress: 1 };
    const now = playback.contentAt(path, cursor);
    if (activeReference && activeReference.path === path)
      return { content: now, progress: 1, focus: activeReference.displayed };
    // An explanation about code shows the file as it stands, those lines lit.
    if (explained && explained.path === path) {
      const count = (now ?? "").split("\n").length;
      return {
        content: now,
        progress: 1,
        focus: explained.lines ?? [1, count],
      };
    }
    // The file as it reads — but a change being made to it still plays, its
    // new lines typed in place and marked, so playback is never a jump cut.
    const changeStep =
      lastChange === undefined ? undefined : playback.frames[lastChange]?.step;
    const changeProgress =
      changeStep && "sourceMode" in changeStep && changeStep.sourceMode === "included"
        ? 1
        : progress;
    if (view === "file" && lastChange !== undefined && lastChange === cursor - 1) {
      const change = playback.frames[lastChange]!.change!;
      return {
        diff: change,
        content: now,
        progress: changeProgress,
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
          progress: lastChange === cursor - 1 ? changeProgress : 1,
          counts: change,
        };
      }
    }
    if (view === "base" && sinceBase)
      return { ...sinceBase, content: now, progress: 1 };
    return { content: now, progress: 1 };
  }, [
    path,
    inReplay,
    playback,
    cursor,
    view,
    lastChange,
    progress,
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

  // Scrubber over the visible steps; its cursor counts visible steps applied.
  const position = visible.filter((index) => index < cursor).length;
  const scrubSteps = React.useMemo((): ScrubStep[] => {
    const checks = new Map(ledger.checks.map((check) => [check.index, check]));
    return visible.map((index) => {
      const frame = playback.frames[index]!;
      const { step } = frame;
      const check = checks.get(index);
      const tone: Tone | undefined = replay.notes[step.id]
        ? "note"
        : check
          ? check.passed
            ? "pass"
            : "fail"
          : step.kind === "prompt" && step.agent === "main"
            ? "prompt"
            : step.kind === "commit"
              ? "commit"
              : undefined;
      return { label: stepLabel(frame), ...(tone ? { tone } : {}) };
    });
  }, [playback, visible, ledger, replay.notes]);

  const cycleView = React.useCallback(() => {
    const at = VIEWS.findIndex((v) => v.value === view);
    setView(VIEWS[(at + 1) % VIEWS.length]!.value);
  }, [view, setView]);
  const toggleFiles = React.useCallback(
    () => setFilesOpen(!filesOpen),
    [filesOpen, setFilesOpen],
  );
  const toggleSteps = React.useCallback(
    () => setStepsOpen(!stepsOpen),
    [stepsOpen, setStepsOpen],
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
          setStepsOpen(true);
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
          setFilesOpen(true);
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
    cycleView,
    toggleFiles,
    toggleSteps,
    setFilesOpen,
    setStepsOpen,
    side,
    setSide,
    isCourse,
  ]);

  const short = (sha?: string) => sha?.slice(0, 7);

  // Blame for the file on screen, once the step on it has settled.
  const settled = shown.progress >= 1;
  const origins = React.useMemo((): Origin[] | undefined => {
    if (!path || !inReplay || !settled) return undefined;
    return playback.blameAt(path, cursor).map((index) => {
      if (index < 0) return "base";
      if (index === cursor - 1) return "current";
      return playback.frames[index]!.step.kind === "external" ? "outside" : "agent";
    });
  }, [path, inReplay, settled, playback, cursor]);

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

  // How far along a history is: how much of the end state exists yet.
  const coverage = React.useMemo(
    () =>
      replay.source === "git" || isCourse ? playback.coverageAt(cursor) : undefined,
    [replay.source, isCourse, playback, cursor],
  );

  const tree = repoFiles.tree;
  const repoState =
    tree?.state === "loading"
      ? ("loading" as const)
      : tree?.state === "failed"
        ? { failed: tree.message }
        : undefined;

  let body: React.ReactNode;
  if (!path) {
    body = <Message>No files changed.</Message>;
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
          Not written yet — step {created.index + 1} creates it.{" "}
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
      <CodeView
        key={path}
        path={path}
        diff={shown.diff}
        content={shown.content}
        progress={shown.progress}
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

  return (
    <SourceNavigationContext.Provider value={navigation}>
      <div
        className={`flex h-dvh flex-col overflow-hidden bg-surface-base text-text-high ${isCourse ? "study-player" : ""}`}
        data-study-pane={studyPane}
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line pr-2 pl-1.5">
          {onBack ? (
            <Tool label={study ? "Course map" : "All replays"} onClick={onBack}>
              <ArrowLeft />
            </Tool>
          ) : (
            <span aria-hidden className="w-1" />
          )}
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="min-w-0 truncate text-sm font-medium">{replay.title}</h1>
            <p className="hidden shrink-0 text-xs text-text-low lg:block">
              {repo ?? replay.repo.name}
              {replay.repo.base ? (
                <span className="font-mono">
                  {" "}
                  {short(replay.repo.base)} → {short(replay.repo.end) ?? "…"}
                  {replay.repo.dirty ? "+" : ""}
                </span>
              ) : null}
              {` · ${agentName(replay.source)}`}
            </p>
          </div>
          <span className="ml-auto hidden shrink-0 font-mono text-xs text-text-low tabular-nums md:inline">
            <span className="text-success-ink">+{playback.totals.added}</span>{" "}
            <span className="text-danger-ink">−{playback.totals.removed}</span>
            {"  "}
            {playback.totals.files} files
          </span>
          {onSave ? (
            <Button size="sm" variant="ghost" onClick={onSave} loading={saving}>
              {saved ? "Update saved copy" : "Save to repo"}
            </Button>
          ) : null}
          {source ? (
            <a
              href={`/api/${source.kind}/${encodeURIComponent(source.id)}/export`}
              download
              title="One HTML file that plays this replay anywhere, offline"
              className="inline-flex h-7 items-center gap-1.5 rounded-control px-2.5 text-xs font-medium text-text-mid focus-bar hover:bg-hover hover:text-text-high [&_svg]:size-3.5"
            >
              <Download aria-hidden />
              Standalone HTML
            </a>
          ) : null}
          <span className="flex items-center">
            <Tool
              label={filesOpen ? "Hide files ( [ )" : "Show files ( [ )"}
              aria-pressed={filesOpen}
              onClick={toggleFiles}
            >
              <PanelLeft />
            </Tool>
            <Tool
              label={stepsOpen ? "Hide steps ( ] )" : "Show steps ( ] )"}
              aria-pressed={stepsOpen}
              onClick={toggleSteps}
            >
              <PanelRight />
            </Tool>
            <Tool label="Keyboard shortcuts ( ? )" onClick={() => setHelp(true)}>
              <Keyboard />
            </Tool>
            <ThemeToggle />
          </span>
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
          <p className="border-b border-line px-4 py-1.5 text-xs text-warning-ink">
            {warnings.join(" ")}
          </p>
        ) : null}
        {notice ? (
          <p className="border-b border-line bg-emphasis-subtle px-4 py-1.5 text-xs text-text-mid">
            {notice}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {filesOpen ? (
            <ResizablePanel
              side="right"
              min={200}
              max={560}
              label="Resize the files panel"
              {...filesWidth}
              className="study-files border-r border-line bg-surface-low"
            >
              <nav aria-label="Files" className="h-full">
                <FilesPanel
                  files={files}
                  repo={tree?.state === "ready" ? tree.data.paths : undefined}
                  repoState={repoState}
                  onWantRepo={source ? repoFiles.loadTree : undefined}
                  current={path}
                  active={frame?.change?.path}
                  onSelect={selectFile}
                  filterRef={filterRef}
                />
              </nav>
            </ResizablePanel>
          ) : null}

          <main className="study-code flex min-w-0 flex-1 flex-col">
            <div className="relative flex h-10 shrink-0 items-center gap-3 border-b border-line pr-2 pl-4 text-xs">
              <span className="min-w-0 truncate font-mono text-text-low" title={path}>
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
              {shown.progress < 1 ? (
                // How far the change on screen has played.
                <span
                  aria-hidden
                  className="absolute bottom-0 left-0 h-0.5 bg-emphasis"
                  style={{ width: `${shown.progress * 100}%` }}
                />
              ) : null}
            </div>
            <Caption replay={replay} frame={frame} cursor={cursor} onJump={jump} />
            <div className="min-h-0 flex-1">{body}</div>
          </main>

          {stepsOpen ? (
            <ResizablePanel
              side="left"
              min={260}
              max={640}
              label="Resize the steps panel"
              {...stepsWidth}
              className="study-reading border-l border-line bg-surface-low"
            >
              <aside aria-label="Session" className="flex h-full flex-col">
                <div className="flex h-10 shrink-0 items-center border-b border-line px-2">
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
                </div>
                <div key={side} className="min-h-0 flex-1 overflow-auto">
                  {side === "courses" && study ? (
                    <CourseOutline study={study} reviewed={reviewed} />
                  ) : side === "lesson" ? (
                    <LessonPanel
                      replay={replay}
                      frames={playback.frames}
                      cursor={cursor}
                      onJump={jump}
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
          <div className="flex items-center gap-3 border-t border-line bg-surface-mid px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              Pinned source: {activeReference.path} · original lines{" "}
              {activeReference.lines.join("–")} → replay lines{" "}
              {activeReference.displayed.join("–")}
            </span>
            <button
              type="button"
              className="shrink-0 text-emphasis underline focus-bar"
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
        <footer className="study-transport flex h-14 shrink-0 items-center gap-3 border-t border-line px-3">
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
              label="Session timeline"
              baseLabel="Base commit"
              onJump={jumpToPosition}
            />
          </div>
          <details className="study-progress-detail">
            <summary
              aria-label="Playback progress"
              title="Playback and source coverage"
            >
              <span className="study-step-count">
                {position}/{visible.length}
              </span>
              <span className="study-session-percent">
                {percent(position, visible.length)}
              </span>
            </summary>
            <div>
              <p>
                Step {position} of {visible.length}
              </p>
              {coverage && (
                <p>
                  Files {percent(coverage.files, coverage.totalFiles)} · Lines{" "}
                  {percent(coverage.lines, coverage.totalLines)}
                </p>
              )}
              {sourceCoverage && (
                <p>
                  Selected source: {sourceCoverage.explained} explained ·{" "}
                  {sourceCoverage.included} included / {sourceCoverage.total} lines
                </p>
              )}
              <p>Playback progress does not mark a lesson reviewed.</p>
            </div>
          </details>
          {study && (
            <CourseActions
              study={study}
              reviewed={reviewed}
              onReviewed={() => setReviewed(!reviewed)}
            />
          )}
          {!isCourse && (
            <>
              <Select
                value={filter}
                onValueChange={(next) => isFilter(next) && setFilter(next)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32 shrink-0"
                  aria-label="Steps shown"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="changes">Changes</SelectItem>
                  <SelectItem value="all">Every step</SelectItem>
                  {noted.length ? (
                    <SelectItem value="notes">Notes ({noted.length})</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <Select
                value={String(transport.speed)}
                onValueChange={(next) => setSpeed(Number(next) as Speed)}
              >
                <SelectTrigger size="sm" className="w-20 shrink-0" aria-label="Speed">
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
            </>
          )}
        </footer>
      </div>
    </SourceNavigationContext.Provider>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-sm text-text-mid">{children}</p>;
}

/** Show the session immediately while indexing long histories in yielding slices. */
export function Player(props: PlayerProps) {
  const { replay } = props;
  const large =
    replay.steps.length > 200 ||
    replay.steps.reduce(
      (sum, step) =>
        sum +
        ("content" in step && typeof step.content === "string"
          ? step.content.length
          : 0),
      0,
    ) > 200_000 ||
    Object.values(replay.files).reduce((sum, text) => sum + (text?.length ?? 0), 0) >
      200_000;
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
  const intro = props.replay.steps.find((step) => step.kind === "lesson");
  return (
    <main className="min-h-dvh bg-surface-base p-8 text-text-high">
      {props.onBack && (
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          Back to lessons
        </Button>
      )}
      <h1 className="mt-6 text-2xl font-semibold">{props.replay.title}</h1>
      {intro?.kind === "lesson" && (
        <p className="mt-4 max-w-2xl text-text-mid">{intro.goal}</p>
      )}
      <p role={error ? "alert" : "status"} className="mt-6 text-sm text-text-mid">
        {error ??
          `Preparing the player… ${count} of ${props.replay.steps.length} steps indexed`}
      </p>
      {!error && (
        <progress
          className="mt-3"
          value={count}
          max={Math.max(1, props.replay.steps.length)}
          aria-label="Session preparation"
        />
      )}
    </main>
  );
}
