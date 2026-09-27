import type { Replay } from "@agent-replay/core";
import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/ui";

import { api, useLoad } from "./api";
import { Library } from "./library";
import { libraryHash, parseLibrary, type LibraryParams } from "./library-params";
import { Player } from "./player/player";

type Route =
  | { page: "library"; params: LibraryParams }
  /** `at`: the step to open on — a link to a moment in the replay. */
  | { page: "replay"; id: string; at?: number }
  | { page: "session"; id: string; at?: number };

function parse(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const [, page, id] = path.split("/");
  if ((page === "replay" || page === "session") && id) {
    const at = Number(new URLSearchParams(search).get("at"));
    return {
      page,
      id: decodeURIComponent(id),
      ...(Number.isInteger(at) && at > 0 ? { at } : {}),
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

function SavedReplay({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.replay);
  const source = React.useMemo(() => ({ kind: "replays" as const, id }), [id]);
  if (loaded.state === "loading") return <Loading what="Opening the replay…" />;
  if (loaded.state === "failed") return <Failed message={loaded.message} />;
  return <Player replay={loaded.data} source={source} at={at} onBack={back} />;
}

function LiveSession({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.session);
  const source = React.useMemo(() => ({ kind: "sessions" as const, id }), [id]);
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>();
  if (loaded.state === "loading")
    return <Loading what="Reading the session and the repository…" />;
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
  const [at] = React.useState(() => {
    const value = Number(
      new URLSearchParams(window.location.hash.split("?")[1]).get("at"),
    );
    return Number.isInteger(value) && value > 0 ? value : undefined;
  });
  return <Player replay={replay} at={at} />;
}

const standalone = embedded();

export function App() {
  if (standalone) return <Standalone replay={standalone} />;
  return <Routed />;
}

function Routed() {
  const route = useRoute();
  if (route.page === "replay")
    return <SavedReplay key={route.id} id={route.id} at={route.at} />;
  if (route.page === "session")
    return <LiveSession key={route.id} id={route.id} at={route.at} />;
  return <LibraryRoute params={route.params} />;
}
