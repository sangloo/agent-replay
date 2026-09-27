---
name: replay-history
description: Replay a repository's git history change by change — a range of commits, or a codebase introduced file by file in reading order — and add notes that explain each commit. Use when someone wants to understand how code evolved, review a range of commits, or catch up on what changed since a release.
---

# Replay and explain history

The command is `replay …` when installed, or `npx -y agentreplay …`.

```bash
replay history                                    # the last 300 commits (or all) → HEAD
replay history --from v1.2 --to main              # a range
replay history --path packages/api --from HEAD~50 # one part of a monorepo
replay history --learn --from <rev>               # the files at <rev> first, in reading
                                                  # order, then every commit after it
```

It writes `.replays/<file>.json` and prints its summary. Each commit is a
step with its message and author; each file it changed follows, typed in
like any edit. The player's footer shows how much of today's code exists at
each point.

## Explain it

With an Anthropic API key, a small model writes a note per commit and a tour
wherever many files arrive at once:

```bash
replay explain .replays/<file>.json      # needs ANTHROPIC_API_KEY or `ant auth login`
```

Without one, write the notes yourself. List the steps (`replay steps
<file>`); the ids are `commit:<sha>` for commits and `<sha>:<path>` for a
file within one. For each commit, one or two sentences: what changed and
why, in terms of behaviour, not files. On a step where many files arrive,
a tour: which files to read first and which functions carry the weight.
Then `replay annotate <file> notes.json` (see the `replay` skill for the
format).

## History or a course?

History replays what **happened**, commit by commit — right for review and
for "what changed since …". To **learn** a codebase as it is now, without
its detours, write a course instead (the `replay-teach` skill): it rebuilds
the current code from nothing in teaching order. The two join up: a course
ends at a revision, and `replay history --from <that revision>` carries on
from there.
