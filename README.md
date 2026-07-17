# Gakoy Collab

`@gakoy/collab` shares a local folder through the Gakoy relay for real-time,
browser-based collaborative editing. It synchronizes text files in both directions
while the command is running.

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
