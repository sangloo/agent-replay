import {
  parseCurriculum,
  curriculumLessons,
  type StudyContext,
  type Replay,
} from "@agent-replay/core";

import * as React from "react";

import { Button } from "@/ui";

import { api, knownTitle, useLoad, useSession } from "./api";
import { Library } from "./library";
import { CourseLibrary, StandaloneCourseLibrary } from "./course-library";
import {
  learnHash,
  libraryHash,
  parseLibrary,
  type LibraryParams,
} from "./library-params";
import { Player } from "./player/player";
import { PlayerSkeleton } from "./player/skeleton";
import { ProgressVersion, useProgressSync } from "./progress-sync";

type Route =
  /** `project`: a repository's root, as in the library; empty for all. */
  | { page: "learn"; key?: string; project: string }
  | { page: "library"; params: LibraryParams }
  /** `at`: the step to open on — a link to a moment in the replay. */
  | { page: "replay"; id: string; at?: number }
  | { page: "session"; id: string; at?: number };

function parse(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const [, page, id] = path.split("/");
  if (page === "learn")
    return {
      page: "learn",
      key: id,
      project: new URLSearchParams(search).get("project") ?? "",
    };
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

// Choosing another project in Learn, likewise — onto its list of courses.
const setLearnProject = (project: string) => {
  const hash = learnHash(project);
  lastPlace = { hash, label: "Learn" };
  window.history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

/** A saved replay's course is asked for by the folder its id names. */
const loadCourseOf = (id: string) =>
  api.curricula(new URLSearchParams({ key: id.split(":")[0] ?? "" }).toString());

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base p-6 text-sm text-text-mid">
      {children}
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
  const catalog = useLoad(id, loadCourseOf);
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
              // The map it was opened from keeps its project; any other way
              // in, the map alone.
              const map = `#/learn/${study.key}`;
              window.location.hash = lastPlace?.hash.startsWith(map)
                ? lastPlace.hash
                : map;
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
  const { loaded, progress } = useSession(id);
  const source = React.useMemo(() => ({ kind: "sessions" as const, id }), [id]);
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>();
  const fallback = backTo(SESSIONS);
  if (loaded.state === "loading")
    return (
      <PlayerSkeleton
        title={progress.title ?? knownTitle(id)}
        what={progress.message}
        loaded={progress.loaded}
        total={progress.total}
        preview={progress.preview}
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

function LearnRoute({ courseKey, project }: { courseKey?: string; project: string }) {
  React.useEffect(() => {
    lastPlace = {
      hash: learnHash(project, courseKey),
      label: courseKey ? "Course map" : "Learn",
    };
  }, [courseKey, project]);
  return (
    <CourseLibrary
      courseKey={courseKey}
      project={project}
      onProject={setLearnProject}
    />
  );
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
  // Progress the local service kept, from another browser or port, arrives
  // before a replay opens — so it can pick up where the reader was.
  const { ready, version } = useProgressSync();
  if (!ready) return null;
  return (
    <ProgressVersion.Provider value={version}>
      {route.page === "learn" ? (
        <LearnRoute courseKey={route.key} project={route.project} />
      ) : route.page === "replay" ? (
        <SavedReplay key={route.id} id={route.id} at={route.at} />
      ) : route.page === "session" ? (
        <LiveSession key={route.id} id={route.id} at={route.at} />
      ) : (
        <LibraryRoute params={route.params} />
      )}
    </ProgressVersion.Provider>
  );
}
