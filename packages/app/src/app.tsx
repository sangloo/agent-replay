import {
  parseCurriculum,
  curriculumLessons,
  type StudyContext,
  type Replay,
} from "@agent-replay/core";
import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/ui";

import { api, useLoad, useSession } from "./api";
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

// Where the list was — the tab, the search, the page — so Back returns there.
let lastLibrary = "#/";

const back = () => {
  window.location.hash = lastLibrary;
};

// Typing in the search replaces the URL rather than adding to history.
const setLibrary = (params: LibraryParams) => {
  lastLibrary = libraryHash(params);
  window.history.replaceState(null, "", lastLibrary);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base p-6 text-sm text-text-mid">
      {children}
    </div>
  );
}

/**
 * Waiting, said plainly: what is happening, for how long so far, and — once
 * it has been a while — why, so a long first capture never looks stuck.
 */
function Loading({ what }: { what: string }) {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Status>
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <span className="flex items-center gap-2 text-text-high">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-text-low" />
          {what}
        </span>
        {seconds >= 3 ? (
          <span className="text-xs text-text-low tabular-nums">
            {seconds} s
            {seconds >= 8
              ? " — a long session is read in full the first time; opening it again is instant."
              : ""}
          </span>
        ) : null}
      </div>
    </Status>
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
            All replays
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
    let stamp: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (!alive) return;
      if (document.visibilityState !== "hidden") {
        const result = await api.replayStamp(id);
        if (alive && result.ok) {
          if (stamp !== undefined && stamp !== result.data.stamp) {
            const fresh = await api.replay(id);
            if (alive && fresh.ok) {
              stamp = result.data.stamp;
              if (fresh.data.endedAt !== endedAt) setNewer(fresh.data);
            }
          } else stamp = result.data.stamp;
        }
      }
      if (alive) timer = setTimeout(() => void check(), 4000);
    };
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
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
  if (loaded.state === "loading") return <Loading what="Opening the replay…" />;
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
          : back
      }
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
  const { loaded, progress } = useSession(id);
  const source = React.useMemo(() => ({ kind: "sessions" as const, id }), [id]);
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>();
  if (loaded.state === "loading")
    return (
      <Status>
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-xl text-text-high">
            {progress.title ?? "Opening session"}
          </h1>
          <p role="status">
            {progress.message}
            {progress.total !== undefined
              ? ` · ${progress.loaded ?? 0} / ${progress.total} steps`
              : "…"}
          </p>
          {progress.total !== undefined && (
            <progress
              value={progress.loaded ?? 0}
              max={Math.max(1, progress.total)}
              aria-label="Session download"
            />
          )}
          {progress.preview && (
            <p className="max-h-64 overflow-auto whitespace-pre-wrap">
              {progress.preview}
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={back}>
            Back to sessions
          </Button>
        </div>
      </Status>
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
      onBack={back}
    />
  );
}

function LibraryRoute({ params }: { params: LibraryParams }) {
  const hash = libraryHash(params);
  React.useEffect(() => {
    lastLibrary = hash;
  }, [hash]);
  return <Library params={params} onParams={setLibrary} />;
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
  if (route.page === "learn") return <CourseLibrary courseKey={route.key} />;
  if (route.page === "replay")
    return <SavedReplay key={route.id} id={route.id} at={route.at} />;
  if (route.page === "session")
    return <LiveSession key={route.id} id={route.id} at={route.at} />;
  return <LibraryRoute params={route.params} />;
}
