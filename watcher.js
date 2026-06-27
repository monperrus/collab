#!/usr/bin/env node
import WebSocket from 'ws'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import chokidar from 'chokidar'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const FOLDER = resolve(process.argv[2] || '.')
const RELAY_WS = (process.argv[3] || 'wss://collab.gakoy.com').replace(/\/$/, '')
const RELAY_HTTP = RELAY_WS.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')

console.log(`Watching : ${FOLDER}`)
console.log(`Editor   : ${RELAY_HTTP}`)

// ── Helpers ────────────────────────────────────────────────────────────────

function getFileTree(dir, base = dir) {
  try {
    return readdirSync(dir)
      .filter(f => !f.startsWith('.') && f !== 'node_modules')
      .sort()
      .flatMap(name => {
        const full = join(dir, name)
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

// ── Per-file Yjs connections to the relay ─────────────────────────────────

const openConnections = new Map()
const ownWrites = new Map() // track writes we initiated to suppress chokidar echo

function ensureConnected(docName) {
  if (!docName || openConnections.has(docName)) return

  const filePath = join(FOLDER, docName)
  if (!filePath.startsWith(FOLDER + '/')) return // path traversal / empty-name guard
  if (!existsSync(filePath)) return // only sync files that exist locally

  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  let initialized = false

  const writeDebounced = debounce(content => {
    ownWrites.set(filePath, Date.now())
    try { writeFileSync(filePath, content, 'utf-8') } catch (e) {
      console.error('[write]', docName, e.message)
    }
  }, 300)

  const provider = new HocuspocusProvider({
    url: RELAY_WS,
    name: docName,
    document: ydoc,
    WebSocketPolyfill: WebSocket,
    onSynced: () => {
      if (initialized) return
      initialized = true

      // Push disk content if relay doc is empty (first open)
      if (ytext.length === 0 && existsSync(filePath)) {
        try {
          ytext.insert(0, readFileSync(filePath, 'utf-8'))
        } catch (e) { console.error('[push]', docName, e.message) }
      }

      // Propagate relay (browser) edits back to disk
      ytext.observe(() => writeDebounced(ytext.toString()))

      console.log('[open]', docName)
    },
  })

  openConnections.set(docName, { ydoc, provider, filePath })
}

// ── Control plane: WebSocket to relay ─────────────────────────────────────
// Used to: push file tree → relay, receive "open this file" signals ← relay

let ctrlWs = null

function connectControl() {
  ctrlWs = new WebSocket(`${RELAY_WS}/__watcher__`)

  ctrlWs.on('open', () => {
    console.log('[ctrl] connected')
    sendFiletree()
  })

  ctrlWs.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'open') ensureConnected(msg.name)
    } catch {}
  })

  ctrlWs.on('close', () => {
    console.log('[ctrl] reconnecting in 5s...')
    setTimeout(connectControl, 5000)
  })

  ctrlWs.on('error', () => {}) // 'close' will fire and retry
}

function sendFiletree() {
  if (ctrlWs?.readyState === WebSocket.OPEN) {
    ctrlWs.send(JSON.stringify({ type: 'filetree', tree: getFileTree(FOLDER) }))
  }
}

// ── Local file watcher ────────────────────────────────────────────────────

chokidar
  .watch(FOLDER, { ignoreInitial: true, ignored: /(^|[/\\])\./, ignorePermissionErrors: true })
  .on('add', sendFiletree)
  .on('unlink', sendFiletree)
  .on('addDir', sendFiletree)
  .on('unlinkDir', sendFiletree)
  .on('change', filePath => {
    // Skip writes we made ourselves
    if (Date.now() - (ownWrites.get(filePath) || 0) < 2000) return

    const docName = relative(FOLDER, filePath)
    const conn = openConnections.get(docName)
    if (!conn) return

    try {
      const content = readFileSync(filePath, 'utf-8')
      const ytext = conn.ydoc.getText('content')
      conn.ydoc.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, content)
      })
    } catch (e) { console.error('[sync]', filePath, e.message) }
  })

connectControl()
