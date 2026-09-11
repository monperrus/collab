// Open the session editor in a standalone desktop window.
//
// A browser tab does not behave like an application: it is buried among the
// other tabs of a window that alt-tab cannot reach individually, and it carries
// browser chrome the editor does not need. Chromium-based browsers can render a
// page as its own top-level window (`--app=`), which the window manager treats
// like any other application: it has its own entry in alt-tab and in the
// taskbar. GNOME Web offers the same through `--application-mode`.
//
// A dedicated profile directory keeps the window out of the user's everyday
// browsing session (own window, own icon, remembered size) and is reused across
// runs so the window comes back where it was left.

import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { delimiter, join } from 'path'

// Chromium-based browsers first: `--app` gives the closest thing to a native
// application window. Ordered by how likely the user considers them their
// browser, most specific name first.
const CHROMIUM_BINARIES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  'brave-browser',
  'vivaldi-stable',
  'vivaldi',
  'microsoft-edge-stable',
  'microsoft-edge',
]

const WINDOW_SIZE = '1200,900'
const WM_CLASS = 'gakoy-collab'

function which(binary) {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  return dirs.map(dir => join(dir, binary)).find(existsSync)
}

function profileDir() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const dir = join(base, 'gakoy-collab', 'window-profile')
  try {
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return join(tmpdir(), 'gakoy-collab-window-profile')
  }
}

function commandFor(url) {
  for (const binary of CHROMIUM_BINARIES) {
    const bin = which(binary)
    if (bin) {
      return [bin, [
        `--app=${url}`,
        `--user-data-dir=${profileDir()}`,
        `--class=${WM_CLASS}`,
        `--window-size=${WINDOW_SIZE}`,
        '--no-first-run',
        '--no-default-browser-check',
      ]]
    }
  }

  const epiphany = which('epiphany')
  if (epiphany) {
    return [epiphany, ['--application-mode', `--profile=${profileDir()}`, url]]
  }

  // No application-mode browser available: a plain tab in the default browser
  // is still better than no window at all.
  const opener = which('xdg-open') || which('gio')
  if (opener) {
    return opener.endsWith('gio') ? [opener, ['open', url]] : [opener, [url]]
  }

  return null
}

// ── Window title ───────────────────────────────────────────────────────────

// The window title comes from the page, which knows nothing about the shared
// folder, so the title has to be set on the window itself. Several sessions can
// run at once: only windows that appeared after this launch are renamed, and
// only the first one, so a concurrent session keeps its own title.

const RENAME_INTERVAL_MS = 400
const RENAME_TIMEOUT_MS = 20000

// These commands answer in a few milliseconds, and being synchronous lets the
// window list be sampled right before the browser is spawned, with no window
// slipping in between.
function run(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// Lists the windows belonging to our application, as `{ id, title }`.
// `wmctrl -lx` also reports the class, which keeps the utility windows a
// browser creates for itself out of the way; `xdotool` is the fallback when
// wmctrl is missing.
function listWindows() {
  if (which('wmctrl')) {
    const out = run('wmctrl', ['-lx'])
    if (out === null) return null
    return out
      .split('\n')
      .map(line => line.trim().match(/^(\S+)\s+\S+\s+(\S+)\s+\S+\s*(.*)$/))
      .filter(match => match && match[2].endsWith(`.${WM_CLASS}`))
      .map(match => ({ id: match[1], title: match[3] }))
  }

  if (which('xdotool')) {
    // An empty search exits non-zero, which is not an error here.
    const out = run('xdotool', ['search', '--class', WM_CLASS]) || ''
    return out
      .split('\n')
      .filter(Boolean)
      .map(id => ({ id, title: (run('xdotool', ['getwindowname', id]) || '').trim() }))
  }

  return null
}

function setWindowTitle(id, title) {
  if (which('wmctrl')) return run('wmctrl', ['-i', '-r', id, '-T', title])
  if (which('xdotool')) return run('xdotool', ['set_window', '--name', title, id])
}

// Waits for the window to be mapped, then titles it. The browser retitles the
// window from the page title once the page has loaded, which happens after the
// window appears, so the title is reapplied until the end of the window: the
// page never changes its title afterwards, so the last word is ours.
//
// Best effort: on Wayland without XWayland, or without wmctrl and xdotool, the
// window simply keeps the title the page gives it.
async function titleNewWindow(title, before) {
  const deadline = Date.now() + RENAME_TIMEOUT_MS
  let target = null

  while (Date.now() < deadline) {
    const windows = listWindows()
    if (windows === null) return

    // The window of this launch is the one that was not there before it.
    const window = target
      ? windows.find(candidate => candidate.id === target)
      : windows.find(candidate => !before.has(candidate.id))

    if (window) {
      target = window.id
      if (window.title !== title) setWindowTitle(window.id, title)
    }

    await new Promise(resolve => setTimeout(resolve, RENAME_INTERVAL_MS).unref())
  }
}

// Returns true when a window was launched, false when the URL has to be opened
// by hand. Never throws: failing to open a window must not stop the session.
// `title` replaces the page title of the launched window, when the desktop
// allows it.
export function openAppWindow(url, title) {
  // No display server (ssh session, container, CI): there is no window to open.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false

  const command = commandFor(url)
  if (!command) return false

  const before = new Set((listWindows() || []).map(window => window.id))

  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
    if (title) titleNewWindow(title, before)
    return true
  } catch {
    return false
  }
}
