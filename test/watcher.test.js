// End-to-end tests of the watcher against a local relay: a real `gakoy-collab`
// process shares a temporary folder, and a peer (standing in for the browser
// editor, or for a coding agent) joins documents over Hocuspocus.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { startRelay } from './mock-relay.js'

const WATCHER = fileURLToPath(new URL('../watcher.js', import.meta.url))

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  return null
}

// Start a relay, a shared folder and a watcher on it; return the handles plus
// a `peer()` helper joining a document the way the editor does.
async function session() {
  const relay = await startRelay()
  const folder = mkdtempSync(join(tmpdir(), 'collab-test-'))

  const watcher = spawn('node', [WATCHER, folder, `ws://127.0.0.1:${relay.port}`, '--no-window'])
  let output = ''
  watcher.stdout.on('data', d => { output += d })
  watcher.stderr.on('data', d => { output += d })

  const token = await until(() => (output.match(/token=([0-9a-f]+)/) || [])[1])
  assert.ok(token, `no token in watcher output: ${output}`)
  await until(() => output.includes('[ctrl] connected'))

  const peers = []
  const peer = name => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${relay.port}/${token}/${name}`,
      name: `${token}/${name}`,
      document: ydoc,
      WebSocketPolyfill: WebSocket,
    })
    peers.push(provider)
    return { ydoc, ytext: ydoc.getText('content'), provider }
  }

  return {
    folder, token, peer, relay,
    output: () => output,
    async close() {
      for (const provider of peers) provider.destroy()
      watcher.kill()
      await relay.close()
    },
  }
}

test('a peer writing into an unknown document creates the file', async () => {
  const s = await session()
  try {
    const { ytext } = s.peer('created.md')
    await sleep(300)
    ytext.insert(0, 'written from the session\n')

    const path = join(s.folder, 'created.md')
    await until(() => existsSync(path))
    assert.equal(readFileSync(path, 'utf-8'), 'written from the session\n')
    assert.match(s.output(), /\[new\] created\.md/)
  } finally {
    await s.close()
  }
})

test('a created file goes into a directory that does not exist yet', async () => {
  const s = await session()
  try {
    const { ytext } = s.peer('src/deep/new.js')
    await sleep(300)
    ytext.insert(0, 'export const x = 1\n')

    const path = join(s.folder, 'src/deep/new.js')
    await until(() => existsSync(path))
    assert.equal(readFileSync(path, 'utf-8'), 'export const x = 1\n')
  } finally {
    await s.close()
  }
})

test('a created file shows up in the file tree', async () => {
  const s = await session()
  try {
    const { ytext } = s.peer('appeared.txt')
    await sleep(300)
    ytext.insert(0, 'hello')

    const tree = await until(() => {
      const nodes = s.relay.tree(s.token)
      return nodes.some(node => node.path === 'appeared.txt') ? nodes : null
    })
    assert.ok(tree, 'the new file never reached the file tree')
  } finally {
    await s.close()
  }
})

test('joining a document creates nothing on its own', async () => {
  const s = await session()
  try {
    s.peer('untouched.md')
    await sleep(1500)
    assert.equal(existsSync(join(s.folder, 'untouched.md')), false)
  } finally {
    await s.close()
  }
})

test('a document cannot create a file outside the shared folder', async () => {
  const s = await session()
  try {
    const { ytext } = s.peer('../escaped.md')
    await sleep(300)
    ytext.insert(0, 'nope')
    await sleep(1500)
    assert.equal(existsSync(join(s.folder, '../escaped.md')), false)
  } finally {
    await s.close()
  }
})

test('a document cannot create a file in an ignored directory', async () => {
  const s = await session()
  try {
    const { ytext } = s.peer('.git/hooks/pre-commit')
    await sleep(300)
    ytext.insert(0, 'nope')
    await sleep(1500)
    assert.equal(existsSync(join(s.folder, '.git/hooks/pre-commit')), false)
  } finally {
    await s.close()
  }
})

test('an existing file is still shared, and edits reach the disk', async () => {
  const s = await session()
  try {
    mkdirSync(join(s.folder, 'sub'), { recursive: true })
    writeFileSync(join(s.folder, 'sub/notes.md'), 'hello\nworld\n')

    const { ytext } = s.peer('sub/notes.md')
    await until(() => ytext.toString() === 'hello\nworld\n')

    ytext.insert(6, 'brave ')
    await until(() => readFileSync(join(s.folder, 'sub/notes.md'), 'utf-8') === 'hello\nbrave world\n')
    assert.equal(readFileSync(join(s.folder, 'sub/notes.md'), 'utf-8'), 'hello\nbrave world\n')
  } finally {
    await s.close()
  }
})
