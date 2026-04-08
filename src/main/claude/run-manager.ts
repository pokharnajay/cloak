import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { StreamParser } from '../stream-parser'
import { normalize } from './event-normalizer'
import { log as _log } from '../logger'
import { IS_WIN, getCliEnv, findClaudeBinary, prependBinDir, cancelProcess } from '../platform'
import type { ClaudeEvent, NormalizedEvent, RunOptions, EnrichedError } from '../../shared/types'

const MAX_RING_LINES = 100
const DEBUG = process.env.CLUI_DEBUG === '1'

// Appended to Claude's default system prompt so it knows it's running inside CLUI.
// Uses --append-system-prompt (additive) not --system-prompt (replacement).
const CLUI_SYSTEM_HINT = [
  'IMPORTANT: You are NOT running in a terminal. You are running inside CLUI,',
  'a desktop chat application with a rich UI that renders full markdown.',
  'CLUI is a GUI wrapper around Claude Code — the user sees your output in a',
  'styled conversation view, not a raw terminal.',
  '',
  'Because CLUI renders markdown natively, you MUST use rich formatting when it helps:',
  '- Always use clickable markdown links: [label](https://url) — they render as real buttons.',
  '- When the user asks for images, and public web images are appropriate, proactively find and render them in CLUI.',
  '- Workflow: WebSearch for relevant public pages -> WebFetch those pages -> extract real image URLs -> render with markdown ![alt](url).',
  '- Do not guess, fabricate, or construct image URLs from memory.',
  '- Only embed images when the URL is a real publicly accessible image URL found through tools or explicitly provided by the user.',
  '- If real image URLs cannot be obtained confidently, fall back to clickable links and briefly say so.',
  '- Do not ask whether CLUI can render images; assume it can.',
  '- Use tables, bold, headers, and bullet lists freely — they all render beautifully.',
  '- Use code blocks with language tags for syntax highlighting.',
  '',
  'You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)',
  'normally. But when presenting information, links, resources, or explanations to the user,',
  'take full advantage of the rich UI. The user expects a polished chat experience, not raw terminal text.',
].join('\n')

// Tools auto-approved via --allowedTools (never trigger the permission card).
// Includes routine internal agent mechanics (Agent, Task, TaskOutput, TodoWrite,
// Notebook) — prompting for these would make UX terrible without adding meaningful
// safety. This is a deliberate CLUI policy choice, not native Claude parity.
// If runtime evidence shows any of these create real user-facing approval moments,
// they should be moved to the hook matcher in permission-server.ts instead.
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS',
  'TodoRead', 'TodoWrite',
  'Agent', 'Task', 'TaskOutput',
  'Notebook',
  'WebSearch', 'WebFetch',
]

// All tools to pre-approve when NO hook server is available (fallback path).
// Includes safe + dangerous tools so nothing is silently denied.
const DEFAULT_ALLOWED_TOOLS = [
  'Bash', 'Edit', 'Write', 'MultiEdit',
  ...SAFE_TOOLS,
]

function log(msg: string): void {
  _log('RunManager', msg)
}

export interface RunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess
  pid: number | null
  startedAt: number
  /** Ring buffer of last N stderr lines */
  stderrTail: string[]
  /** Ring buffer of last N stdout lines */
  stdoutTail: string[]
  /** Count of tool calls seen during this run */
  toolCallCount: number
  /** Whether any permission_request event was seen during this run */
  sawPermissionRequest: boolean
  /** Permission denials from result event */
  permissionDenials: Array<{ tool_name: string; tool_use_id: string }>
}

/**
 * RunManager: spawns one `claude -p` process per run, parses NDJSON,
 * emits normalized events, handles cancel, and keeps diagnostic ring buffers.
 *
 * Events emitted:
 *  - 'normalized' (runId, NormalizedEvent)
 *  - 'raw' (runId, ClaudeEvent)  — for logging/debugging
 *  - 'exit' (runId, code, signal, sessionId)
 *  - 'error' (runId, Error)
 */
export class RunManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  /** Holds recently-finished runs so diagnostics survive past process exit */
  private _finishedRuns = new Map<string, RunHandle>()
  private claudeBinary: string

  constructor() {
    super()
    this.claudeBinary = findClaudeBinary()
    log(`Claude binary: ${this.claudeBinary}`)
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = getCliEnv()
    if (env.PATH) {
      env.PATH = prependBinDir(env.PATH, this.claudeBinary)
    }
    return env
  }

  startRun(requestId: string, options: RunOptions): RunHandle {
    const cwd = options.projectPath === '~' ? homedir() : options.projectPath

    // Pre-flight: check binary exists
    const handle: RunHandle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      process: null as unknown as ChildProcess,
      pid: null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: [],
    }
    if (!this.claudeBinary || this.claudeBinary === 'claude') {
      // Re-check in case it was installed after app launch
      this.claudeBinary = findClaudeBinary()
    }
    try {
      if (!existsSync(this.claudeBinary) && this.claudeBinary !== 'claude') {
        throw new Error('not found')
      }
    } catch {
      // Binary path doesn't exist — check if bare 'claude' is resolvable
      if (this.claudeBinary === 'claude') {
        // Will likely fail at spawn, but let's give a clear error first
        log(`Claude binary not found [${requestId}]`)
        this.activeRuns.set(requestId, handle)
        setImmediate(() => {
          const evt: NormalizedEvent = {
            type: 'error',
            message: 'Claude Code CLI is not installed.\n\nInstall it with:\n  npm install -g @anthropic-ai/claude-code\n\nThen run: claude',
            isError: true,
          }
          this.emit('normalized', requestId, evt)
          this.emit('exit', requestId, 1, null, null)
        })
        return handle
      }
    }

    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'default',
    ]

    // Permission mode flags
    if (options.permissionMode === 'auto') {
      args.push('--dangerously-skip-permissions')
    } else if (options.permissionMode === 'plan') {
      // Plan mode: read-only, no tool execution
      args.push('--permission-mode', 'plan')
    }

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.addDirs && options.addDirs.length > 0) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir)
      }
    }

    if (options.permissionMode !== 'auto' && options.hookSettingsPath) {
      // CLUI-scoped hook settings: the PreToolUse HTTP hook handles permissions
      // for dangerous tools (Bash, Edit, Write, MultiEdit).
      // Auto-approve safe tools so they don't trigger the permission card.
      args.push('--settings', options.hookSettingsPath)
      const safeAllowed = [
        ...SAFE_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', safeAllowed.join(','))
    } else if (options.permissionMode !== 'auto') {
      // Fallback: no hook server available.
      // Pre-approve common tools so they run without being silently denied.
      const allAllowed = [
        ...DEFAULT_ALLOWED_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', allAllowed.join(','))
    }
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }
    // Always tell Claude it's inside CLUI (additive, doesn't replace base prompt)
    args.push('--append-system-prompt', CLUI_SYSTEM_HINT)

    if (DEBUG) {
      log(`Starting run ${requestId}: ${this.claudeBinary} ${args.join(' ')}`)
      log(`Prompt: ${options.prompt.substring(0, 200)}`)
    } else {
      log(`Starting run ${requestId}`)
    }

    const child = spawn(this.claudeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: this._getEnv(),
      shell: IS_WIN,
    })

    log(`Spawned PID: ${child.pid}`)

    handle.process = child
    handle.pid = child.pid || null

    // ─── stdout → NDJSON parser → normalizer → events ───
    const parser = StreamParser.fromStream(child.stdout!)

    parser.on('event', (raw: ClaudeEvent) => {
      // Track session ID
      if (raw.type === 'system' && 'subtype' in raw && raw.subtype === 'init') {
        handle.sessionId = (raw as any).session_id
      }

      // Track permission_request events
      if (raw.type === 'permission_request' || (raw.type === 'system' && 'subtype' in raw && (raw as any).subtype === 'permission_request')) {
        handle.sawPermissionRequest = true
        log(`Permission request seen [${requestId}]`)
      }

      // Extract permission_denials from result event
      if (raw.type === 'result') {
        const denials = (raw as any).permission_denials
        if (Array.isArray(denials) && denials.length > 0) {
          handle.permissionDenials = denials.map((d: any) => ({
            tool_name: d.tool_name || '',
            tool_use_id: d.tool_use_id || '',
          }))
          log(`Permission denials [${requestId}]: ${JSON.stringify(handle.permissionDenials)}`)
        }
      }

      // Ring buffer stdout lines (raw JSON for diagnostics)
      this._ringPush(handle.stdoutTail, JSON.stringify(raw).substring(0, 300))

      // Emit raw event for debugging
      this.emit('raw', requestId, raw)

      // Normalize and emit canonical events
      const normalized = normalize(raw)
      for (const evt of normalized) {
        if (evt.type === 'tool_call') handle.toolCallCount++
        this.emit('normalized', requestId, evt)
      }

      // Close stdin after result event — with stream-json input the process
      // stays alive waiting for more input; closing stdin triggers clean exit.
      if (raw.type === 'result') {
        log(`Run complete [${requestId}]: sawPermissionRequest=${handle.sawPermissionRequest}, denials=${handle.permissionDenials.length}`)
        try { child.stdin?.end() } catch {}
      }
    })

    parser.on('parse-error', (line: string) => {
      log(`Parse error [${requestId}]: ${line.substring(0, 200)}`)
      this._ringPush(handle.stderrTail, `[parse-error] ${line.substring(0, 200)}`)
    })

    // ─── stderr ring buffer ───
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      const lines = data.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        this._ringPush(handle.stderrTail, line)
      }
      log(`Stderr [${requestId}]: ${data.trim().substring(0, 500)}`)
    })

    // ─── Process lifecycle ───
    // Snapshot diagnostics BEFORE deleting the handle so callers can still read them.
    child.on('close', (code, signal) => {
      log(`Process closed [${requestId}]: code=${code} signal=${signal}`)
      // Move handle to finished map so getEnrichedError still works after exit
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('exit', requestId, code, signal, handle.sessionId)
      // Clean up finished run after a short delay (gives callers time to read diagnostics)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    child.on('error', (err) => {
      log(`Process error [${requestId}]: ${err.message}`)
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('error', requestId, err)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    // ─── Write prompt to stdin (stream-json format, keep open) ───
    // Using --input-format stream-json for bidirectional communication.
    // Stdin stays open so follow-up messages can be sent.
    const contentBlocks: Array<Record<string, unknown>> = []

    // Add image content blocks first (so Claude sees them before the text)
    if (options.images && options.images.length > 0) {
      for (const img of options.images) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.data,
          },
        })
      }
    }

    contentBlocks.push({ type: 'text', text: options.prompt })

    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
    })
    child.stdin!.write(userMessage + '\n')

    this.activeRuns.set(requestId, handle)
    return handle
  }

  /**
   * Write a message to a running process's stdin (for follow-up prompts, etc.)
   */
  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false

    const json = JSON.stringify(message)
    log(`Writing to stdin [${requestId}]: ${json.substring(0, 200)}`)
    handle.process.stdin.write(json + '\n')
    return true
  }

  /**
   * Cancel a running process: SIGINT, then SIGKILL after 5s.
   */
  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false

    log(`Cancelling run ${requestId}`)
    cancelProcess(handle.process, (msg) => log(`[cancel ${requestId}] ${msg}`))
    return true
  }

  /**
   * Get an enriched error object for a failed run.
   */
  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    const stderrJoined = (handle?.stderrTail || []).join('\n').toLowerCase()

    // Detect common error patterns and provide friendly messages
    let message = `Run failed with exit code ${exitCode}`
    if (stderrJoined.includes('invalid api key') || stderrJoined.includes('invalid x-api-key') || stderrJoined.includes('authentication')) {
      message = 'API key is invalid or expired. Run "claude" in your terminal to re-authenticate.'
    } else if (stderrJoined.includes('not authenticated') || stderrJoined.includes('please login') || stderrJoined.includes('log in')) {
      message = 'Not logged in. Run "claude" in your terminal to authenticate.'
    } else if (stderrJoined.includes('rate limit') || stderrJoined.includes('too many requests') || stderrJoined.includes('429')) {
      message = 'Rate limited — too many requests. Wait a moment and try again.'
    } else if (stderrJoined.includes('network') || stderrJoined.includes('enotfound') || stderrJoined.includes('econnrefused') || stderrJoined.includes('fetch failed') || stderrJoined.includes('socket hang up')) {
      message = 'Network error — check your internet connection and try again.'
    } else if (stderrJoined.includes('timeout') || stderrJoined.includes('etimedout')) {
      message = 'Request timed out. Check your connection and try again.'
    } else if (stderrJoined.includes('overloaded') || stderrJoined.includes('529') || stderrJoined.includes('service unavailable')) {
      message = 'API is temporarily overloaded. Try again in a few seconds.'
    } else if (stderrJoined.includes('permission denied') || stderrJoined.includes('eacces')) {
      message = 'Permission denied. Check file/folder permissions.'
    } else if (stderrJoined.includes('enospc') || stderrJoined.includes('no space')) {
      message = 'Disk is full. Free up space and try again.'
    } else if (stderrJoined.includes('spawn') && stderrJoined.includes('enoent')) {
      message = 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
    } else if (exitCode === null) {
      message = 'Process was terminated unexpectedly.'
    }

    return {
      message,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || [],
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): RunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  private _ringPush(buffer: string[], line: string): void {
    buffer.push(line)
    if (buffer.length > MAX_RING_LINES) {
      buffer.shift()
    }
  }
}
