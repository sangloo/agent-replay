import type { Frame, Step } from "@agent-replay/core";

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut + 1);
}

export function firstLine(text: string, max = 60): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a step is, in a few words — the scrubber's card and the panel's title. */
export function stepLabel(frame: Frame): string {
  const { step, change } = frame;
  switch (step.kind) {
    case "prompt":
      return step.agent === "main" ? "Prompt" : "Task for a subagent";
    case "say":
      return "Agent's reply";
    case "command":
      return `$ ${firstLine(step.command, 48)}`;
    case "edit":
      return `Edit ${fileName(step.path)}`;
    case "write":
      return `${change?.before === null ? "Create" : "Rewrite"} ${fileName(step.path)}`;
    case "delete":
      return `Delete ${fileName(step.path)}`;
    case "commit":
      return firstLine(step.subject, 60);
    case "external":
      return `${step.content === null ? "Delete" : change?.before === null ? "Create" : "Change"} ${fileName(step.path)}`;
  }
}

export function kindName(step: Step): string {
  switch (step.kind) {
    case "prompt":
      return "Prompt";
    case "say":
      return "Reply";
    case "command":
      return "Command";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "delete":
      return "Delete";
    case "commit":
      return "Commit";
    case "external":
      return "Change by a command";
  }
}

/** When a step happened: a date for git history, `+12:03` into a session. */
export function when(
  at: string,
  replay: { source: string; startedAt: string },
): string {
  if (replay.source === "git") {
    const date = new Date(at);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  }
  return offset(at, replay.startedAt);
}

/** `+12:03` from the session's start. */
export function offset(at: string, start: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(at) - Date.parse(start)) / 1000));
  if (Number.isNaN(seconds)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`;
}

export function ago(iso: string | undefined): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 36) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** A log's size, which is roughly how long the session ran. */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The heading a date files under in a list: today, yesterday, this week… */
export function dayGroup(iso: string | undefined, now = new Date()): string {
  if (!iso) return "Undated";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Undated";
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The last folder of a path: the project a session ran in. */
export function project(cwd: string | undefined): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
