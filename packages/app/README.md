# @agent-replay/app

The `replay` command, its local service, and the player. Published to npm as
[`agentreplay`](https://www.npmjs.com/package/agentreplay); what it does is in
the [repository README](../../README.md). This page is the map for working on
it.

## Layout

|                  |                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/replay.mjs` | The command: checks Node, then runs the bundled CLI (a package) or `server/cli.ts` from source (a checkout)                                                                                                                     |
| `server/`        | Node: session discovery (`sessions.ts`), git (`git.ts`), capture, the `.replays/` store, projects, hooks and setup, `explain`, `export`, and the `/api` handler                                                                 |
| `src/`           | The player: the library (`library.tsx`, project picker, folder dialog) and `player/` — the playback clock, the diff timeline, code pane, caption, files, steps, evidence and lesson panels, and the Markdown and maths renderer |
| `src/ui/`        | The few controls the player needs: tree, timeline scrubber, resizable panel, select, popover, dialog, shortcuts sheet, theme                                                                                                    |
| `scripts/`       | `package.mjs`, which builds the npm package                                                                                                                                                                                     |

The design tokens are in `src/styles.css`: a handful of semantic colours
defined once per theme and registered with Tailwind. Components name the role
(`bg-surface-low`, `text-text-mid`), never a raw value, and never a `dark:`
colour variant.

## The local API

`server/api.ts` is a Vite plugin in development and a small Node server under
`replay open`. It answers `{ data, meta }`, and problems as
`application/problem+json`.

|                                                            |                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/projects`, `POST`, `DELETE ?root=`               | Known repositories; add a folder; forget one added by hand                             |
| `GET /api/folders?path=`                                   | The folders in a folder, to choose one                                                 |
| `GET /api/sessions`, `GET /api/replays`                    | Pages: `?q=`, `?agent=`, `?project=`, `?offset=`, `?limit=` (≤ 100), with facet counts |
| `GET /api/sessions/:id`, `GET /api/replays/:id`            | One replay; a session is captured live (cached until its log changes)                  |
| `GET /api/{sessions,replays}/:id/tree`, `/file?rev=&path=` | The repository at the replay's base commit, and one file of it                         |
| `GET /api/{sessions,replays}/:id/export`                   | The replay as one HTML file                                                            |
| `POST /api/sessions/:id/save`                              | Save a session into its repository's `.replays/`                                       |

Every write needs an `X-Request-ID` header and, when the browser names one, a
local `Origin`; the server answers only to local host names.

## Working on it

```bash
pnpm dev                                   # from the root: the player → :5180
pnpm --filter @agent-replay/app test       # server and player tests
REPLAY_REPOS=~/code/other pnpm dev         # also list another repository's saved replays
```

Large session logs are read line by line (`readLog`), never as one string —
a log can outgrow the longest string a JavaScript engine will make.

## Releasing

`pnpm package` builds `.package/`: the player prebuilt, the CLI with every
dependency bundled into one file (no install step; Node 20 is enough), and a
tarball. Try it with `npm install -g packages/app/.package/agentreplay-*.tgz`.

To publish, bump `version` in `publish.json`, push a `v<version>` tag, and
`.github/workflows/release.yml` verifies, packages, publishes to npm (it needs
an `NPM_TOKEN` secret) and attaches the tarball to a GitHub release.
