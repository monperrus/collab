// Reconciliation between the shared Yjs document and the file on disk.
//
// The watcher is not the only writer of the files it shares: the coding agent
// (or the user's editor) writes them too. Whenever we are about to write, the
// file may already contain edits made after our own last write. Overwriting it
// with the document content would silently drop them — the lost-update problem
// this tool exists to avoid. So every write first reconciles the on-disk text
// into the document, and only then writes the merged result back.
//
// `base` is the content of the file as of our last write or read: the common
// ancestor of the on-disk version and the document version.
//
// Every change is applied to the document as the smallest set of separate
// hunks. The text between two edits is never deleted and reinserted: the
// browser editor anchors its scroll position on that text, and replacing it
// makes the window of a human reading elsewhere in the file jump.

import { diffLines } from 'diff'

// Minimal changed region between two strings: the text differs only in
// [start, aEnd) of `a`, which corresponds to [start, bEnd) of `b`.
export function diffRegion(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd-- }
  return { start, aEnd, bEnd }
}

// Changed hunks between two strings, in order and non-overlapping: `a` from
// aStart to aEnd becomes `b` from bStart to bEnd. Hunks are found line by line,
// then narrowed to the characters that changed, so two edits on one line stay
// distinguishable from an edit spanning it.
export function diffHunks(a, b) {
  const hunks = []
  let aPos = 0
  let bPos = 0
  let open = null
  const close = () => {
    if (!open) return
    const r = diffRegion(a.slice(open.aStart, aPos), b.slice(open.bStart, bPos))
    if (r.aEnd > r.start || r.bEnd > r.start) {
      hunks.push({
        aStart: open.aStart + r.start, aEnd: open.aStart + r.aEnd,
        bStart: open.bStart + r.start, bEnd: open.bStart + r.bEnd,
      })
    }
    open = null
  }
  for (const part of diffLines(a, b)) {
    if (!part.added && !part.removed) {
      close()
      aPos += part.value.length
      bPos += part.value.length
      continue
    }
    open ??= { aStart: aPos, bStart: bPos }
    if (part.removed) aPos += part.value.length
    else bPos += part.value.length
  }
  close()
  return hunks
}

// Apply hunks of `source` to the shared text, `at` giving each hunk's start in
// the shared text. Applied from the last to the first, so the positions of the
// hunks not yet applied stay valid.
function applyHunks(ydoc, ytext, hunks, source, at) {
  ydoc.transact(() => {
    for (const hunk of [...hunks].reverse()) {
      const pos = at(hunk)
      if (hunk.aEnd > hunk.aStart) ytext.delete(pos, hunk.aEnd - hunk.aStart)
      if (hunk.bEnd > hunk.bStart) ytext.insert(pos, source.slice(hunk.bStart, hunk.bEnd))
    }
  })
}

// Make the shared text equal `target`, touching only the changed hunks.
export function setText(ydoc, ytext, target) {
  const current = ytext.toString()
  if (current === target) return
  applyHunks(ydoc, ytext, diffHunks(current, target), target, hunk => hunk.aStart)
}

const overlaps = (x, y) => !(x.aEnd <= y.aStart || y.aEnd <= x.aStart)

// Merge the edits made on disk since `base` into the shared document.
//
// Returns what happened:
//   'noop'     nothing to reconcile
//   'external' only disk changed, the document now matches it
//   'merged'   both sides changed, in separate regions: both are kept
//   'conflict' both sides changed the same region: the on-disk text wins
//
// On conflict the on-disk text wins because it is the version the agent (or
// the user's editor) has, and it is the one that would be lost for good; the
// browser side keeps its edit visible in the editor's undo history and sees
// the merged text immediately.
export function mergeExternalEdits(ydoc, ytext, base, disk) {
  const doc = ytext.toString()
  if (doc === disk) return 'noop'
  if (base === disk) return 'noop'
  if (base == null || base === doc) { setText(ydoc, ytext, disk); return 'external' }

  const ext = diffHunks(base, disk)
  const loc = diffHunks(base, doc)

  if (ext.some(e => loc.some(l => overlaps(e, l)))) {
    setText(ydoc, ytext, disk)
    return 'conflict'
  }

  // Replay each external hunk at its position in the document, shifted by the
  // length the document edits before it added or removed.
  const shift = e => loc
    .filter(l => l.aEnd <= e.aStart)
    .reduce((sum, l) => sum + (l.bEnd - l.bStart) - (l.aEnd - l.aStart), 0)
  applyHunks(ydoc, ytext, ext, disk, e => e.aStart + shift(e))
  return 'merged'
}
