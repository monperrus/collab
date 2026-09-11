# Gakoy Collab

`@gakoy/collab` shares a local folder for smooth real-time collaborative editing
with your coding agent. Your agent edits files on disk; you edit the same files
live in the browser, at the same time, without either side clobbering the other.
It synchronizes text files in both directions while the command is running.

## The problem

Coding agents (Claude Code, and similar) edit files on disk directly, outside
any editor. If you want to watch or co-edit those same files live in a
browser — rather than reloading and diffing after the fact — plain file
syncing isn't enough: both sides can write at once, and naive syncing drops
or clobbers changes. This is the classic lost-update problem, now showing up
between a human and an AI agent instead of two humans; see
[The lost update problem, with humans and AI agents](https://www.monperrus.net/martin/lost-update-problem-humans-ai-agents)
for a walkthrough of the failure mode. `gakoy-collab` runs a [Yjs](https://yjs.dev)
CRDT over each watched file, so edits from the agent (via the filesystem) and
from you or other collaborators (via the browser) merge automatically instead of
conflicting — the agent becomes just another peer in the session.
See [AI agents as CRDT peers](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)
for a good treatment of why this needs a CRDT rather than a diff/patch loop.

## Install and use

```bash
npx @gakoy/collab ./my-project

# Or install the command once:
npm install --global @gakoy/collab
gakoy-collab ./my-project
```

Point it at the folder your coding agent is working in. The command opens the
editor in its own desktop window — no tabs, its own entry in alt-tab and in the
taskbar — and prints the session URL so you can also open it elsewhere or send
it to collaborators. Keep the command running for the duration of the session:

```
$ gakoy-collab ./my-project
Watching : /home/me/my-project
Editor   : https://collab.gakoy.com/?token=3f9c1e7a2b4d6f80
[ctrl] connected
[open] notes.md
```

The window is titled `collab: <shared folder>`, so several sessions stay
distinguishable in alt-tab and in the taskbar. Titling needs `wmctrl` or
`xdotool` on X11; without them the window keeps the generic page title.

The window is rendered by an installed browser in application mode (Chromium,
Chrome, Brave, Vivaldi, Edge or GNOME Web), using a dedicated profile under
`~/.cache/gakoy-collab/` so it keeps its size and position and stays out of your
everyday browsing session. Pass `--no-window` to only print the URL — useful
over SSH, in a container, or when you prefer your own browser:

```bash
gakoy-collab ./my-project --no-window
```

An optional second argument selects a compatible self-hosted relay:

```bash
gakoy-collab ./my-project wss://collab.example.org
```

The URL token grants access to the folder for the active session; treat it as a
secret. The hosted relay is not end-to-end encrypted.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```
