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

import { spawn } from 'child_process'
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

// Returns true when a window was launched, false when the URL has to be opened
// by hand. Never throws: failing to open a window must not stop the session.
export function openAppWindow(url) {
  // No display server (ssh session, container, CI): there is no window to open.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false

  const command = commandFor(url)
  if (!command) return false

  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
