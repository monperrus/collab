# Gakoy Collab

`@gakoy/collab` shares a local folder through the Gakoy relay for real-time,
browser-based collaborative editing. It synchronizes text files in both directions
while the command is running.

## The problem

Coding agents (Claude Code, and similar) edit files on disk directly, outside
any editor. If a human wants to watch or co-edit those same files live in a
browser — rather than reloading and diffing after the fact — plain file
syncing isn't enough: both sides can write at once, and naive syncing drops
or clobbers changes. `gakoy-collab` runs a [Yjs](https://yjs.dev) CRDT over
each watched file, so edits from the agent (via the filesystem) and from
collaborators (via the browser) merge automatically instead of conflicting.
See [AI agents as CRDT peers](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)
for a good treatment of why this needs a CRDT rather than a diff/patch loop.

## Install and use

```bash
npx @gakoy/collab ./my-project

# Or install the command once:
npm install --global @gakoy/collab
gakoy-collab ./my-project
```

The command prints a session URL. Send that URL to collaborators and keep the
command running for the duration of the session:

```
$ gakoy-collab ./my-project
Watching : /home/me/my-project
Editor   : https://collab.gakoy.com/?token=3f9c1e7a2b4d6f80
[ctrl] connected
[open] notes.md
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
