# Agent Replay

**Watch what a coding agent did, the way it did it.** Play a Claude Code, Codex
or Gemini CLI session back change by change — files appearing, edits typing
themselves in, commands and their results — with the agent's own words above
each step, from the commit it started on to the state it left.

A diff tells you where the code ended up. A replay tells you how it got there:
which change came first, what the agent believed when it made it, what it ran
to check, and whether those checks actually held.

```bash
npx agent-replay-studio@latest
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
- **Courses: learn a repository from zero.** A model rebuilds the repository
  from an empty folder to its current state as lessons — the real code
  arriving a piece at a time, with explanations of the design, the functions
  and the mathematics beside it. Built for codebases written largely by AI,
  where replaying every commit is not the point: what matters is the code as
  it is now.
- **Git history too.** `replay history` plays a repository commit by commit,
  and `--learn` introduces an existing codebase file by file, in reading
  order.

## Install

Needs **Node 20+** and **git**.

```bash
npx agent-replay-studio@latest          # try it — the player at http://localhost:5180

npm install -g agent-replay-studio # or keep the `replay` command
replay                          # the player
replay setup                    # capture automatically after every agent turn
```

**Claude Code plugin** — the four skills and the capture-after-every-turn hook
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
| `⇧→` `⇧←`    | next / previous prompt (in a course: lesson)         |
| `Home` `End` | the base commit / the end                            |
| `N` `P`      | next / previous note                                 |
| `V`          | the code view: change → since base → file            |
| `E`          | steps or evidence (in a course: lesson or steps)     |
| `[` `]`      | show / hide the files / the side panel               |
| `/`          | filter the files                                     |
| `?`          | every shortcut                                       |

Three views of a file (`V`): **Change** — the change on screen, as a diff;
**Since base** — everything that changed in it, the pull-request view;
**File** — the file as it reads, the change being made marked in place. Every
view keeps playing: a change is always seen being made.

The address carries the step (`#/session/<id>?at=42`), so a link opens on a
moment. Without one, a replay reopens where you left it, and the lists show
how far along each one is.

The steps panel shows one turn at a time: the prompt on screen and its
changes, every other turn as a single line saying what it asked and how much
it changed. **Changes** (the default), **Everything** or **Notes** choose what
the list and the timeline show.

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

### Learn a repository: courses

Ask your agent to teach you the repository — with the plugin installed, or
after `replay skills install`, it knows how:

> Teach me this repository. Build it up from scratch as a course.

It follows the `replay-teach` skill: reads the code, plans lessons from the
foundations up, then writes the course with `replay course` commands. Every
piece of code comes from the repository itself (`take` a file, or chosen
lines of it), so what you watch being built is exactly the code that exists.
Beside it, the **Lesson** panel shows the explanations as they are written —
Markdown, tables and maths (`$…$`, `$$…$$`) — and lights up the lines each one
is about. Examples and exercises live in `learn/` and are marked as teaching
material. The footer shows how much of the repository the course has built.

```bash
replay course start --title "Learn vec" [--path packages/core] [--to v2.0]
replay course lesson "Vectors are plain data" --goal "Know what a Vec is."
replay course explain - <<'MD'                   # Markdown with $maths$, on stdin
replay course take src/vec.ts --lines 1-12       # the next piece of a real file
replay course explain --file src/vec.ts --lines 10-12 "The dot product …"
replay course example learn/try.ts < try.ts      # teaching material
replay course fill "*.json" .github/             # boilerplate, in one go
replay course status                             # progress, and what is next
replay course check                              # exit 0 when it matches the repository
```

A course is an ordinary replay in `.replays/`: open it in the player at any
moment while it is being written, export it, commit it. When it ends,
`replay history --from <its revision>` carries on commit by commit.

### Learn a codebase from its history

```bash
replay history                                    # the last 300 commits → HEAD
replay history --from v1.2 --to main              # a range
replay history --path packages/api --learn --from HEAD~50
replay explain .replays/<file>.json               # a small model's notes (needs ANTHROPIC_API_KEY)
```

## Skills

Four skills teach a model to use the tools — for Claude Code they come with
the plugin, and `replay skills install` copies them into `.claude/skills/`.
For any other agent, `replay skills <name>` prints one to hand over.

| Skill            | For                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `replay`         | Capturing a session at its end, with notes on the steps that need a careful look         |
| `replay-review`  | Reviewing an agent's session: the evidence, the risky steps, a file for the pull request |
| `replay-teach`   | Teaching a repository by rebuilding it from nothing as a course                          |
| `replay-history` | Replaying and explaining a repository's commits                                          |

## Commands

| Command                                      |                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `replay [open] [--port 5180] [--no-browser]` | The player and its local API                                                                  |
| `replay list`                                | Agent sessions on this machine, newest first                                                  |
| `replay capture [--session] [--title] …`     | Save a session to `<repo>/.replays/`                                                          |
| `replay export [<file>] [--session] [-o]`    | One self-contained HTML file                                                                  |
| `replay check [<file>] [--session]`          | What was checked and whether it held; exit 1 when worth a look                                |
| `replay course <command>`                    | Write a course: `start`, `lesson`, `explain`, `take`, `example`, `fill`, `status`, `check`, … |
| `replay skills [<name> \| install]`          | The skills that teach a model these tools: print one, or install them all                     |
| `replay history [--from] [--to] [--learn]`   | Replay git history                                                                            |
| `replay explain <file> [--model]`            | A small model's notes per commit or turn                                                      |
| `replay steps <file>`                        | Step ids, for notes                                                                           |
| `replay annotate <file> <notes.json \| ->`   | Merge notes by step id                                                                        |
| `replay setup [--project]`                   | Install the Claude Code hook; print Codex and Gemini lines                                    |

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
`.replays/`), the files you export, the folders you add
(`~/.config/replay/projects.json`), and where you are in each replay
(`~/.config/replay/progress.json`: replay and lesson ids and step numbers, no
content).

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

### Local teaching extensions

Explanations accept tables, fenced code, math, typed callouts such as
`> [!CHECKPOINT] Predict the outcome`, and collapsible blocks:

```text
:::details Worked example
The explanation appears here.
:::
```

A function label can link to exact pinned source:
`[Validate](source:internal/audit/audit.go#L92-L106)`.
The player previews up to twelve lines and opens a recorded snapshot containing
that whole span. **Return to explanation** restores the starting position.
Original and replay line numbers are shown separately. Omitted spans are disabled;
there is no hidden repository fetch or symbol-name guessing. New `course take`
steps store exact original ranges and source-file hashes. Older courses remain
readable; references without this optional mapping stay unavailable.

Callouts and details use structured Markdown, never executable HTML. Session
progress measures playback. The source counter measures included lines in this
course's selected target files, not coverage of an entire repository.

`replay course take path/to/file --included --why "Repetitive implementation"`
imports the exact full source file for completeness. It is labeled in the player
and arrives without a typing animation. Explain substantive excerpts first, then
include the rest; the source counter preserves those earlier explained lines and
counts only the remaining lines as included. Neither counter measures conceptual
completion. Partial files cannot be labeled as full-file imports.
For an indivisible large migration, `course start --max-file-bytes 1048576`
explicitly raises the course limit from 512 KiB to 1 MiB. This persisted setting is
bounded at 2 MiB; binary and lockfile exclusions still apply.

### Connected lessons

A course can carry an optional `.replays/curriculum.manifest` alongside its saved
replays. The **Learn** tab then shows its map: the ordered chapters,
prerequisites, a suggested next lesson, and each lesson done, in progress or not
started. A lesson is done once you reach its end; **Mark as done** sets it by hand
either way. Progress is isolated by curriculum ID and revision, and kept both in
the browser and by `replay` itself (see Privacy), so another browser or port picks
up where you were; an exported file keeps it in the browser that opens it. Existing replays need no migration.

```json
{
  "version": 1,
  "id": "example-course",
  "revision": "edition-1",
  "title": "Understand the application",
  "description": "Follow one request from input to persistence.",
  "libraryFile": "index.html",
  "chapters": [
    {
      "id": "foundation",
      "title": "Start with the boundary",
      "description": "Read the input contract before the implementation.",
      "lessons": [
        {
          "id": "01",
          "title": "A request enters",
          "goal": "Find the request boundary.",
          "replay": "saved-course-basename",
          "prerequisites": [],
          "exportFile": "session-01.html"
        }
      ]
    }
  ]
}
```

Replay names are basenames without `.json`. Prerequisites must name earlier lessons.
Use `referenceOnly: true` for a reference collection. Missing saved replays remain
visible as unavailable; invalid maps are reported without breaking the replay list.
`libraryFile` and each `exportFile` are distinct HTML basenames.

```sh
replay export .replays/saved-course-basename.json --curriculum .replays/curriculum.manifest -o session-01.html
replay export --library --curriculum .replays/curriculum.manifest -o index.html
```

Keep companion exports together for chapter and next/previous links. A library in a
parent folder can use `--export-base lessons/`; also place a library beside the
lessons if they name `index.html` as their return link. Each file contains its player,
fonts and data for offline use. Browser storage policies can limit persistence when
opening files directly; a local server gives the files one consistent origin.

Course reading starts with the explanation panel. On narrow screens, **Read lesson**
and **Inspect source** switch between reading and code. Full-file imports marked
**Included for completeness** collapse in the reading flow, while the exact source
remains inspectable. Source references open a focused preview and return to the
explanation without replacing the saved study position.

## Automatic npm releases

Every push to `main` runs verification. If the version in
`packages/app/publish.json` is not on npm, `.github/workflows/release.yml`
builds and publishes it. Already-published versions are skipped; bump that
manifest before pushing a new release. npm versions cannot be overwritten.
Manual retries use the Release workflow's **Run workflow** button on `main`.

One-time setup: in npm's `agent-replay-studio` package settings, add a
**Trusted Publisher → GitHub Actions** with user **sangloo**, repository
**agent-replay**, and workflow filename **release.yml**. Leave environment
blank and allow direct publishing if that option is shown. No `NPM_TOKEN`
or other repository secret is needed. The workflow uses GitHub OIDC and
publishes provenance after verification succeeds.

See https://docs.npmjs.com/trusted-publishers/ for the npm setup.
