# Agent Replay

**Watch what a coding agent did, the way it did it.** Play a Claude Code, Codex
or Gemini CLI session back change by change — files appearing, edits typing
themselves in, commands and their results — with the agent's own words above
each step, from the commit it started on to the state it left.

A diff tells you where the code ended up. A replay tells you how it got there:
which change came first, what the agent believed when it made it, what it ran
to check, and whether those checks actually held.

```bash
npx agentreplay
```

That opens the player on the sessions already on your machine. Nothing to
record and nothing to configure: it reads the logs your agents already write.

---

## What you get

- **Playback you can follow.** A change is marked, the view travels to it, and
  its new lines type in beneath the old ones with a caret, at a readable pace.
  Pause mid-change, step with `→`, scrub anywhere, change speed at any moment.
  Removed lines stay red and added lines green once they land, so a paused
  replay still reads as a diff.
- **A caption for every step.** Above the code, always: the prompt being
  answered, the command being run, or why this change is being made — in the
  agent's own words.
- **Evidence, not claims.** The Evidence tab reads the session for what was
  actually checked. It shows which tests, type checks, lint runs and builds
  ran and whether they passed, and which failures were hidden by a pipe
  (`| tail`, `|| true`). It flags files changed after the last passing
  check, tests that lost assertions or gained a `.skip`, and "all tests
  pass" claims no run backs up. `replay check` prints the same in the
  terminal and exits 1 when something needs a look.
- **One file to share.** `replay export` (or **Export** in the player) writes
  a single HTML file that plays the replay anywhere, offline. Attach it to a
  pull request, drop it in a chat, archive it.
- **Every file, in context.** The files panel is an explorer: the changes, or
  the whole repository at the base commit, each changed file marked `A`, `M`
  or `D` and every folder above it marked too. Hover a line to see which step
  wrote it; click to go there.
- **Honest about what it cannot see.** Changes no tool call recorded — a
  formatter, `sed`, a codegen step — still show up, as _outside changes_,
  placed after the command that most likely made them. Files an agent writes
  with a heredoc (`cat > file <<'EOF'`) replay as the writes they are. The
  replay's end state is always the repository's end state.
- **Git history too.** `replay history` plays a repository commit by commit,
  and `--learn` introduces an existing codebase file by file, in reading
  order.

## Install

Needs **Node 20+** and **git**.

```bash
npx agentreplay                 # try it — the player at http://localhost:5180

npm install -g agentreplay      # or keep the `replay` command
replay                          # the player
replay setup                    # capture automatically after every agent turn
```

**Claude Code plugin** — the replay skill and the capture-after-every-turn hook
in one step:

```bash
claude plugin marketplace add sangloo/agent-replay
claude plugin install replay@agent-replay
```

## Everyday use

### Review an agent's work

Run `replay`, pick the project at the top (every repository an agent worked in
is already there; **Open folder…** adds any other), open a session and press
`Space`. Or walk it with `→`, one change at a time.

| Key          |                                                      |
| ------------ | ---------------------------------------------------- |
| `Space`      | play / pause — mid-change too                        |
| `→` `←`      | next step (or finish the one typing) / previous step |
| `Home` `End` | the base commit / the end                            |
| `N` `P`      | next / previous note                                 |
| `V`          | the code view: change → since base → file            |
| `E`          | steps or evidence                                    |
| `[` `]`      | show / hide the files / the side panel               |
| `/`          | filter the files                                     |
| `?`          | every shortcut                                       |

Three views of a file (`V`): **Change** — the change on screen, as a diff;
**Since base** — everything that changed in it, the pull-request view;
**File** — the file as it reads, the change being made marked in place. Every
view keeps playing: a change is always seen being made.

The address carries the step (`#/session/<id>?at=42`), so a link opens on a
moment.

### Save a replay with the code

```bash
git commit …                                    # commit the work first
replay capture --title "Add billing retries"   # → .replays/<date>-<title>-<id>.json
replay steps .replays/<file>.json               # step ids, for notes
replay annotate .replays/<file>.json notes.json
git add .replays && git commit -m "Replay: Add billing retries"
```

`notes.json` maps step ids to a `risk`, `review` or `info` note:

```json
{
  "toolu_01AbC…": { "level": "risk", "text": "Retries now apply to every client." },
  "toolu_01DeF…": { "level": "review", "text": "A queue, not a lock: see worker.ts." }
}
```

The `replay` skill (in the plugin, or [`plugin/skills/replay`](plugin/skills/replay/SKILL.md))
teaches an agent to do this itself at the end of a session. Capturing again
replaces the file and keeps its notes.

### Share it

```bash
replay export .replays/<file>.json            # → <title>.html beside it
replay export --session <id> -o review.html   # straight from a session
replay check .replays/<file>.json             # the evidence, in the terminal
```

### Capture automatically

`replay setup` adds a Stop hook to Claude Code's settings and prints the lines
for the others. The hook hands the capture to a background process and returns
at once; it never fails the agent's turn.

| Agent           | Logs                                                | Hook                                                |
| --------------- | --------------------------------------------------- | --------------------------------------------------- |
| **Claude Code** | `~/.claude/projects/<project>/<session>.jsonl`      | `replay setup` (`--project` for this repo only)     |
| **Codex**       | `~/.codex/sessions/YYYY/MM/DD/rollout-…jsonl[.zst]` | `notify` in `~/.codex/config.toml` (printed)        |
| **Gemini CLI**  | `~/.gemini/tmp/<project>/chats/session-…jsonl`      | `AfterAgent` in `~/.gemini/settings.json` (printed) |

### Learn a codebase from its history

```bash
replay history                                    # the last 300 commits → HEAD
replay history --from v1.2 --to main              # a range
replay history --path packages/api --learn --from HEAD~50
replay explain .replays/<file>.json               # a small model's notes (needs ANTHROPIC_API_KEY)
```

## Commands

| Command                                      |                                                                |
| -------------------------------------------- | -------------------------------------------------------------- |
| `replay [open] [--port 5180] [--no-browser]` | The player and its local API                                   |
| `replay list`                                | Agent sessions on this machine, newest first                   |
| `replay capture [--session] [--title] …`     | Save a session to `<repo>/.replays/`                           |
| `replay export [<file>] [--session] [-o]`    | One self-contained HTML file                                   |
| `replay check [<file>] [--session]`          | What was checked and whether it held; exit 1 when worth a look |
| `replay history [--from] [--to] [--learn]`   | Replay git history                                             |
| `replay explain <file> [--model]`            | A small model's notes per commit or turn                       |
| `replay steps <file>`                        | Step ids, for notes                                            |
| `replay annotate <file> <notes.json \| ->`   | Merge notes by step id                                         |
| `replay setup [--project]`                   | Install the Claude Code hook; print Codex and Gemini lines     |

`replay <command> --help` prints the usage; `REPLAY_DEBUG=1` shows a stack on
any failure.

## Privacy

- Everything runs on your machine. The player listens on **localhost only**
  and answers only to local host names; it serves every agent session on the
  machine, so do not expose the port.
- Prompts, narration and command output are scrubbed of common secret
  patterns (API keys, tokens, private keys, bearer headers), email addresses,
  account ids and home-folder user names. **File contents are not** — they are
  the code under review.
- Lockfiles, ignored files (`.env.local` and the like), binaries and files
  over 512 KiB are recorded as changed, never stored.
- Redaction is a net, not a guarantee: skim a replay before sharing it
  outside the repository.

The tool writes nothing but the replays you save (into a repository's
`.replays/`), the files you export, and the folders you add
(`~/.config/replay/projects.json`).

## How it works

```
agent log (Claude Code · Codex · Gemini) ─┐
      → adapter → neutral actions         ├─ capture ─→ .replays/<…>.json ─→ player
git: HEAD at session start, end state ────┘   (core)                         (app)
```

An adapter per agent turns its log into neutral actions — edit, write, delete,
patch, command — and nothing downstream knows which agent it was. The **base**
is where HEAD pointed when the session started (from the reflog); the **end**
is the working tree at capture. Whatever the recorded calls do not explain is
found by comparing each file a tool saw with the state the replay built
(_drift_), and every changed file with the real end state (_reconciliation_).

|                                  |                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core) | The replay format and all the logic: adapters, capture, playback, diff, evidence, redaction. Zero dependencies, runs in Node and the browser |
| [`packages/app`](packages/app)   | The `replay` CLI, its local service, and the player (React)                                                                                  |
| [`plugin`](plugin)               | The Claude Code plugin: the `replay` skill and the capture hook                                                                              |

## Development

```bash
pnpm install
pnpm dev             # the player with hot reload → http://localhost:5180
pnpm replay <cmd>    # the CLI from source (Node 22.18+)
pnpm verify          # format, lint, typecheck, test, build — what CI runs
pnpm package         # the npm package → packages/app/.package/
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Adding an agent is one adapter file in
`packages/core/src/agents/` plus a log locator in `packages/app/server/sessions.ts`.

## Limits

- Cursor, Aider, OpenCode and Amp are not supported yet. Codex subagent
  threads are not merged into their parent.
- Changes made through shell commands other than a literal heredoc (`sed -i`,
  scripts, formatters) appear as one outside change per file, placed after
  the command that most likely made them — not typed in edit by edit.
- A dirty tree at session start shows up as outside changes on first touch.
- The evidence ledger recognises checks by their commands and output. It errs
  towards asking you to look, and cannot know what a custom script checks.

## License

[MIT](LICENSE)
