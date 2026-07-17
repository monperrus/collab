#!/usr/bin/env node
import WebSocket from 'ws'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import chokidar from 'chokidar'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const args = process.argv.slice(2)

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`Usage: gakoy-collab [folder] [relay-url]

Share a local folder for real-time collaborative browser editing.

Arguments:
  folder     Folder to share (default: current directory)
  relay-url  WebSocket URL of a compatible relay
             (default: wss://collab.gakoy.com)`)
  process.exit(0)
}

if (args.length > 2) {
  console.error('Usage: gakoy-collab [folder] [relay-url]')
  process.exit(1)
}

const FOLDER = resolve(args[0] || '.')
const RELAY_WS = (args[1] || 'wss://collab.gakoy.com').replace(/\/$/, '')
const RELAY_HTTP = RELAY_WS.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
const TOKEN = randomBytes(16).toString('hex')

console.log(`Watching : ${FOLDER}`)
console.log(`Editor   : ${RELAY_HTTP}/?token=${TOKEN}`)

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

// ── Per-file HocuspocusProvider connections to the relay ──────────────────

const openConnections = new Map()
const ownWrites = new Map()

function ensureConnected(docName) {
  if (!docName || openConnections.has(docName)) return

  const filePath = join(FOLDER, docName)
  if (!filePath.startsWith(FOLDER + '/')) return
  if (!existsSync(filePath)) return

  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  let initialized = false

  const writeDebounced = debounce(content => {
    ownWrites.set(filePath, Date.now())
    try { writeFileSync(filePath, content, 'utf-8') } catch (e) {
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
      if (ytext.length === 0 && existsSync(filePath)) {
        try {
          ytext.insert(0, readFileSync(filePath, 'utf-8'))
        } catch (e) { console.error('[push]', docName, e.message) }
      }
      ytext.observe(() => writeDebounced(ytext.toString()))
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

chokidar
  .watch(FOLDER, { ignoreInitial: true, ignored: /(^|[/\\])\./, ignorePermissionErrors: true })
  .on('add', sendFiletree)
  .on('unlink', sendFiletree)
  .on('addDir', sendFiletree)
  .on('unlinkDir', sendFiletree)
  .on('change', filePath => {
    if (Date.now() - (ownWrites.get(filePath) || 0) < 2000) return

    const docName = relative(FOLDER, filePath)
    const conn = openConnections.get(docName)
    if (!conn) return

    try {
      const newContent = readFileSync(filePath, 'utf-8')
      const ytext = conn.ydoc.getText('content')
      const oldContent = ytext.toString()
      if (oldContent === newContent) return

      // Compute changed region to preserve remote cursors
      let start = 0
      while (start < oldContent.length && start < newContent.length && oldContent[start] === newContent[start]) start++
      let oldEnd = oldContent.length
      let newEnd = newContent.length
      while (oldEnd > start && newEnd > start && oldContent[oldEnd - 1] === newContent[newEnd - 1]) { oldEnd--; newEnd-- }

      conn.ydoc.transact(() => {
        if (oldEnd > start) ytext.delete(start, oldEnd - start)
        if (newEnd > start) ytext.insert(start, newContent.slice(start, newEnd))
      })
    } catch (e) { console.error('[sync]', filePath, e.message) }
  })

connectControl()
