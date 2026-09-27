# @agent-replay/core

An agent session — or a repository's git history — as steps a person can
replay: the replay format, and everything that produces or plays one. Zero
dependencies and browser-pure, so the same code captures a replay in the CLI
and rebuilds it in the player: the two can never disagree about what a step
did.

| Module                   |                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                 | The `Replay` file: steps (`prompt`, `say`, `edit`, `write`, `delete`, `external`, `command`, `commit`, and a course's `lesson` and `explain`), the base content of every touched file, and notes by step id |
| `agents/`                | One adapter per agent log — Claude Code, Codex, Gemini CLI — turning it into neutral actions. `detectAdapter` tells the formats apart from their first lines                                                |
| `capture`                | Events → replay. Tracks every file through the session; inserts _drift_ steps when a tool saw a file the replay did not produce, and _reconciliation_ steps for the end state                               |
| `shell`                  | Files a shell command writes literally (`cat > f <<'EOF'`), replayed as the writes they are                                                                                                                 |
| `cause`                  | Which shell command most likely made an unrecorded change                                                                                                                                                   |
| `evidence`               | What the agent checked and whether it held: runs and results, failures hidden by a pipe, weakened tests, stale runs, unbacked claims                                                                        |
| `play`                   | Replay → every file at every cursor, each step's hunks, line blame, and coverage of the end state                                                                                                           |
| `history`                | Git commits → replay; `order` gives a reading order for many files at once, and a build order (dependencies first) for courses                                                                              |
| `diff`, `apply`, `patch` | Myers line diffs tightened to the characters that changed; what a step does; Codex's `apply_patch` format                                                                                                   |
| `redact`, `notes`        | Secret, email, account-value and home-folder scrubbing for prose; notes merged by step id                                                                                                                   |

Relative imports carry `.ts`: the CLI runs these files directly under Node's
type stripping, with no build step.

```bash
pnpm --filter @agent-replay/core test
```
