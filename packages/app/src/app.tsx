import {
  parseCurriculum,
  curriculumLessons,
  type StudyContext,
  type Replay,
} from "@agent-replay/core";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/ui";

import { api, knownTitle, useLoad } from "./api";
import { Library } from "./library";
import { CourseLibrary, StandaloneCourseLibrary } from "./course-library";
import { libraryHash, parseLibrary, type LibraryParams } from "./library-params";
import { Player } from "./player/player";

type Route =
  | { page: "learn"; key?: string }
  | { page: "library"; params: LibraryParams }
  /** `at`: the step to open on — a link to a moment in the replay. */
  | { page: "replay"; id: string; at?: number }
  | { page: "session"; id: string; at?: number };

function parse(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const [, page, id] = path.split("/");
  if (page === "learn") return { page: "learn", key: id };
  if ((page === "replay" || page === "session") && id) {
    const rawAt = new URLSearchParams(search).get("at");
    const at = rawAt === null ? undefined : Number(rawAt);
    return {
      page,
      id: decodeURIComponent(id),
      ...(at !== undefined && Number.isSafeInteger(at) && at >= 0 ? { at } : {}),
    };
  }
  return { page: "library", params: parseLibrary(search) };
}

function useRoute(): Route {
  const [hash, setHash] = React.useState(() => window.location.hash);
  React.useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parse(hash);
}

// Where the reader was before opening a replay — a tab of the library with
// its search and page, or Learn — so Back returns there, and says so.
let lastPlace: { hash: string; label: string } | undefined;

/** Back from a replay: where the reader came from, or the list it belongs in. */
function backTo(fallback: { hash: string; label: string }) {
  const place = lastPlace ?? fallback;
  return {
    label: place.label,
    go: () => {
      window.location.hash = place.hash;
    },
  };
}

const SESSIONS = { hash: "#/", label: "Sessions" };
const SAVED = { hash: "#/?tab=saved", label: "Saved" };
const LEARN = { hash: "#/learn", label: "Learn" };

const back = () => backTo(SESSIONS).go();

// Typing in the search replaces the URL rather than adding to history.
const setLibrary = (params: LibraryParams) => {
  const hash = libraryHash(params);
  lastPlace = { hash, label: params.tab === "saved" ? "Saved" : "Sessions" };
  window.history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base p-6 text-sm text-text-mid">
      {children}
    </div>
  );
}

/** Seconds since it appeared, for a wait that should say how long it has been. */
function useSeconds() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * The player's shape while a replay is read: its title, the way back, and
 * where the code will be — so opening a replay is a page arriving, not a
 * blank screen with a spinner.
 */
function PlayerSkeleton({
  title,
  what,
  backLabel,
  onBack,
}: {
  title?: string;
  what: string;
  backLabel: string;
  onBack: () => void;
}) {
  const seconds = useSeconds();
  const widths = [62, 48, 71, 35, 80, 54, 66, 28, 74, 45, 58, 39, 69, 51];
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-base text-text-high">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-text-mid focus-bar hover:bg-hover hover:text-text-high [&_svg]:size-4"
        >
          <ArrowLeft aria-hidden />
          {backLabel}
        </button>
        <span aria-hidden className="h-5 w-px bg-line" />
        {title ? (
          <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        ) : (
          <span className="h-3.5 w-64 animate-pulse rounded-full bg-surface-mid" />
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-line bg-surface-low p-4 md:flex">
          {widths.slice(0, 9).map((w, i) => (
            <span
              key={i}
              className="h-2.5 animate-pulse rounded-full bg-surface-mid"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            role="status"
            className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 text-xs text-text-mid"
          >
            <LoaderCircle aria-hidden className="size-3.5 animate-spin text-text-low" />
            {what}
            {seconds >= 2 ? (
              <span className="text-text-low tabular-nums">· {seconds} s</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 px-8 py-6">
            {widths.map((w, i) => (
              <span
                key={i}
                className="h-2.5 animate-pulse rounded-full bg-surface-mid"
                style={{ width: `${w * 0.8}%`, animationDelay: `${i * 60}ms` }}
              />
            ))}
            {seconds >= 6 ? (
              <p className="mt-4 max-w-prose text-xs text-text-low">
                A long session is read in full the first time it is opened, and compared
                with the repository; opening it again is quick.
              </p>
            ) : null}
          </div>
        </main>
        <div className="hidden w-80 shrink-0 flex-col gap-3 border-l border-line bg-surface-low p-4 lg:flex">
          {widths.slice(3, 12).map((w, i) => (
            <span
              key={i}
              className="h-2.5 animate-pulse rounded-full bg-surface-mid"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
      <footer className="h-14 shrink-0 border-t border-line" />
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <Status>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="text-text-high">{message}</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={back}>
            Back
          </Button>
        </div>
      </div>
    </Status>
  );
}

/** The step the address says the player is on — to keep the place on a reload. */
function cursorInHash(): number | undefined {
  const raw = new URLSearchParams(window.location.hash.split("?")[1]).get("at");
  const value = raw === null ? undefined : Number(raw);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * A course being written changes while it is watched: its newer version is
 * fetched quietly, and offered rather than swapped in under the reader.
 */
function useNewerCourse(id: string, shown: Replay | undefined): Replay | undefined {
  const [newer, setNewer] = React.useState<Replay>();
  const endedAt = shown?.endedAt;
  const isCourse = shown?.source === "course";
  React.useEffect(() => {
    if (!isCourse) return;
    let alive = true;
    const timer = setInterval(async () => {
      const result = await api.replay(id);
      if (alive && result.ok && result.data.endedAt !== endedAt) setNewer(result.data);
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, isCourse, endedAt]);
  return newer && newer.endedAt !== endedAt ? newer : undefined;
}

function SavedReplay({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.replay);
  const catalog = useLoad("curricula", api.curricula);
  const source = React.useMemo(() => ({ kind: "replays" as const, id }), [id]);
  const [replay, setReplay] = React.useState<{ data: Replay; at?: number }>();
  const shown = replay?.data ?? (loaded.state === "ready" ? loaded.data : undefined);
  const newer = useNewerCourse(id, shown);
  const fallback = backTo(shown?.source === "course" ? LEARN : SAVED);
  if (
    loaded.state === "loading" ||
    (shown?.source === "course" && catalog.state === "loading")
  )
    return (
      <PlayerSkeleton
        title={knownTitle(id)}
        what="Opening the replay…"
        backLabel={fallback.label}
        onBack={fallback.go}
      />
    );
  if (loaded.state === "failed") return <Failed message={loaded.message} />;
  const course =
    catalog.state === "ready"
      ? catalog.data.courses.find((c) =>
          curriculumLessons(c.curriculum).some((l) => `${c.key}:${l.replay}` === id),
        )
      : undefined;
  const lesson =
    course &&
    curriculumLessons(course.curriculum).find(
      (l) => `${course.key}:${l.replay}` === id,
    );
  const study = course && lesson ? { ...course, lessonId: lesson.id } : undefined;
  const added = newer ? newer.steps.length - shown!.steps.length : 0;
  return (
    <Player
      key={shown!.endedAt}
      replay={shown!}
      source={source}
      study={study}
      at={replay ? replay.at : at}
      onBack={
        study
          ? () => {
              window.location.hash = `#/learn/${study.key}`;
            }
          : fallback.go
      }
      backLabel={study ? "Course map" : fallback.label}
      notice={
        newer ? (
          <>
            The course has moved on
            {added > 0 ? ` — ${added} new step${added === 1 ? "" : "s"}` : ""}.{" "}
            <button
              type="button"
              onClick={() => setReplay({ data: newer, at: cursorInHash() })}
              className="rounded-control font-medium text-text-high underline decoration-line-high underline-offset-2 focus-bar hover:decoration-text-mid"
            >
              Show them
            </button>
          </>
        ) : undefined
      }
    />
  );
}

function LiveSession({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.session);
  const source = React.useMemo(() => ({ kind: "sessions" as const, id }), [id]);
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>();
  const fallback = backTo(SESSIONS);
  if (loaded.state === "loading")
    return (
      <PlayerSkeleton
        title={knownTitle(id)}
        what="Reading the session and the repository…"
        backLabel={fallback.label}
        onBack={fallback.go}
      />
    );
  if (loaded.state === "failed") return <Failed message={loaded.message} />;
  const { replay, repo, warnings, saved } = loaded.data;
  const save = async () => {
    setSaving(true);
    setOutcome(undefined);
    const result = await api.save(id);
    setSaving(false);
    if (!result.ok) {
      setOutcome(`Not saved: ${result.failure.message}.`);
    } else if (result.data.id) {
      window.location.hash = `#/replay/${encodeURIComponent(result.data.id)}`;
    } else {
      // Saved into a repository this player was not started for.
      setOutcome(`Saved to ${result.data.file}.`);
    }
  };
  return (
    <Player
      replay={replay}
      source={source}
      at={at}
      repo={repo}
      warnings={outcome ? [...warnings, outcome] : warnings}
      onSave={() => void save()}
      saved={Boolean(saved)}
      saving={saving}
      onBack={fallback.go}
      backLabel={fallback.label}
    />
  );
}

function LibraryRoute({ params }: { params: LibraryParams }) {
  const hash = libraryHash(params);
  React.useEffect(() => {
    lastPlace = { hash, label: params.tab === "saved" ? "Saved" : "Sessions" };
  }, [hash, params.tab]);
  return <Library params={params} onParams={setLibrary} />;
}

function LearnRoute({ courseKey }: { courseKey?: string }) {
  React.useEffect(() => {
    lastPlace = courseKey
      ? { hash: `#/learn/${courseKey}`, label: "Course map" }
      : LEARN;
  }, [courseKey]);
  return <CourseLibrary courseKey={courseKey} />;
}

/**
 * A replay exported as one HTML file carries itself: no service to ask, no
 * library to go back to — the player, and the replay.
 */
function embedded(): Replay | undefined {
  const text = document.getElementById("replay-data")?.textContent;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Replay;
  } catch {
    return undefined;
  }
}

function Standalone({ replay }: { replay: Replay }) {
  const [study] = React.useState<StudyContext | undefined>(() => {
    try {
      const input = JSON.parse(
        document.getElementById("curriculum-data")?.textContent ?? "null",
      );
      if (!input) return undefined;
      const curriculum = parseCurriculum(input.curriculum);
      return curriculumLessons(curriculum).some((l) => l.id === input.lessonId)
        ? { curriculum, lessonId: input.lessonId }
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [at] = React.useState(() => {
    const value = Number(
      new URLSearchParams(window.location.hash.split("?")[1]).get("at"),
    );
    return Number.isInteger(value) && value > 0 ? value : undefined;
  });
  return <Player replay={replay} at={at} study={study} />;
}

const standalone = embedded();
const standaloneLibrary = (() => {
  try {
    const input = JSON.parse(
      document.getElementById("curriculum-library")?.textContent ?? "null",
    );
    if (
      !input ||
      typeof input.exportBase !== "string" ||
      !/^(?:[\w-]+\/)*$/.test(input.exportBase)
    )
      return undefined;
    return {
      curriculum: parseCurriculum(input.curriculum),
      exportBase: input.exportBase,
    };
  } catch {
    return undefined;
  }
})();

export function App() {
  if (standaloneLibrary) return <StandaloneCourseLibrary {...standaloneLibrary} />;
  if (standalone) return <Standalone replay={standalone} />;
  return <Routed />;
}

function Routed() {
  const route = useRoute();
  if (route.page === "learn") return <LearnRoute courseKey={route.key} />;
  if (route.page === "replay")
    return <SavedReplay key={route.id} id={route.id} at={route.at} />;
  if (route.page === "session")
    return <LiveSession key={route.id} id={route.id} at={route.at} />;
  return <LibraryRoute params={route.params} />;
}
