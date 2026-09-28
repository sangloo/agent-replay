---
name: replay-teach
description: Teach a repository by rebuilding it from nothing as a course — lessons that write the real code a piece at a time, with explanations of the design, the functions and the mathematics beside it, playable in the replay player. Use when someone wants to learn or onboard onto a codebase (especially one written largely by AI) without replaying every commit, or asks to "teach me", "walk me through", "explain this repo" or "make a course".
---

# Teach a repository as a course

You are writing a course that rebuilds this repository **from an empty folder
to its current state**, for a person who wants to understand it. Each lesson
brings in real code a piece at a time and explains it: what it is for, how it
works, the reasoning and the maths behind it, with examples. The learner
plays it in the replay player — code typing itself in on the left, your
explanation growing beside it, the lines you talk about lit up.

The tool guarantees the code is real: every piece comes from the target
revision with `take`, so you never retype code (and never misremember it).
Your job is the teaching: the order, the explanations, the examples.

The command is `replay …` when installed, or `npx -y agent-replay-studio …` without
installing — use whichever works here. `replay course help` lists everything.

## 0. Understand before you teach

Read the repository first: the README, the manifests, the entry points, the
core modules, the tests. Work out:

- **What it is for** and who uses it — the one-paragraph story.
- **The concepts** a newcomer must hold in their head, and in what order they
  depend on each other.
- **The load-bearing code**: the handful of types and functions everything
  else leans on. They get the most time.
- **The maths or algorithms** in play (geometry, statistics, parsing, graph
  algorithms, protocols) — these need real explanation, with formulas.
- **What is boilerplate**: config, generated files, trivial glue. It gets
  one sentence and `fill`, not a lesson.

## 1. Start the course and plan it

```bash
replay course start --title "Learn <project>: <angle>"          # whole repo at HEAD
replay course start --title "…" --path packages/core --to v2.0   # part of it, at a tag
```

It prints every file to build **in build order** (what a file uses comes
before it). That is a starting point, not the lesson plan. Plan 3–15 lessons,
each one idea a learner can hold at once, ordered so every lesson builds only
on what came before. For a whole repository:

1. What the project is (README), and the shape of the repository.
2. The data model: core types, what each field means and why it exists.
3. The pure core: functions over that data, simplest first.
4. Composition: the modules that combine them.
5. The edges: I/O, CLI, UI, network — how the core meets the world.
6. How it is tested, and how to run it.

For a course scoped to one module (`--path`): what problem it solves and
where it sits, its types, its algorithm in the order it is easiest to
understand, then its tests as a specification.

A large repository gets several courses (one per package, with `--path`),
not one enormous one. The newest course is the one every command works on;
`--course <name>` picks another (`start` prints the names).

## 2. Write each lesson

```bash
replay course lesson "Vectors are plain data" --goal "Know what a Vec is and why it is not a class."
```

Then alternate **explain** and **take**, in the order a person would want to
hear it — usually: the idea first, then the code, then what the code means.

```bash
replay course explain - <<'MD'
A **vector** in the plane is an ordered pair $(x, y)$ …
MD

replay course outline src/vec.ts                   # each definition's lines, and the file numbered
replay course take src/vec.ts --lines 1-4          # just the type, first
replay course explain --file src/vec.ts --lines 1-4 - <<'MD'
Two numbers and nothing else: …
MD
replay course take src/vec.ts --lines 1-12 --why "Addition, then the dot product."
replay course explain --file src/vec.ts --lines 10-12 - <<'MD'
$$ \vec a \cdot \vec b = a_x b_x + a_y b_y = |\vec a|\,|\vec b|\cos\theta $$
MD
replay course take src/vec.ts                      # the rest of the file
```

- **Build a file up, don't dump it.** Take the type first, then one function,
  then the next, widening `--lines` each time (`--lines 1-4,20-35` takes
  several ranges; they arrive in file order). A 400-line file should arrive
  in several takes, each followed by an explanation. Small files can arrive
  whole.
- **Point at the code** with `explain --file <path> --lines a-b` (or
  `--lines 25` for one line): the player shows that file with those lines
  lit. **Line numbers are always the real file's** — the numbers `outline`
  prints and `take` uses. The tool finds those lines in the file as built so
  far and says so when their numbers there differ ("Lines 36-68 of diff.ts
  are lines 31-63 of the file so far"); the player shows the latter. So in
  the prose, refer to code **by name** ("`myers`", "the loop over `k`"),
  not by line number.
- `outline` gives each definition's range and where the comment above it
  starts: take `function myers (36-68, comment from 31)` as `--lines 31-68`.
- **A simpler first draft** is allowed when it teaches something:
  `replay course write <path> < draft` (a real file of the target, written by
  hand), then explain the limitation, then `take` the real version and
  explain the difference. Say plainly that the draft was a draft.
- **Examples** are teaching material, not part of the repository. Write
  them small and runnable against the real API, and **run them** before
  recording them:

  ```bash
  mkdir -p learn && cat > learn/01-vectors.ts <<'TS'
  import { dot } from "../src/vec.ts";
  console.log(dot({ x: 1, y: 0 }, { x: 0, y: 1 })); // 0
  TS
  node learn/01-vectors.ts                 # Node 22.18+ runs TypeScript as is
  replay course example learn/01-vectors.ts   # records the file as it is on disk
  rm -r learn                              # the course keeps it; the repo does not need it
  ```

  Paths are relative to `learn/`. Quote the real output in an explanation.
  Exercises, worked problems and cheat sheets go under `learn/` too.

- **Boilerplate**: one explanation of what it is, then
  `replay course fill "*.json" config/ .github/`.
- **End each lesson** with a short recap: the two or three ideas to keep, a
  pitfall, and one thing to try.
- Read the one-line progress after each command; `replay course status`
  lists what is partial and what is next.

## 3. Fix mistakes as you go

```bash
replay course show --last 10            # the latest steps, numbered
replay course show 23                   # one step in full, with the code it lights
replay course amend 23 - <<'MD'         # rewrite an explanation in place
…
MD
replay course amend 4 --title "…" --goal "…"   # a lesson's title or goal
replay course undo 2                    # take back the last two steps
```

`amend` keeps everything after the step; `undo` throws its steps away (look
at them with `show` first). `take` refuses to narrow a file the learner has
already seen more of — widen `--lines`, or pass `--drop` if you mean it.

## 4. How to explain

Write for a capable engineer who has never seen this code.

- **Why before what.** Say what problem a piece solves before how.
- **Name the invariant.** What must always be true; who guarantees it.
- **Walk through a function** with a concrete input: "for `[3, 1, 2]` the
  loop …". Mention edge cases, complexity when it matters, and what calls it.
- **Maths is written as maths**, in `$…$` and `$$…$$` (TeX): state the
  formula, say what each symbol is, then connect each term to the code line
  that computes it. Derive it when the derivation is the insight.
- **Markdown works**: headings, lists, tables, fenced code with a language,
  quotes. Keep explanations to a few paragraphs; split a long one into
  several steps beside the code each part is about.
- **Maths** renders with KaTeX; `explain` warns when a `$` is unbalanced.
- **Never invent.** Check claims about behaviour, edge cases or performance
  by running them — a scratch copy, a one-off script, the test suite —
  before you write them down. If you are not sure why something is the way
  it is, say so, or look in the history (`git log -L`, `git blame`). Never
  describe behaviour the code does not have.

## 5. Finish, check, share

```bash
replay course check        # exit 0 only when every file matches the target exactly
```

Fix whatever it lists: `take` or `fill` what is missing. A file it reports as
"not in the target" must be undone, or made an `example`. Then:

```bash
replay export .replays/<file>.json -o ~/Desktop/learn-<project>.html   # one file to hand over
```

The course is `.replays/<file>.json`. Offer to commit it (`git add
.replays/<file>.json`) — commit it yourself only if the person or the
project's rules want commits from you. Never commit the exported HTML.

Tell the person how to open it: `replay` (the player, Saved tab), or the
exported file. To keep learning past the target, `replay history --from
<target rev>` replays every commit after it the same way.

## Rules

- Code only enters through `take`, `fill`, or clearly labelled `write`
  drafts. Never paste repository code into an explanation instead of taking
  it — quote a line or two at most.
- One `replay course` command at a time; each appends one step, in order.
- Lockfiles, binaries and files over 512 KB are left out of courses
  automatically; `start` says how many.
