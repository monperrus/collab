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
command running for the duration of the session. An optional second argument
selects a compatible self-hosted relay:

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
