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
  const stream = sessionStreamer([]),
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
  const stream = sessionStreamer([]),
    res = response();
  stream("one", res as unknown as ServerResponse);
  workers[0]!.emit("error", new Error("capture failed"));
  expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"kind":"error"'));
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});
