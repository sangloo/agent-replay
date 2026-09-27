import type { Replay } from "@agent-replay/core";
import * as React from "react";

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

function SavedReplay({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.replay);
  const source = React.useMemo(() => ({ kind: "replays" as const, id }), [id]);
  if (loaded.state === "loading") return <Status>Loading the replay…</Status>;
  if (loaded.state === "failed") return <Status>{loaded.message}</Status>;
  return <Player replay={loaded.data} source={source} at={at} onBack={back} />;
}

function LiveSession({ id, at }: { id: string; at?: number }) {
  const loaded = useLoad(id, api.session);
  const source = React.useMemo(() => ({ kind: "sessions" as const, id }), [id]);
  const [saving, setSaving] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>();
  if (loaded.state === "loading")
    return <Status>Reading the session and the repository…</Status>;
  if (loaded.state === "failed") return <Status>{loaded.message}</Status>;
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
