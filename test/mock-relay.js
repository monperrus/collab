// A local stand-in for the relay, so the watcher can be tested without a
// network. It implements the three endpoints the watcher and the editor use:
//
//   ws   /__watcher__?token=   the watcher's control channel (filetree in,
//                              "open <name>" out when a peer joins a document)
//   ws   /<token>/<path>       the per-file Yjs document (Hocuspocus)
//   GET  /api/watch?token=     server-sent events carrying the file tree
//
// `startRelay()` resolves to `{ port, tree, close }`.

import http from 'http'
import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'

export function startRelay() {
  // token -> { watcher, tree, listeners }
  const sessions = new Map()

  const session = token => {
    let s = sessions.get(token)
    if (!s) { s = { watcher: null, tree: [], listeners: new Set() }; sessions.set(token, s) }
    return s
  }

  const hocuspocus = new Hocuspocus({
    quiet: true,
    onConnect({ documentName }) {
      // Ask the watcher to share this file, like the relay does when the
      // editor opens one.
      const slash = documentName.indexOf('/')
      if (slash === -1) return Promise.resolve()
      const s = sessions.get(documentName.slice(0, slash))
      if (s?.watcher?.readyState === 1) {
        s.watcher.send(JSON.stringify({ type: 'open', name: documentName.slice(slash + 1) }))
      }
      return Promise.resolve()
    },
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/watch') return res.writeHead(404).end('not found')
    const s = session(url.searchParams.get('token') || '')
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(`data: ${JSON.stringify(s.tree)}\n\n`)
    s.listeners.add(res)
    req.on('close', () => s.listeners.delete(res))
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/__watcher__') {
      const s = session(url.searchParams.get('token') || '')
      wss.handleUpgrade(req, socket, head, ws => {
        s.watcher = ws
        ws.on('message', raw => {
          try {
            const msg = JSON.parse(raw)
            if (msg.type !== 'filetree') return
            s.tree = msg.tree
            for (const res of s.listeners) res.write(`data: ${JSON.stringify(s.tree)}\n\n`)
          } catch {}
        })
        ws.on('close', () => { if (s.watcher === ws) s.watcher = null })
      })
      return
    }

    // Everything else is a document connection; its name travels in the
    // Hocuspocus protocol itself, not in the URL.
    wss.handleUpgrade(req, socket, head, ws => hocuspocus.handleConnection(ws, req))
  })

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      tree: token => session(token).tree,
      close: () => new Promise(done => {
        for (const client of wss.clients) client.terminate()
        hocuspocus.destroy()
        server.close(done)
      }),
    }))
  })
}
