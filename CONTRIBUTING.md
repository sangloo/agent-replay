# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Setup

Node 22.18 or newer (the CLI runs from TypeScript source in a checkout), pnpm
10, git.

```bash
pnpm install
pnpm dev          # the player with hot reload → http://localhost:5180
pnpm verify       # what CI runs: format, lint, typecheck, test, build
```

## Ground rules

- **Run `pnpm verify` before opening a pull request** — the whole of it, not a
  subset. CI runs exactly that, in that order.
- **Tests live beside the code** (`foo.ts` → `foo.test.ts`). The core is
  tested without git or a filesystem: they arrive as functions.
- **The core stays dependency-free and browser-pure.** No Node APIs in
  `packages/core/src` outside tests.
- **The player uses semantic tokens only** (`src/styles.css`): `bg-surface-low`,
  `text-text-mid`, `border-line`. No raw colours, no `dark:` colour variants —
  every token is already defined for both themes.
- **Look at UI changes in the browser, in both themes**, before calling them
  done.
- **Never commit a real session's replay** as a fixture. Session logs hold
  prompts, paths and command output; build fixtures by hand, as the tests do.

## Adding an agent

1. An adapter in `packages/core/src/agents/<agent>.ts` exporting `detect`
   (does this log look like mine?) and `parse` (log → neutral actions),
   registered in `agents/index.ts`, with tests against a small hand-made log.
2. A locator for its log files in `packages/app/server/sessions.ts`.

The player, capture and store need no change.
