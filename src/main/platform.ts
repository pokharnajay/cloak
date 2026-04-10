/**
 * Platform abstraction layer — centralizes all OS-specific branching.
 *
 * macOS and Windows code paths live side-by-side. Every consumer imports
 * from here instead of scattering process.platform checks.
 */

import { execSync, execFile, spawn } from 'child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, dirname, delimiter as PATH_DELIMITER } from 'path'

// ─── Constants ───

export const IS_MAC = process.platform === 'darwin'
export const IS_WIN = process.platform === 'win32'
export { PATH_DELIMITER }

// ─── Stored Codex API key ───
// Set on startup from clui-settings.json; injected into every Codex subprocess env.
let cachedCodexApiKey: string | null = null
export function setCodexApiKey(key: string | null): void { cachedCodexApiKey = key }
export function getStoredCodexApiKey(): string | null { return cachedCodexApiKey }

// ─── CLI Path Discovery ───

let cachedCliPath: string | null = null

/**
 * Build a comprehensive PATH that includes common binary locations.
 * On macOS: probes login shells for nvm/asdf/homebrew paths.
 * On Windows: includes npm global and Program Files directories.
 */
export function getCliPath(): string {
  if (cachedCliPath) return cachedCliPath

  const ordered: string[] = []
  const seen = new Set<string>()

  function append(rawPath: string | undefined): void {
    if (!rawPath) return
    for (const entry of rawPath.split(PATH_DELIMITER)) {
      const p = entry.trim()
      if (!p || seen.has(p)) continue
      seen.add(p)
      ordered.push(p)
    }
  }

  // Start from current process PATH.
  append(process.env.PATH)

  if (IS_MAC) {
    // Common macOS binary locations (Homebrew + system).
    append('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')

    // Probe login shells so nvm/asdf/etc. PATH hooks are loaded.
    const shellCommands = [
      '/bin/zsh -ilc "echo $PATH"',
      '/bin/zsh -lc "echo $PATH"',
      '/bin/bash -lc "echo $PATH"',
    ]
    for (const cmd of shellCommands) {
      try {
        const discovered = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim()
        append(discovered)
      } catch {}
    }
  } else if (IS_WIN) {
    // Common Windows binary locations for npm global installs.
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    append(join(appData, 'npm'))
    append(join(homedir(), '.npm-global'))
    if (process.env.ProgramFiles) append(join(process.env.ProgramFiles, 'nodejs'))
    if (process.env['ProgramFiles(x86)']) append(join(process.env['ProgramFiles(x86)']!, 'nodejs'))
  }

  cachedCliPath = ordered.join(PATH_DELIMITER)
  return cachedCliPath
}

/**
 * Build a complete environment for spawning CLI subprocesses.
 * Injects stored Codex API key if one has been saved and OPENAI_API_KEY isn't already set.
 */
export function getCliEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    PATH: getCliPath(),
  }
  delete env.CLAUDECODE
  if (cachedCodexApiKey && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = cachedCodexApiKey
  }
  return env
}

// ─── Claude Binary Discovery ───

let cachedClaudeBinary: string | null = null

/**
 * Find the `claude` CLI binary. Checked once, cached thereafter.
 * On macOS: Homebrew, npm-global, login-shell fallback.
 * On Windows: npm global (.cmd), `where` fallback.
 */
export function findClaudeBinary(): string {
  if (cachedClaudeBinary) return cachedClaudeBinary

  if (IS_MAC) {
    const candidates = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.npm-global/bin/claude'),
    ]
    for (const c of candidates) {
      try {
        execSync(`test -x "${c}"`, { stdio: 'ignore' })
        cachedClaudeBinary = c
        return c
      } catch {}
    }
    // Login-shell fallback
    try {
      cachedClaudeBinary = execSync('/bin/zsh -ilc "whence -p claude"', {
        encoding: 'utf-8', env: getCliEnv(),
      }).trim()
      return cachedClaudeBinary
    } catch {}
    try {
      cachedClaudeBinary = execSync('/bin/bash -lc "which claude"', {
        encoding: 'utf-8', env: getCliEnv(),
      }).trim()
      return cachedClaudeBinary
    } catch {}
  } else if (IS_WIN) {
    // npm global installs claude as claude.cmd on Windows
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const candidates = [
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude'),
      join(homedir(), '.npm-global', 'claude.cmd'),
      join(homedir(), '.npm-global', 'claude'),
    ]
    for (const c of candidates) {
      if (existsSync(c)) {
        cachedClaudeBinary = c
        return c
      }
    }
    // `where` fallback
    try {
      const result = execSync('where claude', {
        encoding: 'utf-8', timeout: 5000, env: getCliEnv(),
      }).trim()
      // `where` may return multiple lines; take the first
      const first = result.split(/\r?\n/)[0].trim()
      if (first) {
        cachedClaudeBinary = first
        return first
      }
    } catch {}
  }

  // Last resort — hope it's on PATH
  cachedClaudeBinary = 'claude'
  return 'claude'
}

// ─── Codex Binary Discovery ───

let cachedCodexBinary: string | null = null

/**
 * Find the `codex` CLI binary (OpenAI Codex CLI).
 * Returns the path if found, or null if not installed.
 * On macOS: Homebrew, npm-global, login-shell fallback.
 * On Windows: npm global (.cmd), `where` fallback.
 */
export function findCodexBinary(): string | null {
  if (cachedCodexBinary !== null) return cachedCodexBinary || null

  if (IS_MAC) {
    const candidates = [
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      join(homedir(), '.npm-global/bin/codex'),
    ]
    for (const c of candidates) {
      try {
        execSync(`test -x "${c}"`, { stdio: 'ignore' })
        cachedCodexBinary = c
        return c
      } catch {}
    }
    // Login-shell fallback
    try {
      const found = execSync('/bin/zsh -ilc "whence -p codex"', {
        encoding: 'utf-8', env: getCliEnv(), timeout: 5000,
      }).trim()
      if (found) { cachedCodexBinary = found; return found }
    } catch {}
    try {
      const found = execSync('/bin/bash -lc "which codex"', {
        encoding: 'utf-8', env: getCliEnv(), timeout: 5000,
      }).trim()
      if (found) { cachedCodexBinary = found; return found }
    } catch {}
  } else if (IS_WIN) {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const candidates = [
      join(appData, 'npm', 'codex.cmd'),
      join(appData, 'npm', 'codex'),
      join(homedir(), '.npm-global', 'codex.cmd'),
      join(homedir(), '.npm-global', 'codex'),
    ]
    for (const c of candidates) {
      if (existsSync(c)) {
        cachedCodexBinary = c
        return c
      }
    }
    // `where` fallback
    try {
      const result = execSync('where codex', {
        encoding: 'utf-8', timeout: 5000, env: getCliEnv(),
      }).trim()
      const first = result.split(/\r?\n/)[0].trim()
      if (first) { cachedCodexBinary = first; return first }
    } catch {}
  }

  // Not found
  cachedCodexBinary = ''
  return null
}

/**
 * Install the Anthropic Claude Code CLI globally via npm.
 * Works on both macOS and Windows.
 */
export async function installClaudeCli(
  log: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const npmBin = IS_WIN ? 'npm.cmd' : 'npm'
    log(`Installing Claude Code CLI via: ${npmBin} install -g @anthropic-ai/claude-code`)
    execFile(npmBin, ['install', '-g', '@anthropic-ai/claude-code'], {
      env: getCliEnv(),
      timeout: 180000,
    }, (err, _stdout, stderr) => {
      // Clear cache so next findClaudeBinary() re-discovers
      cachedClaudeBinary = null
      if (err) {
        log(`Claude Code CLI install failed: ${err.message}`)
        resolve({ ok: false, error: stderr?.trim() || err.message })
      } else {
        log('Claude Code CLI installed successfully')
        resolve({ ok: true })
      }
    })
  })
}

/**
 * Open a terminal and run a specific auth command (e.g. "claude" or "codex").
 * macOS: AppleScript → Terminal.app
 * Windows: Windows Terminal (wt.exe) → cmd.exe fallback
 */
export function openAuthTerminal(command: string, log: (msg: string) => void): boolean {
  if (IS_MAC) {
    const script = `tell application "Terminal"\n  activate\n  do script "${command}"\nend tell`
    try {
      execFile('/usr/bin/osascript', ['-e', script], (err) => {
        if (err) log(`Failed to open terminal: ${err.message}`)
        else log(`Opened terminal for auth: ${command}`)
      })
      return true
    } catch (err: unknown) {
      log(`Failed to open terminal: ${err}`)
      return false
    }
  }

  if (IS_WIN) {
    try {
      const wtExists = (() => {
        try { execSync('where wt', { stdio: 'ignore' }); return true } catch { return false }
      })()
      if (wtExists) {
        execFile('wt', ['cmd', '/k', command], (err) => {
          if (err) log(`Failed to open Windows Terminal: ${err.message}`)
          else log(`Opened Windows Terminal for auth: ${command}`)
        })
      } else {
        execFile('cmd', ['/c', 'start', 'cmd', '/k', command], (err) => {
          if (err) log(`Failed to open cmd: ${err.message}`)
          else log(`Opened cmd for auth: ${command}`)
        })
      }
      return true
    } catch (err: unknown) {
      log(`Failed to open terminal: ${err}`)
      return false
    }
  }

  return false
}

/**
 * Spawn `claude auth login` and watch stdout for the OAuth URL.
 * When found, calls onUrl(url) so the caller can open it in the system browser.
 * Resolves when login succeeds or fails.
 *
 * Claude Code stdout protocol (from source analysis of v2.1.100):
 *   Line 1: "Opening browser to sign in…"
 *   Line 2: "If the browser didn't open, visit: <URL>"
 *   On success: "Login successful."
 *   On failure (stderr): "Login failed: <reason>"
 */
export function authClaudeWithBrowser(
  log: (msg: string) => void,
  onUrl: (url: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const claudeBin = findClaudeBinary()
    log(`Spawning: ${claudeBin} auth login`)

    let settled = false
    const settle = (result: { ok: boolean; error?: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const proc = spawn(claudeBin, ['auth', 'login'], {
      env: getCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // 5-minute overall timeout
    const timeout = setTimeout(() => settle({ ok: false, error: 'Login timed out after 5 minutes' }), 5 * 60 * 1000)

    let stdoutBuf = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        log(`[claude-auth] ${trimmed}`)
        // Detect the fallback URL line
        const urlMatch = trimmed.match(/^If the browser didn'?t open,\s+visit:\s+(https:\/\/.+)$/i)
        if (urlMatch?.[1]) {
          onUrl(urlMatch[1].trim())
        }
        // Detect success
        if (/^Login successful\.?$/i.test(trimmed)) {
          clearTimeout(timeout)
          settle({ ok: true })
        }
      }
    })

    let stderrBuf = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        log(`[claude-auth stderr] ${trimmed}`)
        const failMatch = trimmed.match(/^Login failed:\s*(.+)$/i)
        if (failMatch?.[1]) {
          clearTimeout(timeout)
          settle({ ok: false, error: failMatch[1].trim() })
        }
      }
    })

    proc.on('exit', (code) => {
      clearTimeout(timeout)
      log(`[claude-auth] Exited with code ${code}`)
      if (!settled) {
        settle(code === 0 ? { ok: true } : { ok: false, error: `Claude auth exited with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      log(`[claude-auth] Spawn error: ${err.message}`)
      settle({ ok: false, error: err.message })
    })
  })
}

/**
 * Store an OpenAI API key for Codex.
 * Attempts `codex login --with-api-key` (pipes key via stdin) if Codex CLI is installed.
 * Falls back to writing ~/.codex/auth.json with the minimal API-key format if the CLI
 * rejects the flag (older versions).
 * Either way, the key is immediately available via getCliEnv() for all Codex subprocesses.
 */
export async function authCodexWithApiKey(
  apiKey: string,
  log: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) return { ok: false, error: 'API key cannot be empty' }

  // Always update the in-process cache so checkProviders/getCliEnv see it immediately.
  cachedCodexApiKey = trimmedKey

  const codexBin = findCodexBinary()
  if (codexBin) {
    // Try `codex login --with-api-key` (documented in v0.118.0)
    try {
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const proc = execFile(codexBin, ['login', '--with-api-key'], {
          env: getCliEnv(),
          timeout: 15000,
        }, (err, _stdout, stderr) => {
          if (err) resolve({ ok: false, error: stderr?.trim() || err.message })
          else resolve({ ok: true })
        })
        proc.stdin?.write(trimmedKey + '\n')
        proc.stdin?.end()
        proc.on('error', (err) => resolve({ ok: false, error: err.message }))
      })
      if (result.ok) { log('Codex API key stored via `codex login --with-api-key`'); return { ok: true } }
      log(`codex login --with-api-key failed: ${result.error} — falling back to direct write`)
    } catch (err: unknown) {
      log(`codex login spawn failed: ${err} — falling back to direct write`)
    }
  }

  // Fallback: write ~/.codex/auth.json in the API-key format Codex accepts.
  try {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    const { mkdirSync: mkdir } = require('fs') as typeof import('fs')
    mkdir(codexHome, { recursive: true })
    const authPath = join(codexHome, 'auth.json')
    writeFileSync(authPath, JSON.stringify({ auth_mode: 'api_key', api_key: trimmedKey }, null, 2), { mode: 0o600 })
    log(`Codex API key written to ${authPath}`)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
}

/**
 * Install the OpenAI Codex CLI globally via npm.
 * Works on both macOS and Windows.
 */
export async function installCodexCli(
  log: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const npmBin = IS_WIN ? 'npm.cmd' : 'npm'
    log(`Installing Codex CLI via: ${npmBin} install -g @openai/codex`)
    execFile(npmBin, ['install', '-g', '@openai/codex'], {
      env: getCliEnv(),
      timeout: 120000,
    }, (err, _stdout, stderr) => {
      // Clear cache so next findCodexBinary() re-discovers
      cachedCodexBinary = null
      if (err) {
        log(`Codex CLI install failed: ${err.message}`)
        resolve({ ok: false, error: stderr?.trim() || err.message })
      } else {
        log('Codex CLI installed successfully')
        resolve({ ok: true })
      }
    })
  })
}

/**
 * Check which AI providers have their CLI binary available.
 */
export function checkProviders(): {
  claude: { available: boolean; authenticated: boolean; binary: string | null };
  codex: { available: boolean; authenticated: boolean; binary: string | null };
} {
  const claudeBin = findClaudeBinary()
  const codexBin = findCodexBinary()

  // Claude auth: ~/.claude/.credentials.json exists
  const claudeAuth = existsSync(join(homedir(), '.claude', '.credentials.json'))

  // Codex auth: ~/.codex/auth.json exists, OPENAI_API_KEY env var set, or user stored a key in Cloak settings
  const codexAuth = !!process.env.OPENAI_API_KEY || !!cachedCodexApiKey || existsSync(join(homedir(), '.codex', 'auth.json'))

  return {
    claude: { available: !!claudeBin, authenticated: claudeAuth, binary: claudeBin },
    codex: { available: !!codexBin, authenticated: codexAuth, binary: codexBin },
  }
}

/**
 * Prepend a binary's directory to PATH using the correct delimiter.
 */
export function prependBinDir(envPath: string, binaryPath: string): string {
  const binDir = dirname(binaryPath)
  if (envPath.includes(binDir)) return envPath
  return `${binDir}${PATH_DELIMITER}${envPath}`
}

// ─── Session Path Encoding ───

/**
 * Encode a working directory path for Claude's session storage.
 * Must match Claude Code's own encoding in ~/.claude/projects/.
 *
 * macOS:  /Users/foo/bar → -Users-foo-bar  (replace / with -)
 * Windows: D:\python\clui-cc → d--python-clui-cc  (replace \, :, ., / with -)
 */
export function encodeCwdForSession(cwd: string): string {
  if (IS_MAC) {
    return cwd.replace(/\//g, '-')
  }
  // Windows: Claude Code replaces backslashes, colons, dots, and forward slashes with dashes.
  // Verified empirically against ~/.claude/projects/ directory names.
  return cwd.replace(/[\\/:.]/g, '-')
}

// ─── Open in Terminal ───

/**
 * Open a new terminal window with an optional claude --resume command.
 * macOS: AppleScript → Terminal.app
 * Windows: Windows Terminal (wt.exe) → cmd.exe fallback
 */
export function openInTerminal(
  sessionId: string | null,
  projectPath: string,
  log: (msg: string) => void,
): boolean {
  const claudeBin = 'claude'

  if (IS_MAC) {
    const projectDir = projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    let cmd: string
    if (sessionId) {
      cmd = `cd \\"${projectDir}\\" && ${claudeBin} --resume ${sessionId}`
    } else {
      cmd = `cd \\"${projectDir}\\" && ${claudeBin}`
    }
    const script = `tell application "Terminal"\n  activate\n  do script "${cmd}"\nend tell`
    try {
      execFile('/usr/bin/osascript', ['-e', script], (err: Error | null) => {
        if (err) log(`Failed to open terminal: ${err.message}`)
        else log(`Opened terminal with: ${cmd}`)
      })
      return true
    } catch (err: unknown) {
      log(`Failed to open terminal: ${err}`)
      return false
    }
  }

  if (IS_WIN) {
    const dir = projectPath.replace(/"/g, '')
    let command: string
    if (sessionId) {
      command = `cd /d "${dir}" && ${claudeBin} --resume ${sessionId}`
    } else {
      command = `cd /d "${dir}" && ${claudeBin}`
    }

    // Try Windows Terminal first, fall back to cmd.exe
    try {
      const wtExists = (() => {
        try { execSync('where wt', { stdio: 'ignore' }); return true } catch { return false }
      })()

      if (wtExists) {
        execFile('wt', ['-d', dir, 'cmd', '/k', command], (err) => {
          if (err) log(`Failed to open Windows Terminal: ${err.message}`)
          else log(`Opened Windows Terminal with: ${command}`)
        })
      } else {
        execFile('cmd', ['/c', 'start', 'cmd', '/k', command], { cwd: dir }, (err) => {
          if (err) log(`Failed to open cmd: ${err.message}`)
          else log(`Opened cmd with: ${command}`)
        })
      }
      return true
    } catch (err: unknown) {
      log(`Failed to open terminal: ${err}`)
      return false
    }
  }

  return false
}

// ─── Screenshot ───

/**
 * Capture a screenshot. Returns the file path or null.
 * macOS: Interactive region selection via screencapture -i.
 * Windows: Snipping Tool for interactive selection, read from clipboard.
 */
export async function captureScreenshot(
  log: (msg: string) => void,
): Promise<{ path: string; buffer: Buffer } | null> {
  const timestamp = Date.now()

  if (IS_MAC) {
    const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)
    try {
      execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
        timeout: 30000, stdio: 'ignore',
      })
      if (!existsSync(screenshotPath)) return null
      const buffer = readFileSync(screenshotPath)
      return { path: screenshotPath, buffer }
    } catch {
      return null
    }
  }

  if (IS_WIN) {
    try {
      const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)

      // Write a PowerShell script to a temp file to avoid escaping issues.
      // Flow: clear clipboard → trigger Snip & Sketch → poll clipboard → save PNG.
      const psScriptPath = join(tmpdir(), `clui-snip-${timestamp}.ps1`)
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '',
        '# Clear clipboard so we detect the new capture',
        '[System.Windows.Forms.Clipboard]::Clear()',
        '',
        '# Trigger the Windows snipping overlay (Win+Shift+S equivalent)',
        'Start-Process "explorer.exe" "ms-screenclip:"',
        '',
        '# Poll clipboard for up to 60 seconds',
        'for ($i = 0; $i -lt 120; $i++) {',
        '  Start-Sleep -Milliseconds 500',
        '  $img = [System.Windows.Forms.Clipboard]::GetImage()',
        '  if ($img -ne $null) {',
        `    $img.Save('${screenshotPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        '    $img.Dispose()',
        "    Write-Output 'ok'",
        '    exit 0',
        '  }',
        '}',
        "Write-Output 'timeout'",
      ].join('\r\n')

      writeFileSync(psScriptPath, psScript, 'utf-8')

      const result = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`,
        { encoding: 'utf-8', timeout: 65000 },
      ).trim()

      // Clean up temp script
      try { require('fs').unlinkSync(psScriptPath) } catch {}

      if (result === 'ok' && existsSync(screenshotPath)) {
        const buffer = readFileSync(screenshotPath)
        return { path: screenshotPath, buffer }
      }
      log(`Screenshot: ${result === 'timeout' ? 'user did not capture within 60s' : 'clipboard was empty'}`)
      return null
    } catch (err: unknown) {
      log(`Screenshot error: ${err}`)
      return null
    }
  }

  return null
}

// ─── Shortcuts ───

/** Primary toggle shortcut for the overlay. */
export function getPrimaryShortcut(): string {
  return IS_WIN ? 'Ctrl+Space' : 'Alt+Space'
}

/** Human-readable label for the primary shortcut. */
export function getShortcutLabel(): string {
  return IS_WIN ? 'Ctrl + Space' : '⌥ + Space'
}

// ─── Whisper ───

interface WhisperInfo {
  bin: string
  model: string
  isWhisperCpp: boolean
  isEnglishOnly: boolean
}

/**
 * Find the Whisper binary and model file.
 * macOS: Homebrew paths + login shell fallback.
 * Windows: Deferred — returns null.
 */
export function findWhisper(): WhisperInfo | { error: string } {
  if (IS_WIN) {
    return { error: 'Voice input is not yet supported on Windows.' }
  }

  // macOS discovery
  const binCandidates = [
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper',
    join(homedir(), '.local/bin/whisper'),
  ]

  let whisperBin = ''
  for (const c of binCandidates) {
    if (existsSync(c)) { whisperBin = c; break }
  }

  if (!whisperBin) {
    try {
      whisperBin = execSync('/bin/zsh -lc "whence -p whisper-cli"', { encoding: 'utf-8' }).trim()
    } catch {}
  }
  if (!whisperBin) {
    try {
      whisperBin = execSync('/bin/zsh -lc "whence -p whisper"', { encoding: 'utf-8' }).trim()
    } catch {}
  }

  if (!whisperBin) {
    return { error: 'Whisper not found. Install with: brew install whisper-cli' }
  }

  const isWhisperCpp = whisperBin.includes('whisper-cli')

  // Find model file
  const modelCandidates = [
    join(homedir(), '.local/share/whisper/ggml-base.bin'),
    join(homedir(), '.local/share/whisper/ggml-tiny.bin'),
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
    '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin',
    join(homedir(), '.local/share/whisper/ggml-base.en.bin'),
    join(homedir(), '.local/share/whisper/ggml-tiny.en.bin'),
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
    '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin',
  ]

  let modelPath = ''
  for (const m of modelCandidates) {
    if (existsSync(m)) { modelPath = m; break }
  }

  if (isWhisperCpp && !modelPath) {
    return {
      error: 'Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    }
  }

  const isEnglishOnly = modelPath.includes('.en.')

  return { bin: whisperBin, model: modelPath, isWhisperCpp, isEnglishOnly }
}

// ─── Process Cancellation ───

/**
 * Cancel a child process gracefully, with platform-appropriate escalation.
 * macOS: SIGINT → SIGKILL after timeout.
 * Windows: stdin close → taskkill /T /F after timeout.
 */
export function cancelProcess(
  proc: { kill: (signal?: NodeJS.Signals | number) => boolean; stdin?: { end: () => void; destroyed?: boolean } | null; exitCode: number | null; pid?: number },
  log: (msg: string) => void,
  timeoutMs = 5000,
): void {
  if (IS_WIN) {
    // Windows: close stdin for graceful exit, then force kill the process tree
    try { proc.stdin?.end() } catch {}
    setTimeout(() => {
      if (proc.exitCode === null && proc.pid) {
        log(`Force killing PID ${proc.pid} via taskkill`)
        try {
          execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' })
        } catch {}
      }
    }, timeoutMs)
  } else {
    // macOS/Linux: SIGINT → SIGKILL escalation
    proc.kill('SIGINT')
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL')
      }
    }, timeoutMs)
  }
}

// ─── Skills Download ───

/**
 * Download a tarball and extract a subdirectory.
 * macOS: curl | tar pipe.
 * Windows: Node https download → tar.exe extraction (Windows 10+ ships tar.exe).
 */
export async function downloadAndExtractTarball(
  tarballUrl: string,
  targetDir: string,
  pathDepth: number,
  filterPath: string,
  log: (msg: string) => void,
): Promise<void> {
  if (IS_MAC) {
    const cmd = [
      `curl -sL "${tarballUrl}"`,
      '|',
      `tar -xz --strip-components=${pathDepth} -C "${targetDir}" "*/${filterPath}"`,
    ].join(' ')
    execSync(cmd, { timeout: 60000, stdio: 'pipe' })
    return
  }

  if (IS_WIN) {
    // Download tarball to temp file, then extract with tar.exe (built into Windows 10+)
    const tarballPath = join(tmpdir(), `clui-skill-${Date.now()}.tar.gz`)
    try {
      await downloadFile(tarballUrl, tarballPath)
      // Windows tar.exe supports --strip-components
      execSync(
        `tar -xzf "${tarballPath}" --strip-components=${pathDepth} -C "${targetDir}"`,
        { timeout: 60000, stdio: 'pipe' },
      )
    } finally {
      try { require('fs').unlinkSync(tarballPath) } catch {}
    }
  }
}

/** Download a URL to a local file using Node's https module. */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const https = require('https') as typeof import('https')
    const file = require('fs').createWriteStream(dest)

    const request = (reqUrl: string) => {
      https.get(reqUrl, { headers: { 'User-Agent': 'clui-cc' } }, (res) => {
        // Follow redirects (GitHub API returns 302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location
          if (location) {
            res.resume()
            request(location)
            return
          }
        }
        if (res.statusCode !== 200) {
          file.close()
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      }).on('error', (err) => {
        file.close()
        reject(err)
      })
    }

    request(url)
  })
}
