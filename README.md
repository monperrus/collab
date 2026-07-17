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

## Background research

# Open-Source Real-Time Collaborative Editors — State of the Field (June 2026)

---

## Sync Foundations

Two algorithms underpin real-time collaborative editing today:

**Operational Transformation (OT)** requires a central server to serialize and transform
concurrent operations. Still used by Etherpad and Overleaf, but not chosen for new projects.

**CRDTs (Conflict-free Replicated Data Types)** make every operation commutative and idempotent,
so merges are always correct regardless of ordering and no central coordinator is needed.
The dominant CRDT library is **[Yjs](https://github.com/yjs/yjs)** (MIT, ~18k stars), which
integrates with ProseMirror, CodeMirror, Monaco, Tiptap, Lexical and more, with providers
for WebSocket, WebRTC, and IndexedDB. **[Automerge](https://automerge.org/)** (MIT, JSON-doc
model, multi-language) and **[Loro](https://loro.dev/)** (MIT, Rust, built-in version history)
are the main alternatives.

---

## Category 1: General-Purpose Document Editors

### Etherpad
- **Repo:** https://github.com/ether/etherpad
- **License:** Apache 2.0
- **Status:** Active — v3.3.1, June 2026
- **Tech:** Node.js (>=24), OT, plugin system, 105 languages
- **Strengths:** Per-keystroke authorship attribution; full revision history with timeslider;
  used by Wikimedia and governments; hundreds of plugins; scales to thousands of simultaneous editors
- **Weaknesses:** OT-based; no offline support
- **Self-host:** `git clone && pnpm run prod` → localhost:9001

### HedgeDoc
- **Repo:** https://github.com/hedgedoc/hedgedoc
- **License:** AGPL-3.0
- **Tech:** Node.js, Markdown, WebSocket
- **Strengths:** Collaborative Markdown with diagrams (Mermaid, PlantUML), presentations; polished UI
- **Weaknesses:** Markdown only

### CryptPad
- **Repo:** https://github.com/xwiki-labs/cryptpad
- **License:** AGPL-3.0
- **Tech:** Client-side end-to-end encryption (server is blind to document content)
- **Strengths:** The only option where the server operator cannot read documents; covers rich text,
  spreadsheets, presentations, kanban, and whiteboard — all encrypted
- **Use case:** Privacy-critical contexts (legal, confidential research, activism)

---

## Category 2: Full Office Suites (Word/Calc/Impress replacements)

### OnlyOffice Document Server
- **Repo:** https://github.com/ONLYOFFICE/DocumentServer
- **License:** AGPL-3.0 (Community Edition)
- **Stars:** ~6600
- **Tech:** Node.js rendering engine, OOXML-native (.docx/.xlsx/.pptx); v9.3
- **Strengths:** Best Microsoft Office format fidelity in the category; real-time co-editing
  and paragraph-locking mode; integrates with Nextcloud, Seafile, Moodle, ownCloud
- **Weaknesses:** Mobile editing requires paid license; higher RAM usage
- **Self-host:** Docker; Nextcloud app available

### Collabora Online (CODE)
- **Repo:** https://github.com/CollaboraOnline/online
- **License:** Mozilla Public License 2.0
- **Tech:** LibreOffice engine running headless, browser as thin client; CODE 26.04
- **Strengths:** Best ODF format fidelity; supports DOC, DOCX, ODT, PPT, XLS, Visio and more;
  Nextcloud's official integrated partner
- **Weaknesses:** Higher RAM footprint than OnlyOffice; UI is less MS-Office-like
- **Self-host:** Docker; built-in CODE server Nextcloud app for small teams

**Verdict:** OnlyOffice for OOXML/MS Office compatibility; Collabora for ODF-first or
LibreOffice-aligned environments.

---

## Category 3: Collaborative LaTeX Editors

### Overleaf Community Edition
- **Repo:** https://github.com/overleaf/overleaf
- **License:** AGPL-3.0
- **Strengths:** Most feature-complete; full TeX Live; SyncTeX forward/inverse search; revision history
- **Weaknesses:** Self-hosting requires an 8-container Docker stack (MongoDB, Redis, Node.js mesh,
  CLSI); cloud free tier limits collaborators to 1
- **Sync:** OT

### TeXlyre
- **Repo:** https://github.com/texlyre/texlyre — https://texlyre.github.io/texlyre/
- **License:** AGPL-3.0 | **Stars:** ~848
- **Tech:** React + TypeScript + Yjs CRDTs + WebRTC (P2P); LaTeX and Typst compiled in-browser
  via WebAssembly (SwiftLaTeX + typst.ts)
- **Strengths:** Local-first (IndexedDB); no relay server needed for collaboration; embedded
  Draw.io diagrams; GitHub/GitLab/Gitea/Codeberg backup; runs with no server at all
- **Weaknesses:** Browser-side compilation is slow for large documents
- **Self-host:** None required (static site)

### FlowTex
- **Repo:** https://github.com/stolucc/flowtex
- **License:** MIT
- **Tech:** Node.js + PostgreSQL + TeX Live + Yjs; optional local helper binary that offloads
  compilation to the user's own TeX Live installation; full SyncTeX forward/inverse search
- **Strengths:** Traditional server-side architecture; per-project TeX Live year pinning;
  GitHub OAuth and sync; streaming compile output

### PaperForge
- **Repo:** https://github.com/concrete-sangminlee/paperforge
- **License:** MIT (self-host free; hosted SaaS from $8/mo)
- **Tech:** Next.js + Yjs + PostgreSQL + Redis; CodeMirror editor
- **Strengths:** Most feature-complete of the new open-source Overleaf alternatives — 13 editor
  panels, AI assistant, equation builder, diff viewer, BibTeX autocomplete with 160+ completions,
  per-user undo/redo (not global), offline editing with automatic merge on reconnect; 1632 tests

### Scribe
- **Repo:** https://github.com/sunnyallana/scribe
- **License:** AGPL-3.0
- **Tech:** Single Rust binary; SQLite persistence; Tectonic LaTeX engine bundled; WebRTC mesh;
  6 AI provider integrations; signed desktop installers (MSI/NSIS)
- **Strengths:** Minimal footprint — one binary vs an 8-container Docker stack; offline-first;
  forward SyncTeX; voice chat between collaborators via WebRTC

### SilkTex (desktop, GNOME)
- **Repo:** https://github.com/DERK0CHER/SilkTex
- **License:** GPL-3.0
- **Tech:** GTK 4 + libadwaita (C); Rust sidecar for P2P using Loro CRDT + iroh (QUIC with
  DERP relay fallback); Poppler PDF preview; SyncTeX
- **Strengths:** Native GNOME desktop app; serverless P2P — peers connect directly via QUIC
  using a shared session code, no server required
- **Weaknesses:** Linux/GNOME only

---

## Category 4: Frameworks for Building Collaborative Editors

| Framework | Role | License | Notes |
|-----------|------|---------|-------|
| **Yjs** | CRDT engine | MIT | De facto standard; providers for WebSocket, WebRTC, IndexedDB |
| **Tiptap** | Rich text editor (ProseMirror-based) | MIT (core) | Hocuspocus backend for collab |
| **Hocuspocus** | Yjs WebSocket server | MIT | Drop-in collab backend for any Yjs editor |
| **ProseMirror** | Low-level rich text engine | MIT | Basis for Tiptap, Atlassian, Notion |
| **CodeMirror 6** | Code/text editor | MIT | Used by FlowTex, PaperForge, Tinyleaf |
| **Monaco** | Code editor (VS Code engine) | MIT | Used by kolabpad |
| **Automerge** | CRDT engine (JSON-doc model) | MIT | Multi-language (JS/Rust); structured data |
| **Loro** | CRDT engine (Rust) | MIT | Built-in version history; used by SilkTex |

---
# realtime-collaborative
