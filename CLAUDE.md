# Agent Replay

pnpm workspace: `packages/core` (the replay format and all logic — zero
dependencies, browser-pure, relative imports carry `.ts`), `packages/app` (the
`replay` CLI, local service and React player), `plugin/` (the Claude Code
plugin).

```bash
pnpm dev          # player → :5180
pnpm replay <cmd> # CLI from source
pnpm verify       # format:check, lint, typecheck, test, build — run it before calling anything done
```

- Tests live beside the code they cover.
- Player styling: semantic tokens from `packages/app/src/styles.css` only; no
  raw colours, no `dark:` colour variants. Check UI in both themes.
- The player reaches the network only through `packages/app/src/api.ts`.
- Never commit a real session's replay or log: they hold prompts and paths.
