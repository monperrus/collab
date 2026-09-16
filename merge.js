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

// Minimal changed region between two strings: the text differs only in
// [start, aEnd) of `a`, which corresponds to [start, bEnd) of `b`. Working on
// the smallest possible region keeps remote cursors and selections in place.
export function diffRegion(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd-- }
  return { start, aEnd, bEnd }
}

// Make the shared text equal `target`, touching only the changed region.
export function setText(ydoc, ytext, target) {
  const current = ytext.toString()
  if (current === target) return
  const { start, aEnd, bEnd } = diffRegion(current, target)
  ydoc.transact(() => {
    if (aEnd > start) ytext.delete(start, aEnd - start)
    if (bEnd > start) ytext.insert(start, target.slice(start, bEnd))
  })
}

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

  const ext = diffRegion(base, disk)
  const loc = diffRegion(base, doc)

  if (ext.aEnd <= loc.start || loc.aEnd <= ext.start) {
    // Disjoint regions: replay the external edit at its position in the
    // document, shifted by the length the document edit added or removed.
    const shift = ext.start >= loc.aEnd ? loc.bEnd - loc.aEnd : 0
    ydoc.transact(() => {
      if (ext.aEnd > ext.start) ytext.delete(ext.start + shift, ext.aEnd - ext.start)
      if (ext.bEnd > ext.start) ytext.insert(ext.start + shift, disk.slice(ext.start, ext.bEnd))
    })
    return 'merged'
  }

  setText(ydoc, ytext, disk)
  return 'conflict'
}
