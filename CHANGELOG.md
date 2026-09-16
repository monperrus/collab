# Changelog

## Unreleased

- Share files that do not exist yet: writing into the document of an unknown
  path creates the file, and its parent directories, on disk. A collaborator —
  a human in the editor, or a coding agent connected to the session — can now
  add files to the shared folder. Merely connecting to a document creates
  nothing; paths outside the shared folder or inside an ignored directory are
  refused.
- Title the desktop window `collab: <shared folder>`.
- Never overwrite a file that changed on disk since the last write: re-read it,
  merge the edits made meanwhile into the shared document, and write the merged
  result. Own writes are now recognised by content instead of by a two-second
  window, which used to drop any edit landing inside it.
- On connect, reconcile the shared document with the file rather than only
  filling an empty document, so a stale document held by the relay can no
  longer overwrite newer content on disk.

## 0.3.0

- Open the editor in a standalone desktop window (browser application mode)
  instead of only printing the URL; `--no-window` restores the old behaviour.

## 0.1.1

- Add `license` and `author` fields to `package.json`.
- Add `LICENSE` file (MIT).
- Add minimal usage example to README.

## 0.1.0

- Initial release.
