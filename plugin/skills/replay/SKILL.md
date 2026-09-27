---
name: replay
description: Save this agent session as a replay a reviewer can play back change by change, with notes on the parts that need a careful look and a check of the evidence. Use at the end of any session that changed code — before or instead of a PR — or when the user asks to "capture", "save", "record" or "replay" the session. Works for Claude Code, Codex and Gemini CLI sessions alike.
---

# Replay

A replay is this session's work as a stream: every edit, write, patch and
command in order, with what you said before each one, from the commit you
started on to the state you leave. It is rebuilt from the log your agent
already writes (Claude Code, Codex and Gemini CLI are supported) — nothing
needs to have been recorded during the session. Reviewers open it with
`replay` (or `npx -y agentreplay`): http://localhost:5180.

The command is `replay …` when installed (`npm install -g agentreplay`), or
`npx -y agentreplay …` without installing — use whichever works here.

## 1. Commit first, then capture

Capture after your last code commit, so the replay ends on a commit and not a
dirty tree. This plugin's hook already captures after every turn — capturing again just refreshes it with a title:

```bash
replay capture --title "<what this session did, in a few words>"
```

It finds this session by the agent's own id (`CLAUDE_CODE_SESSION_ID`,
`CODEX_SESSION_ID`, `GEMINI_SESSION_ID`) and writes
`.replays/<date>-<title>-<session>.json`. For a session in another repository,
pass `--repo <path>`: the tool replays any git repository.

Read the summary it prints. A `!` line is a limit on how faithful the replay
is (no git, unknown base); say so to the person rather than dropping it.

## 2. Annotate what deserves a careful look

You still have the whole context; the reviewer does not. List the steps:

```bash
replay steps .replays/<file>.json
```

Write notes for the steps that matter — not every step. A note is for what the
diff cannot say by itself:

- **risk** — could break something: a migration, auth, concurrency, a changed
  contract, a deleted safety check, anything you are not sure of.
- **review** — a decision a reviewer should agree with: a trade-off, a
  non-obvious approach, something done differently from the rest of the code.
- **info** — context that saves the reviewer a question: why a file was
  rewritten, why a test changed, what a large generated change is.

Honest over flattering: if a step was a mistake later corrected, say so on the
mistake. If something was not tested, say that on the step that needs it.

```bash
cat > /tmp/notes.json <<'JSON'
{
  "<step id>": { "level": "risk", "text": "Changes the retry window from 30s to 5m for every client, not just billing." },
  "<step id>": { "level": "review", "text": "Chose a scored heuristic over asking the shell for its cwd; see cause.ts." }
}
JSON
replay annotate .replays/<file>.json /tmp/notes.json
```

Ids are the ones `steps` printed. Annotating twice merges; re-capturing keeps
the notes.

## 3. Check the evidence

```bash
replay check .replays/<file>.json
```

It lists which checks ran and whether they held: failures hidden by a pipe,
files changed after the last passing run, tests that lost assertions, and
claims of passing tests no run backs. If it exits 1, fix what it found or say
so in a note — do not tell the person the work is verified when it says
otherwise.

## 4. Commit the replay

```bash
git add .replays/<file>.json && git commit -m "Replay: <title>"
```

Then tell the person where it is and how to open it. To hand it to someone
without the repository, `replay export .replays/<file>.json` writes one HTML
file that plays offline.

## Related skills

- **replay-review** — review a captured session: the evidence, the risky
  steps, notes, and a file to attach to the pull request.
- **replay-teach** — teach a repository by rebuilding it from nothing as a
  course.
- **replay-history** — replay and explain a repository's commits.

## What it can and cannot show

- Edits and writes replay exactly. Claude Code and Gemini CLI record the file
  each edit found, so anything that changed it in between is caught at once;
  Codex patches are applied to the tracked state and checked at the end.
- A file written with a literal heredoc (`cat > file <<'EOF'`) replays as the
  write it is. Other shell changes (`sed -i`, scripts, formatters, codegen,
  `rm`) appear as **outside changes** at the moment they became visible, with
  the command that most likely made them. Prefer your edit tools for code you
  want reviewed as it was written.
- Prompts, narration and command output are scrubbed of common secret
  patterns, email addresses and account ids. File contents are not: they are
  the code under review. Lockfiles are recorded as changed, never stored.
