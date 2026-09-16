#!/usr/bin/env node
import WebSocket from 'ws'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import chokidar from 'chokidar'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { openAppWindow } from './app-window.js'
import { mergeExternalEdits, setText } from './merge.js'

const argv = process.argv.slice(2)

if (argv[0] === '--help' || argv[0] === '-h') {
  console.log(`Usage: gakoy-collab [folder] [relay-url] [options]

Share a local folder for real-time collaborative browser editing.

Arguments:
  folder       Folder to share (default: current directory)
  relay-url    WebSocket URL of a compatible relay
               (default: wss://collab.gakoy.com)

Options:
  --no-window  Only print the editor URL, do not open a desktop window`)
  process.exit(0)
}

const OPEN_WINDOW = !argv.includes('--no-window')
const args = argv.filter(arg => arg !== '--no-window')

if (args.length > 2) {
  console.error('Usage: gakoy-collab [folder] [relay-url] [--no-window]')
  process.exit(1)
}

const FOLDER = resolve(args[0] || '.')
const RELAY_WS = (args[1] || 'wss://collab.gakoy.com').replace(/\/$/, '')
const RELAY_HTTP = RELAY_WS.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
const TOKEN = randomBytes(16).toString('hex')

const EDITOR_URL = `${RELAY_HTTP}/?token=${TOKEN}`

console.log(`Watching : ${FOLDER}`)
console.log(`Editor   : ${EDITOR_URL}`)

// The URL stays printed so it can be shared with collaborators; the window is
// for the local user, who wants an application, not a tab.
if (OPEN_WINDOW && !openAppWindow(EDITOR_URL, `collab: ${FOLDER}`)) {
  console.log('Window   : none available, open the URL above manually')
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getFileTree(dir, base = dir) {
  try {
    return readdirSync(dir)
      .sort()
      .flatMap(name => {
        const full = join(dir, name)
        if (isIgnored(full)) return []
        const rel = relative(base, full)
        try {
          const stat = statSync(full)
          if (stat.isDirectory()) {
            return [{ type: 'dir', name, path: rel, children: getFileTree(full, base) }]
          }
          return [{ type: 'file', name, path: rel }]
        } catch { return [] }
      })
  } catch { return [] }
}

function debounce(fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

// ── Per-file HocuspocusProvider connections to the relay ──────────────────

const openConnections = new Map()

// filePath -> content of the file as we last saw it, i.e. what we last wrote or
// last read from disk. It is the common ancestor used to detect and merge the
// edits made by the agent between two of our own writes.
const lastSeen = new Map()

function logMerge(docName, outcome) {
  if (outcome === 'merged') console.log('[merge]', docName, 'merged edits made on disk')
  if (outcome === 'conflict') console.warn('[merge]', docName, 'same region edited on both sides, kept the version on disk')
}

// Pull the edits made on disk into the shared document. Returns false when the
// file could not be read.
function ingestFromDisk(docName, conn) {
  let disk
  try { disk = readFileSync(conn.filePath, 'utf-8') } catch (e) {
    console.error('[read]', docName, e.message)
    return false
  }
  if (disk === lastSeen.get(conn.filePath)) return true // our own write coming back

  const ytext = conn.ydoc.getText('content')
  logMerge(docName, mergeExternalEdits(conn.ydoc, ytext, lastSeen.get(conn.filePath), disk))
  lastSeen.set(conn.filePath, disk)
  return true
}

function ensureConnected(docName) {
  if (!docName || openConnections.has(docName)) return

  const filePath = join(FOLDER, docName)
  if (!filePath.startsWith(FOLDER + '/')) return
  if (!existsSync(filePath)) return

  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  let initialized = false

  // Never write blindly: the file may have been edited on disk since our last
  // write, either by the agent or by the user's editor, and the change event
  // may not have reached us yet. Re-read it, merge whatever is new into the
  // document, and write the merged result.
  const writeDebounced = debounce(() => {
    const conn = openConnections.get(docName)
    if (!conn) return
    // A file we cannot read is a file we must not overwrite.
    if (existsSync(filePath) && !ingestFromDisk(docName, conn)) return

    const content = ytext.toString()
    if (content === lastSeen.get(filePath)) return
    try {
      writeFileSync(filePath, content, 'utf-8')
      lastSeen.set(filePath, content)
    } catch (e) {
      console.error('[write]', docName, e.message)
    }
  }, 300)

  // Token namespaces the Hocuspocus document: relay sees "<token>/<docName>"
  const provider = new HocuspocusProvider({
    url: `${RELAY_WS}/${TOKEN}/${docName}`,
    name: `${TOKEN}/${docName}`,
    document: ydoc,
    WebSocketPolyfill: WebSocket,
    onSynced: () => {
      if (initialized) return
      initialized = true
      // The relay may still hold a document from an earlier session, older
      // than the file the agent has been editing meanwhile. Disk always wins
      // on connect: every document edit is written out within a fraction of a
      // second, so the file is never behind the relay.
      if (existsSync(filePath)) {
        try {
          const disk = readFileSync(filePath, 'utf-8')
          setText(ydoc, ytext, disk)
          lastSeen.set(filePath, disk)
        } catch (e) { console.error('[push]', docName, e.message) }
      }
      ytext.observe(() => writeDebounced())
      console.log('[open]', docName)
    },
  })

  openConnections.set(docName, { ydoc, provider, filePath })
}

// ── Control plane: WebSocket to relay ─────────────────────────────────────

let ctrlWs = null
let pingTimer = null

function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
}

function startPing(ws) {
  stopPing()
  let alive = true
  pingTimer = setInterval(() => {
    if (!alive) {
      console.log('[ctrl] ping timeout, reconnecting...')
      stopPing()
      ws.terminate()
      return
    }
    alive = false
    try { ws.ping() } catch {}
  }, 20000)
  ws.on('pong', () => { alive = true })
}

function connectControl() {
  ctrlWs = new WebSocket(`${RELAY_WS}/__watcher__?token=${TOKEN}`)

  ctrlWs.on('open', () => {
    console.log('[ctrl] connected')
    startPing(ctrlWs)
    sendFiletree()
  })

  ctrlWs.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'open') ensureConnected(msg.name)
    } catch {}
  })

  ctrlWs.on('close', () => {
    stopPing()
    console.log('[ctrl] reconnecting in 5s...')
    setTimeout(connectControl, 5000)
  })

  ctrlWs.on('error', () => {})
}

function sendFiletree() {
  if (ctrlWs?.readyState === WebSocket.OPEN) {
    ctrlWs.send(JSON.stringify({ type: 'filetree', tree: getFileTree(FOLDER) }))
  }
}

// ── Local file watcher ────────────────────────────────────────────────────

// Ignore directories that cannot be usefully shared and the short-lived files
// produced by editors and build tools. In particular, watching every temporary
// file can exhaust Linux's inotify quota before chokidar has a chance to remove
// its watcher again.
function isIgnored(filePath) {
  const name = filePath.split(/[\\/]/).pop()
  return filePath !== FOLDER && (
    /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(filePath) ||
    name.startsWith('.') ||
    /(?:~|\.(?:sw[op]|tmp|temp|bak)|\.tmp\.[^\\/]+)$/i.test(name)
  )
}

let watcher
let pollingFallbackStarted = false

function startWatcher(usePolling = false) {
  watcher = chokidar
    .watch(FOLDER, {
      ignoreInitial: true,
      ignored: isIgnored,
      ignorePermissionErrors: true,
      usePolling,
    })
  .on('add', sendFiletree)
  .on('unlink', sendFiletree)
  .on('addDir', sendFiletree)
  .on('unlinkDir', sendFiletree)
  // Our own writes are recognised by their content, not by a time window: a
  // write from the agent landing right after one of ours must never be taken
  // for an echo and skipped, otherwise it is lost.
  .on('change', filePath => {
    const docName = relative(FOLDER, filePath)
    const conn = openConnections.get(docName)
    if (conn) ingestFromDisk(docName, conn)
  })
  .on('error', error => {
    console.error('[watch]', error.message)
    if (error.code !== 'ENOSPC' || pollingFallbackStarted) return

    // The system-wide inotify limit is exhausted. Polling does not use
    // inotify, so it keeps the collaboration session alive without requiring
    // the user to change a kernel setting or restart other applications.
    pollingFallbackStarted = true
    console.warn('[watch] inotify limit reached; restarting with polling')
    watcher.close()
      .catch(closeError => console.error('[watch]', closeError.message))
      .finally(() => startWatcher(true))
  })
}

startWatcher()

connectControl()
