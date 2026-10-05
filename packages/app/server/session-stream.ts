import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { Worker } from "node:worker_threads";

/** Bounded capture concurrency; closing the page terminates its worker. */
export function sessionStreamer(repos: readonly string[]) {
  let active = 0;
  return (id: string, response: ServerResponse) => {
    if (active >= 2) {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          detail: "Two sessions are already loading. Retry when one finishes.",
        }),
      );
      return;
    }
    const bundled = new URL("./capture-worker.mjs", import.meta.url);
    const source = new URL("./capture-worker.ts", import.meta.url);
    const worker = new Worker(existsSync(bundled) ? bundled : source, {
      workerData: { id, repos },
    });
    active++;
    response.setHeader("Content-Type", "application/x-ndjson");
    response.setHeader("Cache-Control", "no-store");
    response.flushHeaders();
    response.write(
      JSON.stringify({ kind: "progress", message: "Locating session" }) + "\n",
    );
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      active--;
      clearTimeout(timer);
      void worker.terminate();
    };
    const fail = (message: string) => {
      if (finished) return;
      response.end(JSON.stringify({ kind: "error", message }) + "\n");
      finish();
    };
    const timer = setTimeout(
      () =>
        fail(
          "Session capture exceeded three minutes. Try saving the replay through the CLI.",
        ),
      180_000,
    );
    response.on("close", finish);
    worker.on(
      "message",
      ({ line, acknowledge }: { line: string; acknowledge: boolean }) => {
        if (finished) return;
        const writable = response.write(line);
        if (!acknowledge) return;
        if (writable) worker.postMessage("next");
        else
          response.once("drain", () => {
            if (!finished) worker.postMessage("next");
          });
      },
    );
    worker.on("error", (error) =>
      fail(error instanceof Error ? error.message : String(error)),
    );
    worker.on("exit", (code) => {
      if (finished) return;
      if (code !== 0) fail(`Session capture exited (${code}).`);
      else {
        response.end();
        finish();
      }
    });
  };
}
