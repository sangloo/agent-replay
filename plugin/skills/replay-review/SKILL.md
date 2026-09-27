---
name: replay-review
description: Review what a coding agent did in a session — replay it, check the evidence (which tests and checks ran, whether they held, what changed after them), flag the risky steps with notes, and hand the reviewer one file to open. Use when asked to review an agent's work, a session, a branch an agent wrote, or "what did it actually do".
---

# Review an agent session

A diff shows where the code ended up; a replay shows how it got there. Your
job is to read the session the way a careful reviewer would, and leave notes
where a human should look.

The command is `replay …` when installed, or `npx -y agentreplay …`.

## 1. Get the replay

```bash
replay list                                   # sessions on this machine
replay capture --session <id> --repo <dir>    # → .replays/<file>.json
```

Or use a replay someone already saved in `.replays/`.

## 2. Check the evidence first

```bash
replay check .replays/<file>.json
```

It reads the session for what was actually verified:

- which tests, type checks, lint runs and builds ran, and their last result;
- failures that never passed afterwards — including ones hidden by a pipe
  (`| tail`, `| grep`, `|| true`) that made a failing run exit 0;
- files changed **after** the last passing check (untested edits);
- tests that lost assertions, were skipped, emptied or deleted;
- claims in the agent's own words ("all tests pass") that no passing run
  after the last change backs up.

Exit status 1 means something needs a look. Treat each line as a lead, not a
verdict: open the step and decide.

## 3. Walk the session

```bash
replay steps .replays/<file>.json     # every change and failed command, with ids
```

Read the changes in order with their `why` (the agent's own reasoning at the
time). Look for:

- **risk** — migrations, auth, permissions, concurrency, error handling
  removed, a changed public contract, a deleted safety check, anything done
  by a shell command rather than an edit (shown as "by a shell command").
- **review** — a decision a human should agree with: a trade-off, a
  surprising approach, a deviation from the codebase's conventions.
- **info** — context that saves the reviewer a question.

Run the tests yourself when you can; a claim you verified is worth noting.

## 4. Write the notes

```bash
cat > /tmp/notes.json <<'JSON'
{
  "<step id>": { "level": "risk", "text": "Tests were last run before this change; nothing covers the new retry path." },
  "<step id>": { "level": "review", "text": "Swallows the error instead of surfacing it — intended?" }
}
JSON
replay annotate .replays/<file>.json /tmp/notes.json
```

Be specific and brief: what is wrong or worth checking, and why. Do not
restate the diff. A handful of good notes beats one per step.

## 5. Hand it over

```bash
replay export .replays/<file>.json -o review.html   # one file; opens offline
```

Attach `review.html` to the pull request or send it. In the player the
reviewer presses `N` to jump from note to note, and the Evidence tab shows
the same findings as `replay check`. Summarise for the person: the verdict
from the evidence, the notes that matter most, and what you could not check.
