# agentreplay

Replay what a coding agent did **the way it did it**: every change in order,
typed in as it happened, with the agent's own words beside each step — from
the commit it started on to the state it left. Claude Code, Codex and Gemini
CLI sessions, read from the logs they already write, in any git repository.

```bash
npx agentreplay            # open the player → http://localhost:5180
```

Or keep the `replay` command:

```bash
npm install -g agentreplay
replay open                # the player
replay setup               # capture automatically after every agent turn
replay capture             # save this session to .replays/ in the repo
replay export <file>       # one HTML file that plays anywhere, offline
replay check <file>        # what the agent checked, and whether it held
replay help                # everything else
```

Needs Node 20 or newer and git. Everything runs on your machine: the player
listens on localhost only, reads agent logs, and writes nothing but the
replays you save (into the repository's `.replays/`) and the folders you add
(`~/.config/replay/projects.json`).

**Claude Code plugin** (the replay skill and automatic capture):

```bash
claude plugin marketplace add sangloo/agent-replay
claude plugin install replay@agent-replay
```

Source, docs and issues: https://github.com/sangloo/agent-replay — MIT licensed.
