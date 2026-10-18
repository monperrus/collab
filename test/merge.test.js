import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { diffRegion, setText, mergeExternalEdits } from '../merge.js'

function doc(content) {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  ytext.insert(0, content)
  return { ydoc, ytext }
}

test('diffRegion isolates the changed region', () => {
  assert.deepEqual(diffRegion('abcd', 'abXd'), { start: 2, aEnd: 3, bEnd: 3 })
  assert.deepEqual(diffRegion('ab', 'ab'), { start: 2, aEnd: 2, bEnd: 2 })
  assert.deepEqual(diffRegion('ac', 'abc'), { start: 1, aEnd: 1, bEnd: 2 })
})

test('setText only rewrites the changed region', () => {
  const { ydoc, ytext } = doc('hello world')
  const deltas = []
  ytext.observe(e => deltas.push(e.changes.delta))
  setText(ydoc, ytext, 'hello brave world')
  assert.equal(ytext.toString(), 'hello brave world')
  assert.deepEqual(deltas, [[{ retain: 6 }, { insert: 'brave ' }]])
})

// The lines a human is reading in the browser, between two distant agent
// edits. Deleting and reinserting them makes the editor window jump.
const lines = n => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('')

test('distant edits leave the text between them untouched', () => {
  const before = lines(100)
  const after = before.replace('line 3\n', 'line 3 edited\n').replace('line 97\n', 'line 97 edited\n')
  const { ydoc, ytext } = doc(before)
  const deltas = []
  ytext.observe(e => deltas.push(e.changes.delta))
  setText(ydoc, ytext, after)
  assert.equal(ytext.toString(), after)
  assert.deepEqual(deltas, [[
    { retain: before.indexOf('line 3\n') + 6 }, { insert: ' edited' },
    { retain: before.indexOf('line 97\n') - before.indexOf('line 3\n') + 1 }, { insert: ' edited' },
  ]])
})

test('a merge leaves the text between distant edits untouched', () => {
  const base = lines(100)
  const browser = base.replace('line 50\n', 'line 50 typed\n')
  const disk = base.replace('line 3\n', 'line 3 agent\n').replace('line 97\n', 'line 97 agent\n')
  const { ydoc, ytext } = doc(browser)
  const deleted = []
  ytext.observe(e => deleted.push(...e.changes.delta.filter(op => op.delete)))
  assert.equal(mergeExternalEdits(ydoc, ytext, base, disk), 'merged')
  assert.equal(ytext.toString(), disk.replace('line 50\n', 'line 50 typed\n'))
  assert.deepEqual(deleted, [])
})

test('a conflict still only rewrites the changed hunks', () => {
  const base = lines(100)
  const browser = base.replace('line 3\n', 'row 3\n')
  const disk = base.replace('line 3\n', 'item 3\n').replace('line 97\n', 'line 97 agent\n')
  const { ydoc, ytext } = doc(browser)
  const deltas = []
  ytext.observe(e => deltas.push(e.changes.delta))
  assert.equal(mergeExternalEdits(ydoc, ytext, base, disk), 'conflict')
  assert.equal(ytext.toString(), disk)
  const touched = deltas[0].filter(op => !op.retain).map(op => op.insert ?? op.delete)
  assert.deepEqual(touched, [3, 'item', ' agent'])
})

test('no external edit leaves the document alone', () => {
  const { ydoc, ytext } = doc('typed by the browser')
  assert.equal(mergeExternalEdits(ydoc, ytext, 'on disk', 'on disk'), 'noop')
  assert.equal(ytext.toString(), 'typed by the browser')
})

test('external edit alone is applied', () => {
  const { ydoc, ytext } = doc('line a\nline b\n')
  assert.equal(mergeExternalEdits(ydoc, ytext, 'line a\nline b\n', 'line a\nline B!\n'), 'external')
  assert.equal(ytext.toString(), 'line a\nline B!\n')
})

test('an unknown base takes the file as the truth', () => {
  const { ydoc, ytext } = doc('stale relay content')
  assert.equal(mergeExternalEdits(ydoc, ytext, undefined, 'fresh disk content'), 'external')
  assert.equal(ytext.toString(), 'fresh disk content')
})

test('edits in separate regions are both kept', () => {
  const base = 'first line\nsecond line\nthird line\n'
  const { ydoc, ytext } = doc('FIRST LINE\nsecond line\nthird line\n')
  const disk = 'first line\nsecond line\nthird line EDITED\n'
  assert.equal(mergeExternalEdits(ydoc, ytext, base, disk), 'merged')
  assert.equal(ytext.toString(), 'FIRST LINE\nsecond line\nthird line EDITED\n')
})

test('a disk edit before a browser edit is kept too', () => {
  const base = 'aaa\nbbb\nccc\n'
  const { ydoc, ytext } = doc('aaa\nbbb\nccc TYPED\n')
  assert.equal(mergeExternalEdits(ydoc, ytext, base, 'AAA!\nbbb\nccc\n'), 'merged')
  assert.equal(ytext.toString(), 'AAA!\nbbb\nccc TYPED\n')
})

test('an appended line survives a browser edit elsewhere', () => {
  const base = 'committee:\n- alice\n'
  const { ydoc, ytext } = doc('COMMITTEE:\n- alice\n')
  assert.equal(mergeExternalEdits(ydoc, ytext, base, 'committee:\n- alice\n- bob\n'), 'merged')
  assert.equal(ytext.toString(), 'COMMITTEE:\n- alice\n- bob\n')
})

test('edits to different words on one line are both kept', () => {
  const base = 'the quick brown fox\n'
  const { ydoc, ytext } = doc('the slow brown fox\n')
  assert.equal(mergeExternalEdits(ydoc, ytext, base, 'the quick red fox\n'), 'merged')
  assert.equal(ytext.toString(), 'the slow red fox\n')
})

test('the same region edited on both sides keeps the file version', () => {
  const base = 'the quick brown fox\n'
  const { ydoc, ytext } = doc('the speedy brown fox\n')
  assert.equal(mergeExternalEdits(ydoc, ytext, base, 'the sluggish brown fox\n'), 'conflict')
  assert.equal(ytext.toString(), 'the sluggish brown fox\n')
})

test('merged edits replicate to a peer document', () => {
  const base = 'one\ntwo\nthree\n'
  const { ydoc, ytext } = doc(base)
  const peer = new Y.Doc()
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
  ydoc.on('update', u => Y.applyUpdate(peer, u))

  setText(ydoc, ytext, 'one\nTWO\nthree\n') // browser edit
  mergeExternalEdits(ydoc, ytext, base, 'one\ntwo\nthree\nfour\n') // agent edit

  assert.equal(ytext.toString(), 'one\nTWO\nthree\nfour\n')
  assert.equal(peer.getText('content').toString(), 'one\nTWO\nthree\nfour\n')
})
