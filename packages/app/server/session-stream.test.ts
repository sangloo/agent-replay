// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { sessionStreamer } from "./session-stream.ts";

const workers = vi.hoisted(
  () =>
    [] as {
      emit: (name: string, value?: unknown) => boolean;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      postMessage = vi.fn();
      terminate = vi.fn(async () => 0);
      constructor() {
        super();
        workers.push(this);
      }
    },
  };
});
const responses: EventEmitter[] = [];
function response() {
  const result = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
  });
  responses.push(result);
  return result;
}
afterEach(() => {
  for (const response of responses) response.emit("close");
  responses.length = 0;
  workers.length = 0;
});
it("waits for backpressure, terminates disconnected captures, and releases capacity", () => {
  const stream = sessionStreamer([], { stampOf: () => undefined }),
    first = response(),
    second = response(),
    third = response();
  stream("one", first as unknown as ServerResponse);
  stream("two", second as unknown as ServerResponse);
  stream("three", third as unknown as ServerResponse);
  expect(third.statusCode).toBe(503);
  first.write.mockReturnValue(false);
  workers[0]!.emit("message", { line: '{"kind":"steps"}\n', acknowledge: true });
  expect(workers[0]!.postMessage).not.toHaveBeenCalled();
  first.emit("drain");
  expect(workers[0]!.postMessage).toHaveBeenCalledWith("next");
  first.emit("close");
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  const next = response();
  stream("three", next as unknown as ServerResponse);
  expect(next.statusCode).toBe(200);
  expect(workers).toHaveLength(3);
});
it("reports worker failures in the stream and cleans up", () => {
  const stream = sessionStreamer([], { stampOf: () => undefined }),
    res = response();
  stream("one", res as unknown as ServerResponse);
  workers[0]!.emit("error", new Error("capture failed"));
  expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"kind":"error"'));
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it("tells where a captured session's repository is, without sending it to the page", () => {
  const onCaptured = vi.fn();
  const stream = sessionStreamer([], { onCaptured, stampOf: () => undefined }),
    res = response();
  stream("one", res as unknown as ServerResponse);
  const place = { root: "/work/repo", repo: { name: "repo", commits: [] } };
  workers[0]!.emit("message", { captured: place });
  expect(onCaptured).toHaveBeenCalledWith("one", place);
  expect(res.write).not.toHaveBeenCalledWith(expect.stringContaining("/work/repo"));
});

it("sends an unchanged session again from what it kept, and captures a changed one", () => {
  let stamp = "first";
  const stream = sessionStreamer([], { stampOf: () => stamp }),
    lines = [
      '{"kind":"header"}\n',
      '{"kind":"steps","items":[]}\n',
      '{"kind":"done"}\n',
    ];
  const first = response();
  stream("one", first as unknown as ServerResponse);
  for (const line of lines) workers[0]!.emit("message", { line, acknowledge: true });
  workers[0]!.emit("exit", 0);
  expect(first.end).toHaveBeenCalled();

  const again = response();
  stream("one", again as unknown as ServerResponse);
  expect(workers).toHaveLength(1);
  for (const line of lines) expect(again.write).toHaveBeenCalledWith(line);
  expect(again.end).toHaveBeenCalled();

  stamp = "second";
  stream("one", response() as unknown as ServerResponse);
  expect(workers).toHaveLength(2);
});

it("keeps nothing of a capture that failed, and forgets a session on request", () => {
  const stream = sessionStreamer([], { stampOf: () => "same" });
  stream("one", response() as unknown as ServerResponse);
  workers[0]!.emit("message", {
    line: '{"kind":"error","message":"no"}\n',
    acknowledge: true,
  });
  workers[0]!.emit("exit", 0);
  stream("one", response() as unknown as ServerResponse);
  expect(workers).toHaveLength(2);
  workers[1]!.emit("message", { line: '{"kind":"done"}\n', acknowledge: true });
  workers[1]!.emit("exit", 0);
  stream.forget("one");
  stream("one", response() as unknown as ServerResponse);
  expect(workers).toHaveLength(3);
});

it("captures a whole session in the worker, for saving and exporting", async () => {
  const onCaptured = vi.fn();
  const stream = sessionStreamer([], { onCaptured, stampOf: () => undefined });
  const result = stream.capture("one");
  const replay = { repo: { name: "repo", commits: [] } };
  workers[0]!.emit("message", { result: { replay, root: "/work/repo", warnings: [] } });
  await expect(result).resolves.toMatchObject({ root: "/work/repo" });
  expect(onCaptured).toHaveBeenCalledWith("one", {
    root: "/work/repo",
    repo: replay.repo,
  });
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  const failing = stream.capture("two");
  workers[1]!.emit("message", { error: "No session two on this machine." });
  await expect(failing).rejects.toThrow("No session two");
});
