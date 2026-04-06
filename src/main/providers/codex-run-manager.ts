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
}

/**
 * CodexRunManager: spawns one `codex` process per run, parses plain text stdout,
 * emits normalized events compatible with ControlPlane's event routing.
 *
 * Events emitted (same contract as RunManager):
 *  - 'normalized' (runId, NormalizedEvent)
 *  - 'exit' (runId, code, signal, sessionId)
 *  - 'error' (runId, Error)
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
    }

    // Pre-flight: check binary exists
    if (!codexBinary) {
      log(`Codex binary not found [${requestId}]`)
      this.activeRuns.set(requestId, handle)
      setImmediate(() => {
        const evt: NormalizedEvent = {
          type: 'error',
          message: 'Codex CLI is not installed. Use the model picker menu to install it, or run: npm install -g @openai/codex',
          isError: true,
        }
        this.emit('normalized', requestId, evt)
        this._finishRun(requestId, handle)
        this.emit('exit', requestId, 1, null, null)
      })
      return handle
    }

    // Pre-flight: check OPENAI_API_KEY
    if (!process.env.OPENAI_API_KEY) {
      log(`OPENAI_API_KEY not set [${requestId}]`)
      this.activeRuns.set(requestId, handle)
      setImmediate(() => {
        const evt: NormalizedEvent = {
          type: 'error',
          message: 'OPENAI_API_KEY is not set. Add it to your environment variables and restart the app.',
          isError: true,
        }
        this.emit('normalized', requestId, evt)
        this._finishRun(requestId, handle)
        this.emit('exit', requestId, 1, null, null)
      })
      return handle
    }

    // Build args: codex --full-auto -q "prompt"
    const args: string[] = ['--full-auto', '-q']

    if (options.model) {
      args.push('--model', options.model)
    }

    // The prompt is passed as the last positional argument
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

    // Generate a synthetic session ID for this run
    const syntheticSessionId = `codex-${requestId.substring(0, 8)}`
    handle.sessionId = syntheticSessionId

    // Emit synthetic session_init on first stdout data
    let initEmitted = false

    // ─── stdout → text chunks ───
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (data: string) => {
      if (!initEmitted) {
        initEmitted = true
        const initEvt: NormalizedEvent = {
          type: 'session_init',
          sessionId: syntheticSessionId,
          tools: [],
          model: options.model || 'codex',
          mcpServers: [],
          skills: [],
          version: 'codex-cli',
        }
        this.emit('normalized', requestId, initEvt)
      }

      this._ringPush(handle.stdoutTail, data.substring(0, 300))

      const textEvt: NormalizedEvent = { type: 'text_chunk', text: data }
      this.emit('normalized', requestId, textEvt)
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

      // If we never emitted init (no output at all), emit it now so the UI transitions properly
      if (!initEmitted) {
        initEmitted = true
        const initEvt: NormalizedEvent = {
          type: 'session_init',
          sessionId: syntheticSessionId,
          tools: [],
          model: options.model || 'codex',
          mcpServers: [],
          skills: [],
          version: 'codex-cli',
        }
        this.emit('normalized', requestId, initEvt)
      }

      if (code === 0) {
        // Emit task_complete
        const completeEvt: NormalizedEvent = {
          type: 'task_complete',
          result: '',
          costUsd: 0,
          durationMs: Date.now() - handle.startedAt,
          numTurns: 1,
          usage: {},
          sessionId: syntheticSessionId,
        }
        this.emit('normalized', requestId, completeEvt)
      } else if (code !== null && code !== 0) {
        const stderrSummary = handle.stderrTail.slice(-5).join('\n')
        const errorEvt: NormalizedEvent = {
          type: 'error',
          message: `Codex exited with code ${code}${stderrSummary ? ': ' + stderrSummary : ''}`,
          isError: true,
          sessionId: syntheticSessionId,
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
      toolCallCount: 0,
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
