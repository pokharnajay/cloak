import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { log as _log } from '../logger'
import { getCliEnv, findCodexBinary, prependBinDir, cancelProcess } from '../platform'
import type { NormalizedEvent, RunOptions, EnrichedError } from '../../shared/types'

const MAX_RING_LINES = 100
const DEBUG = process.env.CLUI_DEBUG === '1'

function log(msg: string): void {
  _log('CodexRunManager', msg)
}

export interface CodexRunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess | null
  pid: number | null
  startedAt: number
  stderrTail: string[]
  stdoutTail: string[]
  model: string | null
  toolCallCount: number
}

/**
 * CodexRunManager: spawns `codex exec --json` per run, parses JSONL events,
 * emits normalized events compatible with ControlPlane's event routing.
 *
 * Codex JSONL event types:
 *  - thread.started   { thread_id }
 *  - turn.started     {}
 *  - item.started     { item: { id, type, command?, status? } }
 *  - item.completed   { item: { id, type, text?, command?, aggregated_output?, exit_code? } }
 *  - turn.completed   { usage: { input_tokens, cached_input_tokens, output_tokens } }
 */
export class CodexRunManager extends EventEmitter {
  private activeRuns = new Map<string, CodexRunHandle>()
  private _finishedRuns = new Map<string, CodexRunHandle>()

  private _getCodexBinary(): string | null {
    return findCodexBinary()
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = getCliEnv()
    const codexBin = this._getCodexBinary()
    if (env.PATH && codexBin) {
      env.PATH = prependBinDir(env.PATH, codexBin)
    }
    return env
  }

  startRun(requestId: string, options: RunOptions): CodexRunHandle {
    const cwd = options.projectPath === '~' ? homedir() : options.projectPath
    const codexBinary = this._getCodexBinary()

    const handle: CodexRunHandle = {
      runId: requestId,
      sessionId: null,
      process: null,
      pid: null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      model: options.model || null,
      toolCallCount: 0,
    }

    // Pre-flight: check binary exists
    if (!codexBinary) {
      log(`Codex binary not found [${requestId}]`)
      this.activeRuns.set(requestId, handle)
      setImmediate(() => {
        const evt: NormalizedEvent = {
          type: 'error',
          message: 'Codex CLI is not installed. Run: npm install -g @openai/codex',
          isError: true,
        }
        this.emit('normalized', requestId, evt)
        this._finishRun(requestId, handle)
        this.emit('exit', requestId, 1, null, null)
      })
      return handle
    }

    // Build args: codex exec --json [flags] "prompt"
    const args: string[] = ['exec', '--json']

    // Permission/sandbox modes
    if (options.permissionMode === 'auto') {
      args.push('--full-auto')
    } else if (options.permissionMode === 'plan') {
      args.push('--sandbox', 'read-only')
    } else {
      // 'ask' mode — sandboxed with approval on request
      args.push('--sandbox', 'workspace-write', '-a', 'on-request')
    }

    if (options.model) {
      args.push('--model', options.model)
    }

    // Working directory
    args.push('-C', cwd)

    // Additional directories
    if (options.addDirs && options.addDirs.length > 0) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir)
      }
    }

    // Image attachments
    if (options.images && options.images.length > 0) {
      for (const img of options.images) {
        // Images come as base64 data — write to temp file and pass path
        // But we also have file-path attachments — check if there's a path
        // The RunOptions.images are base64, but attachments with paths are handled separately
      }
    }

    // Prompt as last positional argument
    args.push(options.prompt)

    if (DEBUG) {
      log(`Starting run ${requestId}: ${codexBinary} ${args.join(' ')}`)
    } else {
      log(`Starting run ${requestId}`)
    }

    const child = spawn(codexBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: this._getEnv(),
    })

    log(`Spawned PID: ${child.pid}`)

    handle.process = child
    handle.pid = child.pid || null

    let initEmitted = false
    let lineBuffer = ''

    // ─── stdout → JSONL parsing ───
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (data: string) => {
      lineBuffer += data

      // Process complete lines
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || '' // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this._ringPush(handle.stdoutTail, trimmed.substring(0, 300))

        try {
          const event = JSON.parse(trimmed)
          this._handleCodexEvent(requestId, handle, event, initEmitted)

          // Mark init as emitted after first thread.started
          if (event.type === 'thread.started') {
            initEmitted = true
          }
        } catch {
          // Non-JSON line — treat as raw text
          if (!initEmitted) {
            initEmitted = true
            this._emitInit(requestId, handle, options)
          }
          const textEvt: NormalizedEvent = { type: 'text_chunk', text: trimmed + '\n' }
          this.emit('normalized', requestId, textEvt)
        }
      }
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
    child.on('close', (code, signal) => {
      log(`Process closed [${requestId}]: code=${code} signal=${signal}`)

      // Process remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim())
          this._handleCodexEvent(requestId, handle, event, initEmitted)
        } catch {}
      }

      // Ensure init was emitted
      if (!initEmitted) {
        this._emitInit(requestId, handle, options)
      }

      if (code === 0) {
        const completeEvt: NormalizedEvent = {
          type: 'task_complete',
          result: '',
          costUsd: 0,
          durationMs: Date.now() - handle.startedAt,
          numTurns: 1,
          usage: {},
          sessionId: handle.sessionId || `codex-${requestId.substring(0, 8)}`,
        }
        this.emit('normalized', requestId, completeEvt)
      } else if (code !== null && code !== 0) {
        const stderrSummary = handle.stderrTail.slice(-5).join('\n')
        const errorEvt: NormalizedEvent = {
          type: 'error',
          message: `Codex exited with code ${code}${stderrSummary ? ': ' + stderrSummary : ''}`,
          isError: true,
          sessionId: handle.sessionId || undefined,
        }
        this.emit('normalized', requestId, errorEvt)
      }

      this._finishRun(requestId, handle)
      this.emit('exit', requestId, code, signal, handle.sessionId)
    })

    child.on('error', (err) => {
      log(`Process error [${requestId}]: ${err.message}`)
      this._finishRun(requestId, handle)
      this.emit('error', requestId, err)
    })

    this.activeRuns.set(requestId, handle)
    return handle
  }

  /** Parse a single Codex JSONL event and emit normalized events */
  private _handleCodexEvent(requestId: string, handle: CodexRunHandle, event: any, initEmitted: boolean): void {
    const type = event.type

    if (type === 'thread.started') {
      handle.sessionId = event.thread_id
      this._emitInit(requestId, handle, { prompt: '', projectPath: '' })
      return
    }

    if (type === 'item.started' && event.item?.type === 'command_execution') {
      handle.toolCallCount++
      const toolEvt: NormalizedEvent = {
        type: 'tool_call',
        toolName: 'Bash',
        toolId: event.item.id,
        index: handle.toolCallCount - 1,
      }
      this.emit('normalized', requestId, toolEvt)

      // Show the command as a tool input update
      if (event.item.command) {
        const updateEvt: NormalizedEvent = {
          type: 'tool_call_update',
          toolId: event.item.id,
          partialInput: JSON.stringify({ command: event.item.command }),
        }
        this.emit('normalized', requestId, updateEvt)
      }
      return
    }

    if (type === 'item.completed') {
      const item = event.item
      if (!item) return

      if (item.type === 'agent_message' && item.text) {
        const textEvt: NormalizedEvent = { type: 'text_chunk', text: item.text }
        this.emit('normalized', requestId, textEvt)
        return
      }

      if (item.type === 'command_execution') {
        // Tool call completed — emit output as text then mark complete
        if (item.aggregated_output) {
          const outputEvt: NormalizedEvent = {
            type: 'tool_call_update',
            toolId: item.id,
            partialInput: JSON.stringify({
              command: item.command || '',
              output: item.aggregated_output,
              exit_code: item.exit_code,
            }),
          }
          this.emit('normalized', requestId, outputEvt)
        }
        const completeEvt: NormalizedEvent = {
          type: 'tool_call_complete',
          index: handle.toolCallCount - 1,
        }
        this.emit('normalized', requestId, completeEvt)
        return
      }
    }

    if (type === 'turn.completed' && event.usage) {
      const usageEvt: NormalizedEvent = {
        type: 'usage',
        usage: {
          input_tokens: event.usage.input_tokens,
          output_tokens: event.usage.output_tokens,
          cache_read_input_tokens: event.usage.cached_input_tokens,
        },
      }
      this.emit('normalized', requestId, usageEvt)
      return
    }
  }

  private _emitInit(requestId: string, handle: CodexRunHandle, options: Pick<RunOptions, 'prompt' | 'projectPath'>): void {
    const initEvt: NormalizedEvent = {
      type: 'session_init',
      sessionId: handle.sessionId || `codex-${requestId.substring(0, 8)}`,
      tools: ['Bash', 'Read', 'Write', 'Edit'],
      model: handle.model || 'codex',
      mcpServers: [],
      skills: [],
      version: 'codex-cli',
    }
    this.emit('normalized', requestId, initEvt)
  }

  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle?.process?.stdin || handle.process.stdin.destroyed) return false

    const text = typeof message === 'string' ? message : JSON.stringify(message)
    log(`Writing to stdin [${requestId}]: ${text.substring(0, 200)}`)
    handle.process.stdin.write(text + '\n')
    return true
  }

  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle?.process) return false

    log(`Cancelling run ${requestId}`)
    cancelProcess(handle.process, (msg) => log(`[cancel ${requestId}] ${msg}`))
    return true
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    return {
      message: `Codex run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): CodexRunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  private _finishRun(requestId: string, handle: CodexRunHandle): void {
    this._finishedRuns.set(requestId, handle)
    this.activeRuns.delete(requestId)
    setTimeout(() => this._finishedRuns.delete(requestId), 5000)
  }

  private _ringPush(buffer: string[], line: string): void {
    buffer.push(line)
    if (buffer.length > MAX_RING_LINES) {
      buffer.shift()
    }
  }
}
