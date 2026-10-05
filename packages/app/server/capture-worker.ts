/**
 * Isolate transcript parsing and synchronous git work from the HTTP event loop.
 *
 * Two jobs, by `workerData.mode`:
 * - `stream` (the default): NDJSON lines for the player, each acknowledged
 *   before the next so the HTTP response's backpressure reaches the capture;
 *   and, once captured, where the session's repository is — so the service
 *   can answer for its files without capturing it again.
 * - `replay`: the whole capture, posted once — for saving and exporting.
 */
import { parentPort, workerData } from "node:worker_threads";
import { captureSession } from "./capture.ts";
import { findSession } from "./sessions.ts";
import { findSaved, idKey } from "./store.ts";

const emit = (event: unknown) =>
  new Promise<void>((resolve) => {
    parentPort!.once("message", () => resolve());
    parentPort!.postMessage({ line: JSON.stringify(event) + "\n", acknowledge: true });
  });

async function stream() {
  const session = findSession(workerData.id, undefined, { exact: true });
  if (!session) throw new Error("Session not found on this machine.");
  await emit({
    kind: "progress",
    message: "Reading transcript and repository",
    title: session.title,
    bytes: session.bytes,
  });
  const { replay, root, warnings } = captureSession(
    {
      session,
      onProgress: (message) =>
        parentPort!.postMessage({
          line:
            JSON.stringify({ kind: "progress", message, title: session.title }) + "\n",
          acknowledge: false,
        }),
    },
    workerData.repos,
  );
  const { steps, files, ...header } = replay;
  parentPort!.postMessage({ captured: { root, repo: replay.repo } });
  const name = findSaved(root, replay.id);
  await emit({
    kind: "header",
    replay: header,
    total: steps.length,
    fileTotal: Object.keys(files).length,
    repo: replay.repo.name,
    warnings,
    saved: name ? `${idKey(root)}:${name}` : undefined,
  });
  // Each record is bounded by a byte budget, except an indivisible single item.
  const batches = async (kind: string, values: unknown[]) => {
    let batch: unknown[] = [],
      bytes = 0;
    for (const value of values) {
      const size = JSON.stringify(value).length;
      if (batch.length && (bytes + size > 256 * 1024 || batch.length >= 128)) {
        await emit({ kind, items: batch });
        batch = [];
        bytes = 0;
      }
      batch.push(value);
      bytes += size;
    }
    if (batch.length) await emit({ kind, items: batch });
  };
  await batches("files", Object.entries(files));
  await batches("steps", steps);
  await emit({ kind: "done" });
}

function whole() {
  const session = findSession(workerData.id, undefined, { exact: true });
  if (!session) throw new Error(`No session ${workerData.id} on this machine.`);
  const captured = captureSession({ session }, workerData.repos);
  parentPort!.postMessage({ result: captured });
}

try {
  if (workerData.mode === "replay") whole();
  else await stream();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (workerData.mode === "replay") parentPort!.postMessage({ error: message });
  else await emit({ kind: "error", message });
}
