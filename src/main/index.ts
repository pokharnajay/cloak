import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, dialog, screen, globalShortcut, Notification, Tray, Menu, nativeImage, nativeTheme, shell, systemPreferences } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, createReadStream, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { ControlPlane } from './claude/control-plane'
import { ensureSkills, type SkillStatus } from './skills/installer'
import { fetchCatalog, listInstalled, installPlugin, uninstallPlugin } from './marketplace/catalog'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import { getCliEnv } from './cli-env'
import { IS_MAC, IS_WIN, encodeCwdForSession, openInTerminal, captureScreenshot, getPrimaryShortcut, findWhisper, checkProviders, installCodexCli } from './platform'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, EnrichedError } from '../shared/types'

if (IS_WIN && app && app.disableHardwareAcceleration) { app.disableHardwareAcceleration() }

// ─── Global error safety net ───
process.on('uncaughtException', (err) => {
  _log('main', `UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`)
  // Show in-app if window exists, never crash silently
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clui:provider-toast', { type: 'error', message: `Unexpected error: ${err.message}` })
    }
  } catch {}
})
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  _log('main', `UNHANDLED REJECTION: ${msg}`)
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clui:provider-toast', { type: 'error', message: `Async error: ${msg}` })
    }
  } catch {}
})

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === '1'

// ─── Persistent settings ───

const SETTINGS_PATH = join(homedir(), '.claude', 'clui-settings.json')

function loadSettings(): Record<string, unknown> {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {}
  return {}
}

function saveSettings(partial: Record<string, unknown>): void {
  try {
    const current = loadSettings()
    writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, ...partial }, null, 2))
  } catch {}
}

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0
let contentProtectionEnabled = true

// Feature flag: enable PTY interactive permissions transport
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === '1'

const controlPlane = new ControlPlane(INTERACTIVE_PTY)

// Keep native width fixed to avoid renderer animation vs setBounds race.
// The UI itself still launches in compact mode; extra width is transparent/click-through.
const BAR_WIDTH = 1040
const PILL_HEIGHT = 720  // Fixed native window height — extra room for expanded UI + shadow buffers
const PILL_BOTTOM_MARGIN = 24

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
    `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
    `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
    `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
    `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
    `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}


// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('clui:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('clui:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('clui:enriched-error', tabId, error)
})

// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  // Restore saved position if valid, otherwise default to center-bottom
  const saved = loadSettings()
  const savedX = typeof saved.windowX === 'number' ? saved.windowX : null
  const savedY = typeof saved.windowY === 'number' ? saved.windowY : null
  const x = savedX ?? (dx + Math.round((screenWidth - BAR_WIDTH) / 2))
  const y = savedY ?? (dy + screenHeight - PILL_HEIGHT - PILL_BOTTOM_MARGIN)

  mainWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    ...(IS_MAC ? { type: 'panel' as const } : {}),  // NSPanel — non-activating, joins all spaces
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    show: false,
    icon: join(__dirname, `../../resources/${IS_MAC ? 'icon.icns' : IS_WIN ? 'icon.ico' : 'icon.png'}`),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,   // Required for <webview> element in renderer
    },
  })

  // Belt-and-suspenders: panel already joins all spaces and floats,
  // but explicit flags ensure correct behavior on older Electron builds.
  if (IS_MAC) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    mainWindow.setAlwaysOnTop(true, 'floating')
  }
  // Default to hidden from screen sharing — user can enable in settings.
  mainWindow.setContentProtection(true)
  // Exclude from window list so screen sharing tools don't show it as a selectable window
  if (IS_MAC) mainWindow.excludedFromShownWindowsMenu = true

  // Persist window position when user drags it
  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [wx, wy] = mainWindow.getPosition()
    saveSettings({ windowX: wx, windowY: wy })
  })

  // Allow webview popup windows to open
  mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      // Redirect any popup back into the webview itself (login flows, OAuth)
      webviewContents.loadURL(url)
      return { action: 'deny' }
    })
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // Re-assert after show — macOS requires this for the first appearance to prevent
    // the window from sliding with Spaces during three-finger swipes.
    if (IS_MAC && mainWindow) {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
    }
    // Enable OS-level click-through for transparent regions.
    // { forward: true } ensures mousemove events still reach the renderer
    // so it can toggle click-through off when cursor enters interactive UI.
    mainWindow?.setIgnoreMouseEvents(true, { forward: true })

    // Pre-request Screen Recording permission now that a window is visible.
    // desktopCapturer.getSources() is the only API that triggers macOS TCC registration.
    // Must run with an active window — calling it before show() is unreliable.
    if (IS_MAC) {
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .catch(() => {}) // silent — just registers the app in TCC list
    }
  })

  // Block DevTools in production — prevents source inspection
  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools()
    })
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      // Block F12 and common DevTools shortcuts
      if (
        input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I') ||
        (input.meta && input.alt && input.key === 'I')
      ) {
        _event.preventDefault()
      }
    })
  }

  // Re-assert alwaysOnTop aggressively — ensures overlay stays above all other windows
  const reassertOnTop = () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      if (IS_MAC) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      } else {
        mainWindow.setAlwaysOnTop(true, 'floating')
      }
    }
  }

  // Re-assert on blur (when user clicks another app)
  mainWindow.on('blur', reassertOnTop)
  // Re-assert when any other browser window gets focus
  app.on('browser-window-blur', reassertOnTop)
  // Periodic re-assertion every 2 seconds as safety net
  setInterval(reassertOnTop, 2000)

  let forceQuit = false
  app.on('before-quit', () => { forceQuit = true })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(source = 'unknown'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const toggleId = ++toggleSequence

  // Position on the display where the cursor currently is (not always primary)
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: sw, height: sh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  // Restore saved position if on the same display; otherwise center-bottom on cursor's display
  const saved = loadSettings()
  const savedX = typeof saved.windowX === 'number' ? saved.windowX : null
  const savedY = typeof saved.windowY === 'number' ? saved.windowY : null
  let targetX = dx + Math.round((sw - BAR_WIDTH) / 2)
  let targetY = dy + sh - PILL_HEIGHT - PILL_BOTTOM_MARGIN
  if (savedX != null && savedY != null) {
    const savedDisplay = screen.getDisplayNearestPoint({ x: savedX, y: savedY })
    if (savedDisplay.id === display.id) { targetX = savedX; targetY = savedY }
  }

  mainWindow.setBounds({ x: targetX, y: targetY, width: BAR_WIDTH, height: PILL_HEIGHT })

  // Always re-assert space membership and top-level position (macOS only)
  if (IS_MAC) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    mainWindow.setAlwaysOnTop(true, 'floating')
  }

  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source} move-to-display id=${display.id}`)
    snapshotWindowState(`showWindow#${toggleId} pre-show`)
  }
  // As an accessory app (app.dock.hide), show() + focus gives keyboard
  // without deactivating the active app — hover preserved everywhere.
  mainWindow.show()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide()
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
  } else {
    showWindow(source)
  }
}

// ─── Clipboard (main-process route — works regardless of window focus) ───
ipcMain.on('clui:copy-to-clipboard', (_event, text: string) => {
  try { clipboard.writeText(String(text)) } catch {}
})

// ─── Resize ───
// Fixed-height mode: ignore renderer resize events to prevent jank.
// The native window stays at PILL_HEIGHT; all expand/collapse happens inside the renderer.

ipcMain.on(IPC.RESIZE_HEIGHT, () => {
  // No-op — fixed height window, no dynamic resize
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  mainWindow?.hide()
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore: boolean, options?: { forward?: boolean }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {})
  }
})

// ─── IPC Handlers (typed, strict) ───

function execCLIAsync(cmd: string, timeout = 5000): Promise<string> {
  const { execFile } = require('child_process') as typeof import('child_process')
  return new Promise((resolve) => {
    execFile(cmd.split(' ')[0], cmd.split(' ').slice(1), {
      encoding: 'utf-8', timeout, env: getCliEnv(), shell: IS_WIN,
    }, (err: Error | null, stdout: string) => {
      resolve(err ? '' : (stdout || '').trim())
    })
  })
}

ipcMain.handle(IPC.START, async () => {
  log('IPC START — fetching static CLI info')
  const [version, authRaw, mcpRaw] = await Promise.all([
    execCLIAsync('claude -v').catch(() => 'unknown'),
    execCLIAsync('claude auth status').catch(() => ''),
    execCLIAsync('claude mcp list').catch(() => ''),
  ])
  let auth: { email?: string; subscriptionType?: string; authMethod?: string } = {}
  try { if (authRaw) auth = JSON.parse(authRaw) } catch {}
  const mcpServers = mcpRaw ? mcpRaw.split('\n').filter(Boolean) : []
  return { version: version || 'unknown', auth, mcpServers, projectPath: process.cwd(), homePath: require('os').homedir(), platform: process.platform }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.on(IPC.INIT_SESSION, (_event, tabId: string) => {
  log(`IPC INIT_SESSION: ${tabId}`)
  controlPlane.initSession(tabId)
})

ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId: string) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`)
  controlPlane.resetTabSession(tabId)
})

ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
  }

  if (!tabId) {
    throw new Error('No tabId provided — prompt rejected')
  }
  if (!requestId) {
    throw new Error('No requestId provided — prompt rejected')
  }

  try {
    await controlPlane.submitPrompt(tabId, requestId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`PROMPT error: ${msg}`)
    throw err
  }
})

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`)
  return controlPlane.retry(tabId, requestId, options)
})

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  controlPlane.closeTab(tabId)
})

ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode: string) => {
  if (mode !== 'ask' && mode !== 'auto' && mode !== 'plan') {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`)
    return
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`)
  controlPlane.setPermissionMode(mode)
})

// ─── Provider management ───

ipcMain.handle(IPC.CHECK_PROVIDERS, () => {
  log('IPC CHECK_PROVIDERS')
  return checkProviders()
})

ipcMain.handle(IPC.INSTALL_CODEX, async () => {
  log('IPC INSTALL_CODEX: starting installation')
  // Send toast: installing
  mainWindow?.webContents.send(IPC.PROVIDER_TOAST, {
    type: 'info',
    message: 'Installing Codex CLI (npm install -g @openai/codex)...',
  })
  const result = await installCodexCli((msg) => log(`[codex-install] ${msg}`))
  if (result.ok) {
    mainWindow?.webContents.send(IPC.PROVIDER_TOAST, {
      type: 'success',
      message: 'Codex CLI installed successfully! You can now use Codex models.',
    })
  } else {
    mainWindow?.webContents.send(IPC.PROVIDER_TOAST, {
      type: 'error',
      message: `Failed to install Codex CLI: ${result.error || 'Unknown error'}`,
    })
  }
  return result
})

ipcMain.on(IPC.SET_CONTENT_PROTECTION, (_event, protect: boolean) => {
  contentProtectionEnabled = protect
  mainWindow?.setContentProtection(protect)
  log(`Content protection ${protect ? 'ON' : 'OFF'}`)
})

ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }: { tabId: string; questionId: string; optionId: string }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`)
  return controlPlane.respondToPermission(tabId, questionId, optionId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath?: string) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    // Claude stores project sessions at ~/.claude/projects/<encoded-path>/
    // Path encoding: replace all '/' with '-' (leading '/' becomes leading '-')
    const encodedPath = encodeCwdForSession(cwd)
    const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath)
    if (!existsSync(sessionsDir)) {
      log(`LIST_SESSIONS: directory not found: ${sessionsDir}`)
      return []
    }
    const files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl'))

    const sessions: Array<{ sessionId: string; slug: string | null; firstMessage: string | null; lastTimestamp: string; size: number }> = []

    // UUID v4 regex — only consider files named as valid UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    for (const file of files) {
      // The filename (without .jsonl) IS the canonical resume ID for `claude --resume`
      const fileSessionId = file.replace(/\.jsonl$/, '')
      if (!UUID_RE.test(fileSessionId)) continue // skip non-UUID files

      const filePath = join(sessionsDir, file)
      const stat = statSync(filePath)
      if (stat.size < 100) continue // skip trivially small files

      // Read lines to extract metadata and validate transcript schema
      const meta: { validated: boolean; slug: string | null; firstMessage: string | null; lastTimestamp: string | null } = {
        validated: false, slug: null, firstMessage: null, lastTimestamp: null,
      }

      await new Promise<void>((resolve) => {
        const rl = createInterface({ input: createReadStream(filePath) })
        rl.on('line', (line: string) => {
          try {
            const obj = JSON.parse(line)
            // Validate: must have expected Claude transcript fields
            if (!meta.validated && obj.type && obj.uuid && obj.timestamp) {
              meta.validated = true
            }
            if (obj.slug && !meta.slug) meta.slug = obj.slug
            if (obj.timestamp) meta.lastTimestamp = obj.timestamp
            if (obj.type === 'user' && !meta.firstMessage) {
              const content = obj.message?.content
              if (typeof content === 'string') {
                meta.firstMessage = content.substring(0, 100)
              } else if (Array.isArray(content)) {
                const textPart = content.find((p: any) => p.type === 'text')
                meta.firstMessage = textPart?.text?.substring(0, 100) || null
              }
            }
          } catch {}
          // Read all lines to get the last timestamp
        })
        rl.on('close', () => resolve())
      })

      if (meta.validated) {
        sessions.push({
          sessionId: fileSessionId,
          slug: meta.slug,
          firstMessage: meta.firstMessage,
          lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
          size: stat.size,
        })
      }
    }

    // Sort by last timestamp, most recent first
    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    return sessions.slice(0, 20) // Return top 20
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`)
    return []
  }
})

// Load conversation history from a session's JSONL file
ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg: { sessionId: string; projectPath?: string } | string) => {
  const sessionId = typeof arg === 'string' ? arg : arg.sessionId
  const projectPath = typeof arg === 'string' ? undefined : arg.projectPath
  log(`IPC LOAD_SESSION ${sessionId}${projectPath ? ` (path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    const encodedPath = encodeCwdForSession(cwd)
    const filePath = join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)
    if (!existsSync(filePath)) return []

    const messages: Array<{ role: string; content: string; toolName?: string; timestamp: number }> = []
    await new Promise<void>((resolve) => {
      const rl = createInterface({ input: createReadStream(filePath) })
      rl.on('line', (line: string) => {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const content = obj.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (Array.isArray(content)) {
              text = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (text) {
              messages.push({ role: 'user', content: text, timestamp: new Date(obj.timestamp).getTime() })
            }
          } else if (obj.type === 'assistant') {
            const content = obj.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({ role: 'assistant', content: block.text, timestamp: new Date(obj.timestamp).getTime() })
                } else if (block.type === 'tool_use' && block.name) {
                  messages.push({
                    role: 'tool',
                    content: '',
                    toolName: block.name,
                    timestamp: new Date(obj.timestamp).getTime(),
                  })
                }
              }
            }
          }
        } catch {}
      })
      rl.on('close', () => resolve())
    })
    return messages
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`)
    return []
  }
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // Block OS dialogs in stealth mode — they're visible in screen sharing
  if (contentProtectionEnabled) {
    broadcast('clui:stealth-blocked', 'File dialogs are hidden in stealth mode. Turn off "Visible in screen sharing" first.')
    return null
  }
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Unparented avoids modal dimming on the transparent overlay.
  // Activation is fine here — user is actively interacting with CLUI.
  if (IS_MAC) app.focus()
  const options = { properties: ['openDirectory'] as const }
  const result = IS_MAC
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Only allow http(s) links from markdown content.
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // Block OS dialogs in stealth mode
  if (contentProtectionEnabled) {
    broadcast('clui:stealth-blocked', 'File dialogs are hidden in stealth mode. Turn off "Visible in screen sharing" first.')
    return null
  }
  // macOS: activate app so unparented dialog appears on top
  if (IS_MAC) app.focus()
  const options = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml'] },
    ],
  }
  const result = IS_MAC
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.yaml': 'text/yaml', '.toml': 'text/toml',
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size,
    }
  })
})

ipcMain.handle(IPC.TAKE_SCREENSHOT, async (_event, screenshotMode: string = 'region') => {
  if (!mainWindow) return null
  const { tmpdir } = require('os')
  const { join } = require('path')
  const { writeFileSync, readFileSync } = require('fs')

  // Hide overlay instantly
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 150))

  try {
    // Step 1: Capture using Electron's desktopCapturer (in-process, no PowerShell)
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { width, height } = display.size
    const scaleFactor = display.scaleFactor || 1

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) },
    })
    if (!sources || sources.length === 0) {
      // Permission denied — desktopCapturer returns empty when Screen Recording is not granted.
      // macOS has now added Cloak to the TCC list; prompt user to enable it.
      if (contentProtectionEnabled) {
        broadcast('clui:stealth-blocked', 'Screenshots need Screen Recording permission. Enable Cloak in System Settings > Privacy & Security > Screen Recording.')
      } else {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Screen Recording Permission Required',
          message: 'Cloak needs Screen Recording permission to take screenshots.',
          detail: 'Enable Cloak in System Settings > Privacy & Security > Screen Recording, then try again.',
          buttons: ['Open Settings', 'Cancel'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        })
      }
      return null
    }

    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0]
    const fullImage = source.thumbnail
    if (fullImage.isEmpty()) return null

    let finalBuffer: Buffer

    if (screenshotMode === 'fullscreen') {
      // Full screen mode — no region selector
      finalBuffer = fullImage.toPNG()
    } else {
      // Region mode — show selector overlay
      const imgSize = fullImage.getSize()
      const imgW = imgSize.width
      const imgH = imgSize.height
      const fullBase64 = fullImage.toPNG().toString('base64')

      const region = await new Promise<{ x: number; y: number; w: number; h: number } | null>((resolve) => {
        const selWin = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          movable: false,
          hasShadow: false,
          minimizable: false,
          maximizable: false,
          transparent: false,
          backgroundColor: '#000000',
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        })
        selWin.setAlwaysOnTop(true, 'screen-saver')
        // Inherit content protection so region selector is also hidden
        // from screen sharing when the setting is off.
        selWin.setContentProtection(contentProtectionEnabled)
        selWin.setSimpleFullScreen(true)

        const html = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;cursor:crosshair;background:#000}
#bg{position:fixed;inset:0;width:100vw;height:100vh;object-fit:fill}
#dim{position:fixed;inset:0;background:rgba(0,0,0,0.25);pointer-events:none}
#sel{position:fixed;border:2px solid #2CB1BC;background:rgba(44,177,188,0.12);display:none;z-index:10;box-shadow:0 0 0 9999px rgba(0,0,0,0.35)}
#tip{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);color:#fff;font:14px/1 system-ui;background:rgba(0,0,0,0.6);padding:8px 18px;border-radius:20px;z-index:5;pointer-events:none}
</style></head><body>
<img id="bg" src="data:image/png;base64,${fullBase64}"/>
<div id="dim"></div>
<div id="sel"></div>
<div id="tip">Drag to select \u2022 Esc = full screen</div>
<script>
const sel=document.getElementById('sel'),tip=document.getElementById('tip'),dim=document.getElementById('dim')
const imgW=${imgW},imgH=${imgH}
let sx=0,sy=0,drag=false
requestAnimationFrame(()=>{
const winW=window.innerWidth,winH=window.innerHeight
const rx=imgW/winW,ry=imgH/winH
document.addEventListener('mousedown',e=>{sx=e.clientX;sy=e.clientY;drag=true;sel.style.display='block';sel.style.left=sx+'px';sel.style.top=sy+'px';sel.style.width='0';sel.style.height='0';tip.style.display='none';dim.style.display='none'})
document.addEventListener('mousemove',e=>{if(!drag)return;const x=Math.min(e.clientX,sx),y=Math.min(e.clientY,sy),w=Math.abs(e.clientX-sx),h=Math.abs(e.clientY-sy);sel.style.left=x+'px';sel.style.top=y+'px';sel.style.width=w+'px';sel.style.height=h+'px'})
document.addEventListener('mouseup',e=>{if(!drag)return;drag=false;const x=Math.min(e.clientX,sx),y=Math.min(e.clientY,sy),w=Math.abs(e.clientX-sx),h=Math.abs(e.clientY-sy);if(w>10&&h>10){document.title='R:'+JSON.stringify({x:Math.round(x*rx),y:Math.round(y*ry),w:Math.round(w*rx),h:Math.round(h*ry)})}else{document.title='F'}})
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.title='F'})
})
</script></body></html>`

        const tmpHtml = join(tmpdir(), `clui-sel-${Date.now()}.html`)
        writeFileSync(tmpHtml, html)
        selWin.loadFile(tmpHtml)

        const poll = () => {
          if (selWin.isDestroyed()) { resolve(null); return }
          const t = selWin.getTitle()
          if (t.startsWith('R:')) {
            try { const r = JSON.parse(t.slice(2)); selWin.close(); resolve(r) }
            catch { selWin.close(); resolve(null) }
          } else if (t === 'F') {
            selWin.close(); resolve(null)
          } else { setTimeout(poll, 30) }
        }
        selWin.once('ready-to-show', () => setTimeout(poll, 50))
        selWin.on('closed', () => resolve(null))
      })

      if (region && region.w > 10 && region.h > 10) {
        const cropped = fullImage.crop({ x: region.x, y: region.y, width: region.w, height: region.h })
        finalBuffer = cropped.toPNG()
      } else {
        finalBuffer = fullImage.toPNG()
      }
    }

    const screenshotPath = join(tmpdir(), `clui-screenshot-${Date.now()}.png`)
    writeFileSync(screenshotPath, finalBuffer)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${finalBuffer.toString('base64')}`,
      size: finalBuffer.length,
    }
  } catch (err) {
    log(`Screenshot error: ${err}`)
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
    }
    broadcast(IPC.WINDOW_SHOWN)
  }
})

let pasteCounter = 0
ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    // Parse data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `clui-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length,
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64: string) => {
  const { writeFileSync, existsSync, unlinkSync, readFileSync } = require('fs')
  const { execSync } = require('child_process')
  const { join } = require('path')
  const { tmpdir } = require('os')

  const whisperResult = findWhisper()
  if ('error' in whisperResult) {
    return { error: whisperResult.error, transcript: null }
  }
  const { bin: whisperBin, model: modelPath, isWhisperCpp, isEnglishOnly } = whisperResult

  const tmpWav = join(tmpdir(), `clui-voice-${Date.now()}.wav`)
  try {
    const buf = Buffer.from(audioBase64, 'base64')
    writeFileSync(tmpWav, buf)

    log(`Transcribing with: ${whisperBin} (model: ${modelPath || 'default'}, lang: ${isEnglishOnly ? 'en' : 'auto'})`)

    let output: string
    if (isWhisperCpp) {
      const langFlag = isEnglishOnly ? '-l en' : '-l auto'
      output = execSync(
        `"${whisperBin}" -m "${modelPath}" -f "${tmpWav}" --no-timestamps ${langFlag}`,
        { encoding: 'utf-8', timeout: 30000 }
      )
    } else {
      // Python whisper: auto-detect language unless English-only model
      const langFlag = isEnglishOnly ? '--language en' : ''
      output = execSync(
        `"${whisperBin}" "${tmpWav}" --model tiny ${langFlag} --output_format txt --output_dir "${tmpdir()}"`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      // Python whisper writes .txt file
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        try { unlinkSync(txtPath) } catch {}
        return { error: null, transcript }
      }
      // File not created — Python whisper failed silently
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null,
      }
    }

    // whisper-cpp prints to stdout directly
    // Strip timestamp patterns and known hallucination outputs
    const HALLUCINATIONS = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i
    const transcript = output
      .replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '')
      .trim()

    if (HALLUCINATIONS.test(transcript)) {
      return { error: null, transcript: '' }
    }

    return { error: null, transcript: transcript || '' }
  } catch (err: any) {
    log(`Transcription error: ${err.message}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
    }
  } finally {
    try { unlinkSync(tmpWav) } catch {}
  }
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: INTERACTIVE_PTY ? 'pty' : 'stream-json',
  }
})

ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
  let sessionId: string | null = null
  let projectPath: string = process.cwd()
  if (typeof arg === 'string') {
    sessionId = arg
  } else if (arg && typeof arg === 'object') {
    sessionId = arg.sessionId ?? null
    projectPath = arg.projectPath && arg.projectPath !== '~' ? arg.projectPath : process.cwd()
  }
  return openInTerminal(sessionId, projectPath, (msg) => log(msg))
})

// ─── Native OS Notifications ───

ipcMain.on('clui:notify', (_event, { title, body, urgency }: { title: string; body: string; urgency?: 'normal' | 'critical' }) => {
  if (!mainWindow || mainWindow.isVisible()) return // Only notify when hidden
  // Suppress OS notifications when content protection is on (hidden from screen sharing)
  if (contentProtectionEnabled) return
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title,
    body,
    icon: join(__dirname, '../../resources/icon.png'),
    urgency: urgency || 'normal',
  })
  notification.on('click', () => {
    showWindow('notification click')
  })
  notification.show()
})

// ─── Marketplace IPC ───

ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log('IPC MARKETPLACE_FETCH')
  try {
    return await fetchCatalog(forceRefresh)
  } catch (err: any) {
    log(`MARKETPLACE_FETCH error: ${err.message}`)
    return { plugins: [], error: 'Failed to load marketplace. Check your internet connection.' }
  }
})

ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log('IPC MARKETPLACE_INSTALLED')
  try {
    return await listInstalled()
  } catch (err: any) {
    log(`MARKETPLACE_INSTALLED error: ${err.message}`)
    return []
  }
})

ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }: { repo: string; pluginName: string; marketplace: string; sourcePath?: string; isSkillMd?: boolean }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`)
  try {
    return await installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd)
  } catch (err: any) {
    log(`MARKETPLACE_INSTALL error: ${err.message}`)
    return { ok: false, error: `Install failed: ${err.message}` }
  }
})

ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }: { pluginName: string }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`)
  try {
    return await uninstallPlugin(pluginName)
  } catch (err: any) {
    log(`MARKETPLACE_UNINSTALL error: ${err.message}`)
    return { ok: false, error: `Uninstall failed: ${err.message}` }
  }
})

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── Keyboard Shortcuts (user-configurable, persisted) ───

interface ShortcutConfig {
  toggleOverlay: string
  toggleOverlayAlt: string
  screenshotAsk: string
}

const SHORTCUTS_PATH = join(homedir(), '.claude', 'clui-shortcuts.json')

const DEFAULT_SHORTCUTS: ShortcutConfig = IS_MAC
  ? { toggleOverlay: 'Alt+Space', toggleOverlayAlt: 'Command+Shift+K', screenshotAsk: 'Alt+Shift+S' }
  : { toggleOverlay: 'Ctrl+Space', toggleOverlayAlt: 'Ctrl+Shift+K', screenshotAsk: 'Ctrl+Shift+S' }

function loadShortcuts(): ShortcutConfig {
  try {
    if (existsSync(SHORTCUTS_PATH)) {
      const raw = readFileSync(SHORTCUTS_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SHORTCUTS, ...parsed }
    }
  } catch {}
  return { ...DEFAULT_SHORTCUTS }
}

function saveShortcuts(shortcuts: ShortcutConfig): void {
  try {
    const dir = join(homedir(), '.claude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SHORTCUTS_PATH, JSON.stringify(shortcuts, null, 2))
  } catch {}
}

let currentShortcuts = loadShortcuts()

/** Returns an object mapping shortcut names to whether registration succeeded */
function registerAllShortcuts(): Record<string, boolean> {
  globalShortcut.unregisterAll()

  log(`Registering shortcuts: ${JSON.stringify(currentShortcuts)}`)
  const results: Record<string, boolean> = {}

  const tryRegister = (accel: string, handler: () => void, label: string, fallback: string): boolean => {
    if (!accel) return false
    try {
      const ok = globalShortcut.register(accel, handler)
      if (ok) {
        log(`Shortcut registered: ${label} → ${accel}`)
        return true
      }
      log(`Shortcut registration failed: ${label} (${accel}), trying fallback: ${fallback}`)
      // If the user's shortcut fails (e.g., OS reserved), fall back to default
      if (fallback && fallback !== accel) {
        const fallbackOk = globalShortcut.register(fallback, handler)
        if (fallbackOk) {
          log(`Shortcut fallback registered: ${label} → ${fallback}`)
          return false // report failure so UI knows
        }
      }
      return false
    } catch (err: any) {
      log(`Shortcut registration error: ${label} (${accel}) — ${err.message}`)
      return false
    }
  }

  results.toggleOverlay = tryRegister(
    currentShortcuts.toggleOverlay,
    () => toggleWindow(`shortcut ${currentShortcuts.toggleOverlay}`),
    'toggleOverlay',
    DEFAULT_SHORTCUTS.toggleOverlay,
  )
  results.toggleOverlayAlt = tryRegister(
    currentShortcuts.toggleOverlayAlt,
    () => toggleWindow(`shortcut ${currentShortcuts.toggleOverlayAlt}`),
    'toggleOverlayAlt',
    DEFAULT_SHORTCUTS.toggleOverlayAlt,
  )
  results.screenshotAsk = tryRegister(
    currentShortcuts.screenshotAsk,
    () => { log('Screenshot+Ask shortcut triggered'); handleScreenshotAsk() },
    'screenshotAsk',
    DEFAULT_SHORTCUTS.screenshotAsk,
  )

  return results
}

async function handleScreenshotAsk(): Promise<void> {
  if (!mainWindow) return

  // Hide overlay, capture full screen, show overlay with screenshot attached
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 150))

  try {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const scaleFactor = display.scaleFactor || 1
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * scaleFactor), height: Math.round(display.size.height * scaleFactor) },
    })
    if (!sources || sources.length === 0) {
      // Permission denied — macOS has now added Cloak to TCC list; prompt user to enable it.
      showWindow('screenshot-ask fallback')
      if (contentProtectionEnabled) {
        broadcast('clui:stealth-blocked', 'Screenshots need Screen Recording permission. Enable Cloak in System Settings > Privacy & Security > Screen Recording.')
      } else {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Screen Recording Permission Required',
          message: 'Cloak needs Screen Recording permission to take screenshots.',
          detail: 'Enable Cloak in System Settings > Privacy & Security > Screen Recording, then try again.',
          buttons: ['Open Settings', 'Cancel'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        })
      }
      return
    }

    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0]
    const image = source.thumbnail
    if (image.isEmpty()) { showWindow('screenshot-ask fallback'); return }

    const { tmpdir: _tmpdir } = require('os')
    const buf = image.toPNG()
    const screenshotPath = join(_tmpdir(), `clui-screenshot-${Date.now()}.png`)
    writeFileSync(screenshotPath, buf)

    showWindow('screenshot-ask')
    broadcast(IPC.SCREENSHOT_ASK, {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length,
    })
  } catch (err) {
    log(`Screenshot+Ask error: ${err}`)
    showWindow('screenshot-ask fallback')
  }
}

ipcMain.handle(IPC.GET_SHORTCUTS, () => {
  return { shortcuts: currentShortcuts, defaults: DEFAULT_SHORTCUTS, platform: IS_MAC ? 'mac' : 'win' }
})

ipcMain.handle(IPC.SET_SHORTCUTS, (_event, shortcuts: ShortcutConfig) => {
  log(`IPC SET_SHORTCUTS: ${JSON.stringify(shortcuts)}`)
  const previous = { ...currentShortcuts }
  currentShortcuts = { ...DEFAULT_SHORTCUTS, ...shortcuts }
  const results = registerAllShortcuts()

  // Revert any failed shortcuts to their previous values
  let anyFailed = false
  for (const [key, ok] of Object.entries(results)) {
    if (!ok) {
      anyFailed = true;
      (currentShortcuts as any)[key] = (previous as any)[key]
    }
  }

  saveShortcuts(currentShortcuts)
  // Re-register with reverted values if anything failed
  if (anyFailed) registerAllShortcuts()

  return { ok: !anyFailed, results, shortcuts: currentShortcuts }
})

// ─── Permission Preflight ───
// Request all required macOS permissions upfront on first launch so the user
// is never interrupted mid-session by a permission prompt.

async function requestPermissions(): Promise<void> {
  if (!IS_MAC) return

  // ── Accessibility (required for global shortcuts like ⌥+Space) ──
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true)
    log(`Permission preflight: accessibility ${trusted ? 'granted' : 'requested'}`)
  } catch (err: any) {
    log(`Permission preflight: accessibility check failed — ${err.message}`)
  }

  // ── Screen Recording (required for screenshots) ──
  // Trigger the permission dialog by requesting a small capture.
  // This is the only reliable way to prompt on macOS 13+.
  try {
    const screenStatus = systemPreferences.getMediaAccessStatus('screen')
    log(`Permission preflight: screen recording status = ${screenStatus}`)
    if (screenStatus !== 'granted') {
      // desktopCapturer.getSources triggers the screen recording permission dialog
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      log('Permission preflight: screen recording permission requested')
    }
  } catch (err: any) {
    log(`Permission preflight: screen recording check failed — ${err.message}`)
  }

  // ── Microphone (for voice input via Whisper) ──
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone')
    }
    log(`Permission preflight: microphone status = ${micStatus}`)
  } catch (err: any) {
    log(`Permission preflight: microphone check failed — ${err.message}`)
  }
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  // This is how Spotlight, Alfred, Raycast work.
  if (IS_MAC && app.dock) {
    app.dock.hide()
  }

  // Request permissions upfront so the user is never interrupted mid-session.
  await requestPermissions()

  // Skill provisioning — non-blocking, streams status to renderer
  ensureSkills((status: SkillStatus) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ''}`)
    broadcast(IPC.SKILL_STATUS, status)
  }).catch((err: Error) => log(`Skill provisioning error: ${err.message}`))

  createWindow()
  snapshotWindowState('after createWindow')

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`)
      snapshotWindowState('event display-metrics-changed')
    })
  }


  registerAllShortcuts()

  // No tray icon — fully invisible. Use keyboard shortcut to toggle.

  // Auto-start on login
  if (app.isPackaged) {
    const loginSettings = app.getLoginItemSettings()
    if (!loginSettings.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
      log('Enabled auto-start on login')
    }
  }

  // app 'activate' fires when macOS brings the app to the foreground (e.g. after
  // webContents.focus() triggers applicationDidBecomeActive on some macOS versions).
  // Using showWindow here instead of toggleWindow prevents the re-entry race where
  // a summon immediately hides itself because activate fires mid-show.
  app.on('activate', () => showWindow('app activate'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  if (!IS_MAC) {
    app.quit()
  }
})
