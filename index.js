"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const os = require("os");
const events = require("events");
const child_process = require("child_process");
const http = require("http");
const crypto$1 = require("crypto");
const promises = require("fs/promises");
class StreamParser extends events.EventEmitter {
  buffer = "";
  /**
   * Feed a chunk of data (from stdout) into the parser.
   * Emits 'event' for each parsed JSON line.
   */
  feed(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("event", parsed);
      } catch {
        this.emit("parse-error", trimmed);
      }
    }
  }
  /**
   * Flush any remaining data in the buffer (call when stream ends).
   */
  flush() {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("event", parsed);
      } catch {
        this.emit("parse-error", trimmed);
      }
    }
    this.buffer = "";
  }
  /**
   * Convenience: pipe a readable stream through the parser.
   */
  static fromStream(stream) {
    const parser = new StreamParser();
    stream.setEncoding("utf-8");
    stream.on("data", (chunk) => parser.feed(chunk));
    stream.on("end", () => parser.flush());
    return parser;
  }
}
function normalize(raw) {
  switch (raw.type) {
    case "system":
      return normalizeSystem(raw);
    case "stream_event":
      return normalizeStreamEvent(raw);
    case "assistant":
      return normalizeAssistant(raw);
    case "result":
      return normalizeResult(raw);
    case "rate_limit_event":
      return normalizeRateLimit(raw);
    case "permission_request":
      return normalizePermission(raw);
    default:
      return [];
  }
}
function normalizeSystem(event) {
  if (event.subtype !== "init") return [];
  return [{
    type: "session_init",
    sessionId: event.session_id,
    tools: event.tools || [],
    model: event.model || "unknown",
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || "unknown"
  }];
}
function normalizeStreamEvent(event) {
  const sub = event.event;
  if (!sub) return [];
  switch (sub.type) {
    case "content_block_start": {
      if (sub.content_block.type === "tool_use") {
        return [{
          type: "tool_call",
          toolName: sub.content_block.name || "unknown",
          toolId: sub.content_block.id || "",
          index: sub.index
        }];
      }
      return [];
    }
    case "content_block_delta": {
      const delta = sub.delta;
      if (delta.type === "text_delta") {
        return [{ type: "text_chunk", text: delta.text }];
      }
      if (delta.type === "input_json_delta") {
        return [{
          type: "tool_call_update",
          toolId: "",
          // caller can associate via index tracking
          partialInput: delta.partial_json
        }];
      }
      return [];
    }
    case "content_block_stop": {
      return [{
        type: "tool_call_complete",
        index: sub.index
      }];
    }
    case "message_start":
    case "message_delta":
    case "message_stop":
      return [];
    default:
      return [];
  }
}
function normalizeAssistant(event) {
  return [{
    type: "task_update",
    message: event.message
  }];
}
function normalizeResult(event) {
  if (event.is_error || event.subtype === "error") {
    return [{
      type: "error",
      message: event.result || "Unknown error",
      isError: true,
      sessionId: event.session_id
    }];
  }
  const denials = Array.isArray(event.permission_denials) ? event.permission_denials.map((d) => ({
    toolName: d.tool_name || "",
    toolUseId: d.tool_use_id || ""
  })) : void 0;
  return [{
    type: "task_complete",
    result: event.result || "",
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: event.usage || {},
    sessionId: event.session_id,
    ...denials && denials.length > 0 ? { permissionDenials: denials } : {}
  }];
}
function normalizeRateLimit(event) {
  const info = event.rate_limit_info;
  if (!info) return [];
  return [{
    type: "rate_limit",
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType
  }];
}
function normalizePermission(event) {
  return [{
    type: "permission_request",
    questionId: event.question_id,
    toolName: event.tool?.name || "unknown",
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind
    }))
  }];
}
const LOG_FILE$1 = path.join(os.homedir(), ".clui-debug.log");
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER_SIZE = 64;
let buffer = [];
let timer = null;
const inFlight = /* @__PURE__ */ new Map();
let nextChunkId = 1;
function flush() {
  if (buffer.length === 0) return;
  const chunk = buffer.join("");
  buffer = [];
  const chunkId = nextChunkId++;
  inFlight.set(chunkId, chunk);
  fs.appendFile(LOG_FILE$1, chunk, () => {
    inFlight.delete(chunkId);
  });
}
function ensureTimer() {
  if (timer) return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (timer && typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}
function log$7(tag, msg) {
  buffer.push(`[${(/* @__PURE__ */ new Date()).toISOString()}] [${tag}] ${msg}
`);
  if (buffer.length >= MAX_BUFFER_SIZE) flush();
  ensureTimer();
}
function flushLogs() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const pendingInflight = Array.from(inFlight.values()).join("");
  const pending = pendingInflight + buffer.join("");
  inFlight.clear();
  buffer = [];
  if (pending) {
    try {
      fs.appendFileSync(LOG_FILE$1, pending);
    } catch {
    }
  }
}
let cachedPath = null;
function appendPathEntries(target, seen, rawPath) {
  if (!rawPath) return;
  for (const entry of rawPath.split(":")) {
    const p = entry.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    target.push(p);
  }
}
function getCliPath() {
  if (cachedPath) return cachedPath;
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  appendPathEntries(ordered, seen, process.env.PATH);
  appendPathEntries(ordered, seen, "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  const pathCommands = [
    '/bin/zsh -ilc "echo $PATH"',
    '/bin/zsh -lc "echo $PATH"',
    '/bin/bash -lc "echo $PATH"'
  ];
  for (const cmd of pathCommands) {
    try {
      const discovered = child_process.execSync(cmd, { encoding: "utf-8", timeout: 3e3 }).trim();
      appendPathEntries(ordered, seen, discovered);
    } catch {
    }
  }
  cachedPath = ordered.join(":");
  return cachedPath;
}
function getCliEnv(extraEnv) {
  const env = {
    ...process.env,
    ...extraEnv,
    PATH: getCliPath()
  };
  delete env.CLAUDECODE;
  return env;
}
const MAX_RING_LINES$1 = 100;
const DEBUG$1 = process.env.CLUI_DEBUG === "1";
const CLUI_SYSTEM_HINT = [
  "IMPORTANT: You are NOT running in a terminal. You are running inside CLUI,",
  "a desktop chat application with a rich UI that renders full markdown.",
  "CLUI is a GUI wrapper around Claude Code — the user sees your output in a",
  "styled conversation view, not a raw terminal.",
  "",
  "Because CLUI renders markdown natively, you MUST use rich formatting when it helps:",
  "- Always use clickable markdown links: [label](https://url) — they render as real buttons.",
  "- When the user asks for images, and public web images are appropriate, proactively find and render them in CLUI.",
  "- Workflow: WebSearch for relevant public pages -> WebFetch those pages -> extract real image URLs -> render with markdown ![alt](url).",
  "- Do not guess, fabricate, or construct image URLs from memory.",
  "- Only embed images when the URL is a real publicly accessible image URL found through tools or explicitly provided by the user.",
  "- If real image URLs cannot be obtained confidently, fall back to clickable links and briefly say so.",
  "- Do not ask whether CLUI can render images; assume it can.",
  "- Use tables, bold, headers, and bullet lists freely — they all render beautifully.",
  "- Use code blocks with language tags for syntax highlighting.",
  "",
  "You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)",
  "normally. But when presenting information, links, resources, or explanations to the user,",
  "take full advantage of the rich UI. The user expects a polished chat experience, not raw terminal text."
].join("\n");
const SAFE_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoRead",
  "TodoWrite",
  "Agent",
  "Task",
  "TaskOutput",
  "Notebook",
  "WebSearch",
  "WebFetch"
];
const DEFAULT_ALLOWED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  ...SAFE_TOOLS
];
function log$6(msg) {
  log$7("RunManager", msg);
}
class RunManager extends events.EventEmitter {
  activeRuns = /* @__PURE__ */ new Map();
  /** Holds recently-finished runs so diagnostics survive past process exit */
  _finishedRuns = /* @__PURE__ */ new Map();
  claudeBinary;
  constructor() {
    super();
    this.claudeBinary = this._findClaudeBinary();
    log$6(`Claude binary: ${this.claudeBinary}`);
  }
  _findClaudeBinary() {
    const candidates = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(os.homedir(), ".npm-global/bin/claude")
    ];
    for (const c of candidates) {
      try {
        child_process.execSync(`test -x "${c}"`, { stdio: "ignore" });
        return c;
      } catch {
      }
    }
    try {
      return child_process.execSync('/bin/zsh -ilc "whence -p claude"', { encoding: "utf-8", env: getCliEnv() }).trim();
    } catch {
    }
    try {
      return child_process.execSync('/bin/bash -lc "which claude"', { encoding: "utf-8", env: getCliEnv() }).trim();
    } catch {
    }
    return "claude";
  }
  _getEnv() {
    const env = getCliEnv();
    const binDir = this.claudeBinary.substring(0, this.claudeBinary.lastIndexOf("/"));
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = `${binDir}:${env.PATH}`;
    }
    return env;
  }
  startRun(requestId, options) {
    const cwd = options.projectPath === "~" ? os.homedir() : options.projectPath;
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "default"
    ];
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.addDirs && options.addDirs.length > 0) {
      for (const dir of options.addDirs) {
        args.push("--add-dir", dir);
      }
    }
    if (options.hookSettingsPath) {
      args.push("--settings", options.hookSettingsPath);
      const safeAllowed = [
        ...SAFE_TOOLS,
        ...options.allowedTools || []
      ];
      args.push("--allowedTools", safeAllowed.join(","));
    } else {
      const allAllowed = [
        ...DEFAULT_ALLOWED_TOOLS,
        ...options.allowedTools || []
      ];
      args.push("--allowedTools", allAllowed.join(","));
    }
    if (options.maxTurns) {
      args.push("--max-turns", String(options.maxTurns));
    }
    if (options.maxBudgetUsd) {
      args.push("--max-budget-usd", String(options.maxBudgetUsd));
    }
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }
    args.push("--append-system-prompt", CLUI_SYSTEM_HINT);
    if (DEBUG$1) {
      log$6(`Starting run ${requestId}: ${this.claudeBinary} ${args.join(" ")}`);
      log$6(`Prompt: ${options.prompt.substring(0, 200)}`);
    } else {
      log$6(`Starting run ${requestId}`);
    }
    const child = child_process.spawn(this.claudeBinary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: this._getEnv()
    });
    log$6(`Spawned PID: ${child.pid}`);
    const handle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      process: child,
      pid: child.pid || null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: []
    };
    const parser = StreamParser.fromStream(child.stdout);
    parser.on("event", (raw) => {
      if (raw.type === "system" && "subtype" in raw && raw.subtype === "init") {
        handle.sessionId = raw.session_id;
      }
      if (raw.type === "permission_request" || raw.type === "system" && "subtype" in raw && raw.subtype === "permission_request") {
        handle.sawPermissionRequest = true;
        log$6(`Permission request seen [${requestId}]`);
      }
      if (raw.type === "result") {
        const denials = raw.permission_denials;
        if (Array.isArray(denials) && denials.length > 0) {
          handle.permissionDenials = denials.map((d) => ({
            tool_name: d.tool_name || "",
            tool_use_id: d.tool_use_id || ""
          }));
          log$6(`Permission denials [${requestId}]: ${JSON.stringify(handle.permissionDenials)}`);
        }
      }
      this._ringPush(handle.stdoutTail, JSON.stringify(raw).substring(0, 300));
      this.emit("raw", requestId, raw);
      const normalized = normalize(raw);
      for (const evt of normalized) {
        if (evt.type === "tool_call") handle.toolCallCount++;
        this.emit("normalized", requestId, evt);
      }
      if (raw.type === "result") {
        log$6(`Run complete [${requestId}]: sawPermissionRequest=${handle.sawPermissionRequest}, denials=${handle.permissionDenials.length}`);
        try {
          child.stdin?.end();
        } catch {
        }
      }
    });
    parser.on("parse-error", (line) => {
      log$6(`Parse error [${requestId}]: ${line.substring(0, 200)}`);
      this._ringPush(handle.stderrTail, `[parse-error] ${line.substring(0, 200)}`);
    });
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (data) => {
      const lines = data.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        this._ringPush(handle.stderrTail, line);
      }
      log$6(`Stderr [${requestId}]: ${data.trim().substring(0, 500)}`);
    });
    child.on("close", (code, signal) => {
      log$6(`Process closed [${requestId}]: code=${code} signal=${signal}`);
      this._finishedRuns.set(requestId, handle);
      this.activeRuns.delete(requestId);
      this.emit("exit", requestId, code, signal, handle.sessionId);
      setTimeout(() => this._finishedRuns.delete(requestId), 5e3);
    });
    child.on("error", (err) => {
      log$6(`Process error [${requestId}]: ${err.message}`);
      this._finishedRuns.set(requestId, handle);
      this.activeRuns.delete(requestId);
      this.emit("error", requestId, err);
      setTimeout(() => this._finishedRuns.delete(requestId), 5e3);
    });
    const userMessage = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: options.prompt }]
      }
    });
    child.stdin.write(userMessage + "\n");
    this.activeRuns.set(requestId, handle);
    return handle;
  }
  /**
   * Write a message to a running process's stdin (for follow-up prompts, etc.)
   */
  writeToStdin(requestId, message) {
    const handle = this.activeRuns.get(requestId);
    if (!handle) return false;
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false;
    const json = JSON.stringify(message);
    log$6(`Writing to stdin [${requestId}]: ${json.substring(0, 200)}`);
    handle.process.stdin.write(json + "\n");
    return true;
  }
  /**
   * Cancel a running process: SIGINT, then SIGKILL after 5s.
   */
  cancel(requestId) {
    const handle = this.activeRuns.get(requestId);
    if (!handle) return false;
    log$6(`Cancelling run ${requestId}`);
    handle.process.kill("SIGINT");
    setTimeout(() => {
      if (handle.process.exitCode === null) {
        log$6(`Force killing run ${requestId} (SIGINT did not terminate)`);
        handle.process.kill("SIGKILL");
      }
    }, 5e3);
    return true;
  }
  /**
   * Get an enriched error object for a failed run.
   */
  getEnrichedError(requestId, exitCode) {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId);
    return {
      message: `Run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || []
    };
  }
  isRunning(requestId) {
    return this.activeRuns.has(requestId);
  }
  getHandle(requestId) {
    return this.activeRuns.get(requestId);
  }
  getActiveRunIds() {
    return Array.from(this.activeRuns.keys());
  }
  _ringPush(buffer2, line) {
    buffer2.push(line);
    if (buffer2.length > MAX_RING_LINES$1) {
      buffer2.shift();
    }
  }
}
let pty;
try {
  pty = require("node-pty");
} catch (err) {
}
const LOG_FILE = path.join(os.homedir(), ".clui-debug.log");
const MAX_RING_LINES = 100;
const PTY_BUFFER_SIZE = 50;
const PERMISSION_TIMEOUT_MS$1 = 5 * 60 * 1e3;
const QUIESCENCE_MS = 2e3;
function log$5(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] [PtyRunManager] ${msg}
`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
  }
}
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b[()][0-9A-Za-z]/g, "").replace(/\x1b[#=>\[\]]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
function detectPermissionPrompt(lines) {
  const joined = lines.join("\n");
  let confidence = 0;
  let toolName = "";
  let rawPrompt = "";
  const toolMatch = joined.match(/(?:wants?\s+to\s+(?:use|run|execute)|Tool:\s*|tool_name:\s*)(\w+)/i);
  if (toolMatch) {
    toolName = toolMatch[1];
    confidence += 3;
  }
  const permissionKeywords = [
    /\ballow\b/i,
    /\bdeny\b/i,
    /\breject\b/i,
    /\bpermission\b/i,
    /\bapprove\b/i
  ];
  for (const kw of permissionKeywords) {
    if (kw.test(joined)) confidence++;
  }
  const hasOptions = /(?:❯|›|>)\s*(?:Allow|Deny|Yes|No)/i.test(joined) || /\b(?:Allow\s+(?:once|always|for\s+(?:this\s+)?(?:project|session)))\b/i.test(joined);
  if (hasOptions) confidence += 2;
  if (confidence < 4) return null;
  const options = [];
  const optionPatterns = [
    { pattern: /Allow\s+(?:for\s+(?:this\s+)?(?:project|session)|always)/i, label: "Allow for this project", kind: "allow" },
    { pattern: /Allow\s+once/i, label: "Allow once", kind: "allow" },
    { pattern: /\bAlways\s+allow\b/i, label: "Always allow", kind: "allow" },
    { pattern: /(?:^|\s)Allow(?:\s|$)/i, label: "Allow", kind: "allow" },
    { pattern: /\bDeny\b/i, label: "Deny", kind: "deny" },
    { pattern: /\bReject\b/i, label: "Reject", kind: "deny" }
  ];
  let optIdx = 0;
  for (const op of optionPatterns) {
    if (op.pattern.test(joined)) {
      optIdx++;
      options.push({
        optionId: `opt-${optIdx}`,
        label: op.label,
        // Terminal value: we'll use arrow key navigation + Enter
        // The position in the list determines how many down arrows to press
        terminalValue: String(optIdx)
      });
    }
  }
  if (options.length === 0 && confidence >= 4) {
    options.push(
      { optionId: "opt-1", label: "Allow", terminalValue: "1" },
      { optionId: "opt-2", label: "Deny", terminalValue: "2" }
    );
  }
  rawPrompt = lines.slice(-10).join("\n");
  return { toolName: toolName || "Unknown", rawPrompt, options };
}
function extractSessionId(text) {
  const match = text.match(/(?:session[_ ]?id|Session|Resuming session)[:\s]+([a-f0-9-]{36})/i);
  return match ? match[1] : null;
}
function isInputPrompt(line) {
  const cleaned = line.trim();
  if (cleaned === "❯" || cleaned === ">" || cleaned === "$") return true;
  if (/^[❯>]\s*(?:\?\s*for\s*shortcuts)?$/.test(cleaned)) return true;
  return false;
}
function isUiChrome(line) {
  const cleaned = line.trim();
  if (!cleaned) return true;
  if (/^[╭│╰─┌└┃┏┗┐┘┤├┬┴┼]/.test(cleaned)) return true;
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✢✳✶✻✽]/.test(cleaned)) return true;
  if (/^\s*(?:Medium|Low|High)\s/.test(cleaned) && /model/i.test(cleaned)) return true;
  if (/\/mcp|MCP server/i.test(cleaned)) return true;
  if (/Claude\s*Code\s*v/i.test(cleaned) || /ClaudeCodev/i.test(cleaned)) return true;
  if (/^[❯>$]\s*$/.test(cleaned)) return true;
  if (/^\$[\d.]+\s+·/.test(cleaned)) return true;
  if (/for\s*shortcuts/i.test(cleaned)) return true;
  if (/zigzagging|thinking|processing|nebulizing|Boondoggling/i.test(cleaned)) return true;
  if (/^esctointerrupt/i.test(cleaned)) return true;
  if (/^[❯>]\s*\?\s*for\s*shortcuts/i.test(cleaned)) return true;
  if (/Opus\s*[\d.]+\s*·/i.test(cleaned)) return true;
  if (/Claude\s*Max/i.test(cleaned)) return true;
  if (/settings?\s*issue|\/doctor/i.test(cleaned)) return true;
  if (/^[─━▪\-=]{4,}/.test(cleaned)) return true;
  if (/^[▗▖▘▝▀▄▌▐█░▒▓■□▪▫●○◆◇◈]+$/.test(cleaned)) return true;
  return false;
}
function parseToolCallLine(line) {
  const match = line.match(/(?:⏳|⏳|✓|✗|⚡|🔧|Running|Executing)\s+(\w+)\s*(.*)/i) || line.match(/(?:Tool|Using):\s*(\w+)\s*(.*)/i);
  if (match) {
    return { toolName: match[1], input: match[2].trim() };
  }
  return null;
}
class PtyRunManager extends events.EventEmitter {
  activeRuns = /* @__PURE__ */ new Map();
  _finishedRuns = /* @__PURE__ */ new Map();
  claudeBinary;
  constructor() {
    super();
    this.claudeBinary = this._findClaudeBinary();
    this._ensureSpawnHelperExecutable();
    log$5(`Claude binary: ${this.claudeBinary}`);
  }
  /**
   * node-pty prebuilt spawn-helper may lose execute bit depending on install/archive flow.
   * Ensure it's executable at runtime to avoid "posix_spawnp failed".
   */
  _ensureSpawnHelperExecutable() {
    try {
      const pkgPath = require.resolve("node-pty/package.json");
      const path2 = require("path");
      const helperPath = path2.join(
        path2.dirname(pkgPath),
        "prebuilds",
        `${process.platform}-${process.arch}`,
        "spawn-helper"
      );
      if (!fs.existsSync(helperPath)) return;
      const st = fs.statSync(helperPath);
      const isExecutable = (st.mode & 73) !== 0;
      if (!isExecutable) {
        fs.chmodSync(helperPath, 493);
        log$5(`Fixed spawn-helper permissions: ${helperPath}`);
      }
    } catch (err) {
      log$5(`spawn-helper permission check failed: ${err.message}`);
    }
  }
  _findClaudeBinary() {
    const candidates = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(os.homedir(), ".npm-global/bin/claude")
    ];
    for (const c of candidates) {
      try {
        child_process.execSync(`test -x "${c}"`, { stdio: "ignore" });
        return c;
      } catch {
      }
    }
    try {
      return child_process.execSync('/bin/zsh -ilc "whence -p claude"', { encoding: "utf-8", env: getCliEnv() }).trim();
    } catch {
    }
    try {
      return child_process.execSync('/bin/bash -lc "which claude"', { encoding: "utf-8", env: getCliEnv() }).trim();
    } catch {
    }
    return "claude";
  }
  _getEnv() {
    const env = getCliEnv();
    const binDir = this.claudeBinary.substring(0, this.claudeBinary.lastIndexOf("/"));
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = `${binDir}:${env.PATH}`;
    }
    return env;
  }
  startRun(requestId, options) {
    if (!pty) {
      throw new Error("node-pty is not available — cannot use PTY transport");
    }
    const cwd = options.projectPath === "~" ? os.homedir() : options.projectPath;
    const args = [
      "--permission-mode",
      "default"
    ];
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }
    args.push(options.prompt);
    log$5(`Starting PTY run ${requestId}: ${this.claudeBinary} ${args.join(" ")}`);
    log$5(`Prompt: ${options.prompt.substring(0, 200)}`);
    const ptyProcess = pty.spawn(this.claudeBinary, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: this._getEnv()
    });
    log$5(`Spawned PTY PID: ${ptyProcess.pid}`);
    const handle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      pty: ptyProcess,
      pid: ptyProcess.pid,
      startedAt: Date.now(),
      rawOutputTail: [],
      stderrTail: [],
      toolCallCount: 0,
      pendingPermission: null,
      permissionPhase: "idle",
      ptyBuffer: [],
      permissionTimeout: null,
      textAccumulator: "",
      pastInit: false,
      emittedSessionInit: false,
      selectorOptions: [],
      currentOptionIndex: 0,
      runCompleteEmitted: false,
      quiescenceTimer: null,
      lastOutputAt: Date.now(),
      promptSnippet: options.prompt.trim().toLowerCase().slice(0, 24),
      sawPromptEcho: false
    };
    let lineBuffer = "";
    ptyProcess.onData((data) => {
      this._ringPush(handle.rawOutputTail, data.substring(0, 500));
      handle.lastOutputAt = Date.now();
      if (handle.quiescenceTimer) clearTimeout(handle.quiescenceTimer);
      handle.quiescenceTimer = setTimeout(() => this._checkQuiescenceCompletion(requestId, handle), QUIESCENCE_MS);
      const chars = data;
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        if (ch === "\n") {
          const completed = lineBuffer.endsWith("\r") ? lineBuffer.slice(0, -1) : lineBuffer;
          lineBuffer = "";
          this._processLine(requestId, handle, completed);
        } else if (ch === "\r") {
          const next = ci + 1 < chars.length ? chars[ci + 1] : null;
          if (next === "\n" || next === "\r") {
            lineBuffer += "\r";
          } else if (next === null) {
            lineBuffer += "\r";
          } else {
            lineBuffer = "";
          }
        } else {
          lineBuffer += ch;
        }
      }
      if (lineBuffer.length > 0) {
        const cleaned = stripAnsi(lineBuffer).trim();
        if (cleaned.length > 0) {
          this._checkPermissionInBuffer(requestId, handle, cleaned);
        }
      }
    });
    ptyProcess.onExit(({ exitCode, signal }) => {
      log$5(`PTY exited [${requestId}]: code=${exitCode} signal=${signal}`);
      if (handle.permissionTimeout) {
        clearTimeout(handle.permissionTimeout);
        handle.permissionTimeout = null;
      }
      if (handle.quiescenceTimer) {
        clearTimeout(handle.quiescenceTimer);
        handle.quiescenceTimer = null;
      }
      this._flushText(requestId, handle);
      if (!handle.runCompleteEmitted) {
        handle.runCompleteEmitted = true;
        this.emit("normalized", requestId, {
          type: "task_complete",
          result: "",
          costUsd: 0,
          durationMs: Date.now() - handle.startedAt,
          numTurns: 1,
          usage: {},
          sessionId: handle.sessionId || ""
        });
      }
      this._finishedRuns.set(requestId, handle);
      this.activeRuns.delete(requestId);
      this.emit("exit", requestId, exitCode, signal, handle.sessionId);
      setTimeout(() => this._finishedRuns.delete(requestId), 5e3);
    });
    this.activeRuns.set(requestId, handle);
    return handle;
  }
  /**
   * Process a single line of PTY output.
   */
  _processLine(requestId, handle, rawLine) {
    const cleaned = stripAnsi(rawLine).trim();
    if (cleaned.length === 0) return;
    if (/^(?:\?[0-9;?]*[a-zA-Z])+$/i.test(cleaned)) return;
    if (handle.ptyBuffer.length > 0 && handle.ptyBuffer[handle.ptyBuffer.length - 1] === cleaned) return;
    this._ringPushBuffer(handle.ptyBuffer, cleaned);
    log$5(`PTY line [${requestId}]: ${cleaned.substring(0, 200)}`);
    if (!handle.emittedSessionInit) {
      const sid = extractSessionId(cleaned);
      if (sid) {
        handle.sessionId = sid;
        handle.emittedSessionInit = true;
        this.emit("normalized", requestId, {
          type: "session_init",
          sessionId: sid,
          tools: [],
          model: "",
          mcpServers: [],
          skills: [],
          version: ""
        });
      }
    }
    if (!handle.pastInit) {
      if (/^[❯>]\s+/.test(cleaned)) {
        handle.sawPromptEcho = true;
      }
      if (handle.sawPromptEcho && cleaned.startsWith("⏺")) {
        handle.pastInit = true;
      } else {
        return;
      }
    }
    if (handle.permissionPhase === "detecting" || handle.permissionPhase === "idle") {
      this._checkPermissionInBuffer(requestId, handle, cleaned);
      if (handle.permissionPhase === "waiting_user") {
        return;
      }
    }
    const toolCall = parseToolCallLine(cleaned);
    if (toolCall) {
      handle.toolCallCount++;
      this._flushText(requestId, handle);
      this.emit("normalized", requestId, {
        type: "tool_call",
        toolName: toolCall.toolName,
        toolId: `pty-tool-${handle.toolCallCount}`,
        index: handle.toolCallCount - 1
      });
      setTimeout(() => {
        this.emit("normalized", requestId, {
          type: "tool_call_complete",
          index: handle.toolCallCount - 1
        });
      }, 100);
      return;
    }
    if (isUiChrome(cleaned)) return;
    if (handle.textAccumulator.length > 0) {
      handle.textAccumulator += "\n";
    }
    const textLine = cleaned.startsWith("⏺") ? cleaned.replace(/^⏺\s*/, "") : cleaned;
    handle.textAccumulator += textLine;
    this._scheduleTextFlush(requestId, handle);
  }
  _checkQuiescenceCompletion(requestId, handle) {
    if (!this.activeRuns.has(requestId)) return;
    if (!handle.pastInit || handle.permissionPhase === "waiting_user") return;
    if (Date.now() - handle.lastOutputAt < QUIESCENCE_MS - 50) return;
    const lastLines = handle.ptyBuffer.slice(-3);
    const hasPromptMarker = lastLines.some((l) => isInputPrompt(l));
    if (!hasPromptMarker) return;
    this._flushText(requestId, handle);
    if (!handle.runCompleteEmitted) {
      handle.runCompleteEmitted = true;
      this.emit("normalized", requestId, {
        type: "task_complete",
        result: "",
        costUsd: 0,
        durationMs: Date.now() - handle.startedAt,
        numTurns: 1,
        usage: {},
        sessionId: handle.sessionId || ""
      });
    }
    try {
      handle.pty.write("/exit\n");
    } catch {
    }
    setTimeout(() => {
      if (this.activeRuns.has(requestId)) {
        try {
          handle.pty.kill();
        } catch {
        }
      }
    }, 3e3);
  }
  _textFlushTimers = /* @__PURE__ */ new Map();
  _scheduleTextFlush(requestId, handle) {
    if (this._textFlushTimers.has(requestId)) return;
    const timer2 = setTimeout(() => {
      this._textFlushTimers.delete(requestId);
      this._flushText(requestId, handle);
    }, 50);
    this._textFlushTimers.set(requestId, timer2);
  }
  _flushText(requestId, handle) {
    const timer2 = this._textFlushTimers.get(requestId);
    if (timer2) {
      clearTimeout(timer2);
      this._textFlushTimers.delete(requestId);
    }
    if (handle.textAccumulator.length > 0) {
      this.emit("normalized", requestId, {
        type: "text_chunk",
        text: handle.textAccumulator
      });
      handle.textAccumulator = "";
    }
  }
  /**
   * Check the current buffer for permission prompt patterns.
   */
  _checkPermissionInBuffer(requestId, handle, currentLine) {
    const detectionWindow = [...handle.ptyBuffer.slice(-10), currentLine];
    const permission = detectPermissionPrompt(detectionWindow);
    if (!permission) {
      const hasKeyword = /\b(?:permission|approve|allow|deny)\b/i.test(currentLine);
      if (hasKeyword && handle.permissionPhase === "idle") {
        handle.permissionPhase = "detecting";
      }
      return;
    }
    log$5(`Permission prompt detected [${requestId}]: tool=${permission.toolName}, options=${permission.options.length}`);
    handle.pendingPermission = permission;
    handle.permissionPhase = "waiting_user";
    this._flushText(requestId, handle);
    const questionId = `pty-perm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.emit("normalized", requestId, {
      type: "permission_request",
      questionId,
      toolName: permission.toolName,
      toolDescription: permission.rawPrompt,
      options: permission.options.map((o) => ({
        id: o.optionId,
        label: o.label,
        kind: o.label.toLowerCase().includes("deny") || o.label.toLowerCase().includes("reject") ? "deny" : "allow"
      }))
    });
    handle.permissionTimeout = setTimeout(() => {
      if (handle.permissionPhase === "waiting_user") {
        log$5(`Permission timeout [${requestId}] — auto-denying`);
        this.emit("normalized", requestId, {
          type: "text_chunk",
          text: "\n[Permission timed out — automatically denied after 5 minutes]\n"
        });
        try {
          handle.pty.write("\x1B");
        } catch {
        }
        handle.permissionPhase = "idle";
        handle.pendingPermission = null;
      }
    }, PERMISSION_TIMEOUT_MS$1);
  }
  /**
   * Respond to a permission prompt by sending keystrokes to the PTY.
   */
  respondToPermission(requestId, _questionId, optionId) {
    const handle = this.activeRuns.get(requestId);
    if (!handle) {
      log$5(`respondToPermission: no active run for ${requestId}`);
      return false;
    }
    if (handle.permissionPhase !== "waiting_user" || !handle.pendingPermission) {
      log$5(`respondToPermission: not waiting for permission (phase=${handle.permissionPhase})`);
      return false;
    }
    if (handle.permissionTimeout) {
      clearTimeout(handle.permissionTimeout);
      handle.permissionTimeout = null;
    }
    const option = handle.pendingPermission.options.find((o) => o.optionId === optionId);
    if (!option) {
      log$5(`respondToPermission: option ${optionId} not found`);
      return false;
    }
    log$5(`respondToPermission [${requestId}]: optionId=${optionId}, label=${option.label}`);
    const optionIndex = handle.pendingPermission.options.indexOf(option);
    const isAllow = option.label.toLowerCase().includes("allow") || option.label.toLowerCase().includes("yes");
    const isDeny = option.label.toLowerCase().includes("deny") || option.label.toLowerCase().includes("reject");
    try {
      if (isDeny) {
        handle.pty.write("n");
      } else if (isAllow && optionIndex === 0) {
        handle.pty.write("\r");
      } else {
        for (let i = 0; i < optionIndex; i++) {
          handle.pty.write("\x1B[B");
        }
        setTimeout(() => {
          try {
            handle.pty.write("\r");
          } catch {
          }
        }, 50);
      }
    } catch (err) {
      log$5(`respondToPermission: write error: ${err.message}`);
      return false;
    }
    handle.permissionPhase = "answered";
    handle.pendingPermission = null;
    setTimeout(() => {
      if (handle.permissionPhase === "answered") {
        handle.permissionPhase = "idle";
      }
    }, 500);
    return true;
  }
  /**
   * Cancel a running PTY process.
   */
  cancel(requestId) {
    const handle = this.activeRuns.get(requestId);
    if (!handle) return false;
    log$5(`Cancelling PTY run ${requestId}`);
    if (handle.permissionTimeout) {
      clearTimeout(handle.permissionTimeout);
      handle.permissionTimeout = null;
    }
    try {
      handle.pty.write("");
    } catch {
    }
    setTimeout(() => {
      if (this.activeRuns.has(requestId)) {
        log$5(`Force killing PTY run ${requestId}`);
        try {
          handle.pty.kill();
        } catch {
        }
      }
    }, 5e3);
    return true;
  }
  /**
   * Write arbitrary data to PTY stdin (for follow-up messages, etc.)
   */
  writeToStdin(requestId, message) {
    const handle = this.activeRuns.get(requestId);
    if (!handle) return false;
    log$5(`Writing to PTY stdin [${requestId}]: ${message.substring(0, 200)}`);
    try {
      handle.pty.write(message);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get an enriched error object for a failed PTY run.
   */
  getEnrichedError(requestId, exitCode) {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId);
    return {
      message: `PTY run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.rawOutputTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.permissionPhase !== "idle" || false,
      permissionDenials: []
    };
  }
  isRunning(requestId) {
    return this.activeRuns.has(requestId);
  }
  getHandle(requestId) {
    return this.activeRuns.get(requestId);
  }
  getActiveRunIds() {
    return Array.from(this.activeRuns.keys());
  }
  _ringPush(buffer2, line) {
    buffer2.push(line);
    if (buffer2.length > MAX_RING_LINES) buffer2.shift();
  }
  _ringPushBuffer(buffer2, line) {
    buffer2.push(line);
    if (buffer2.length > PTY_BUFFER_SIZE) buffer2.shift();
  }
}
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1e3;
const DEFAULT_PORT = 19836;
const MAX_BODY_SIZE = 1024 * 1024;
const DEBUG = process.env.CLUI_DEBUG === "1";
const PERMISSION_REQUIRED_TOOLS = ["Bash", "Edit", "Write", "MultiEdit"];
const SAFE_BASH_COMMANDS = /* @__PURE__ */ new Set([
  // Info / help
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "file",
  "stat",
  "ls",
  "pwd",
  "echo",
  "printf",
  "date",
  "whoami",
  "hostname",
  "uname",
  "which",
  "whence",
  "where",
  "type",
  "command",
  "man",
  "help",
  "info",
  // Search
  "find",
  "grep",
  "rg",
  "ag",
  "ack",
  "fd",
  "fzf",
  "locate",
  // Git read-only
  "git",
  // further checked: only read-only subcommands
  // Env / config
  "env",
  "printenv",
  "set",
  // Package info (read-only)
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "cargo",
  "pip",
  "pip3",
  "go",
  "rustup",
  "node",
  "python",
  "python3",
  "ruby",
  "java",
  "javac",
  // Claude CLI (read-only subcommands)
  "claude",
  // Disk / system info
  "df",
  "du",
  "free",
  "top",
  "htop",
  "ps",
  "uptime",
  "lsof",
  "tree",
  "realpath",
  "dirname",
  "basename",
  // macOS
  "sw_vers",
  "system_profiler",
  "defaults",
  "mdls",
  "mdfind",
  // Diff / compare
  "diff",
  "cmp",
  "comm",
  "sort",
  "uniq",
  "cut",
  "awk",
  "sed",
  "jq",
  "yq",
  "xargs",
  "tr"
]);
const GIT_MUTATING_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "push",
  "commit",
  "merge",
  "rebase",
  "reset",
  "checkout",
  "switch",
  "branch",
  "tag",
  "stash",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "clean",
  "rm",
  "mv",
  "restore",
  "bisect",
  "pull",
  "fetch",
  "clone",
  "init",
  "submodule",
  "worktree",
  "gc",
  "prune",
  "filter-branch"
]);
const CLAUDE_MUTATING_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "config",
  "login",
  "logout"
]);
function isSafeBashCommand(command) {
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const segments = trimmed.split(/\s*(?:;|&&|\|\||[|])\s*/);
  for (const segment of segments) {
    const parts = segment.trim().split(/\s+/);
    const cmd = parts[0];
    if (!cmd) continue;
    const actualCmd = cmd.includes("=") ? parts[1] : cmd;
    if (!actualCmd) continue;
    const base = actualCmd.split("/").pop() || actualCmd;
    if (!SAFE_BASH_COMMANDS.has(base)) return false;
    if (base === "git") {
      const subIdx = cmd.includes("=") ? 2 : 1;
      const sub = parts[subIdx];
      if (sub && GIT_MUTATING_SUBCOMMANDS.has(sub)) return false;
    }
    if (base === "claude") {
      const subIdx = cmd.includes("=") ? 2 : 1;
      const sub = parts[subIdx];
      if (sub && CLAUDE_MUTATING_SUBCOMMANDS.has(sub)) return false;
      if (sub === "mcp") {
        const mcpSub = parts[subIdx + 1];
        if (mcpSub && mcpSub !== "list" && mcpSub !== "get" && mcpSub !== "--help") return false;
      }
    }
    if (["npm", "yarn", "pnpm", "bun"].includes(base)) {
      const subIdx = cmd.includes("=") ? 2 : 1;
      const sub = parts[subIdx];
      if (sub && ["install", "i", "add", "remove", "uninstall", "publish", "run", "exec", "dlx", "npx", "create", "init", "link", "unlink", "pack", "deprecate"].includes(sub)) return false;
    }
    if (segment.includes(">") && !segment.includes(">/dev/null") && !segment.includes("2>/dev/null") && !segment.includes("2>&1")) return false;
  }
  return true;
}
const HOOK_MATCHER = `^(${PERMISSION_REQUIRED_TOOLS.join("|")}|mcp__.*)$`;
const SENSITIVE_FIELD_RE = /token|password|secret|key|auth|credential|api.?key/i;
const VALID_ALLOW_DECISIONS = /* @__PURE__ */ new Set(["allow", "allow-session", "allow-domain"]);
const VALID_DECISIONS = /* @__PURE__ */ new Set([...VALID_ALLOW_DECISIONS, "deny"]);
function log$4(msg) {
  log$7("PermissionServer", msg);
}
function extractDomain(url) {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
function denyResponse(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function allowResponse(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason
    }
  };
}
class PermissionServer extends events.EventEmitter {
  server = null;
  pendingRequests = /* @__PURE__ */ new Map();
  port;
  _actualPort = null;
  /** Per-launch secret — validates that requests come from our hooks */
  appSecret;
  /** Per-run tokens → run registration (tabId, requestId, sessionId) */
  runTokens = /* @__PURE__ */ new Map();
  /** Scoped "allow always" keys. Format varies by tool type. */
  scopedAllows = /* @__PURE__ */ new Set();
  /** Tracked generated settings files: runToken → filePath */
  settingsFiles = /* @__PURE__ */ new Map();
  constructor(port = DEFAULT_PORT) {
    super();
    this.port = port;
    this.appSecret = crypto$1.randomUUID();
  }
  async start() {
    if (this.server) {
      log$4("Server already running");
      return this._actualPort || this.port;
    }
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          log$4(`Port ${this.port} in use, trying ${this.port + 1}`);
          this.port++;
          this.server.listen(this.port, "127.0.0.1");
        } else {
          log$4(`Server error: ${err.message}`);
          reject(err);
        }
      });
      this.server.listen(this.port, "127.0.0.1", () => {
        this._actualPort = this.port;
        log$4(`Permission server listening on 127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });
  }
  stop() {
    for (const [qid, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve({ decision: "deny", reason: "Server shutting down" });
      this.pendingRequests.delete(qid);
    }
    for (const [, filePath] of this.settingsFiles) {
      try {
        fs.unlinkSync(filePath);
      } catch {
      }
    }
    this.settingsFiles.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      log$4("Permission server stopped");
    }
  }
  getPort() {
    return this._actualPort;
  }
  // ─── Run Registration ───
  /**
   * Register a new run. Returns a unique run token.
   * The run token is embedded in the hook URL for per-run routing.
   */
  registerRun(tabId, requestId, sessionId) {
    const runToken = crypto$1.randomUUID();
    this.runTokens.set(runToken, { tabId, requestId, sessionId });
    log$4(`Registered run: token=${runToken.substring(0, 8)}… tab=${tabId.substring(0, 8)}…`);
    return runToken;
  }
  /**
   * Unregister a run. Denies any pending requests for this run and cleans up its settings file.
   */
  unregisterRun(runToken) {
    const reg = this.runTokens.get(runToken);
    if (!reg) return;
    for (const [qid, pending] of this.pendingRequests) {
      if (pending.runToken === runToken) {
        clearTimeout(pending.timeout);
        pending.resolve({ decision: "deny", reason: "Run ended" });
        this.pendingRequests.delete(qid);
      }
    }
    const filePath = this.settingsFiles.get(runToken);
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch {
      }
      this.settingsFiles.delete(runToken);
    }
    this.runTokens.delete(runToken);
    log$4(`Unregistered run: token=${runToken.substring(0, 8)}…`);
  }
  // ─── Permission Response ───
  /**
   * Respond to a pending permission request.
   * decision: 'allow' (once), 'allow-session' (for session), 'allow-domain' (WebFetch domain), 'deny'
   */
  respondToPermission(questionId, decision, reason) {
    const pending = this.pendingRequests.get(questionId);
    if (!pending) {
      log$4(`respondToPermission: no pending request for ${questionId}`);
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(questionId);
    if (!VALID_DECISIONS.has(decision)) {
      log$4(`Unknown decision "${decision}" for [${questionId}] — denying (fail-closed)`);
      pending.resolve({ decision: "deny", reason: `Unknown decision: ${decision}` });
      return true;
    }
    const toolName = pending.toolRequest.tool_name;
    const sessionId = pending.toolRequest.session_id;
    if (decision === "allow-session") {
      const key = `session:${sessionId}:tool:${toolName}`;
      this.scopedAllows.add(key);
      log$4(`Session-allowed ${toolName} for session ${sessionId.substring(0, 8)}…`);
    } else if (decision === "allow-domain") {
      const domain = extractDomain(pending.toolRequest.tool_input?.url);
      if (domain) {
        const key = `session:${sessionId}:webfetch:${domain}`;
        this.scopedAllows.add(key);
        log$4(`Domain-allowed ${domain} for session ${sessionId.substring(0, 8)}…`);
      }
    }
    const hookDecision = VALID_ALLOW_DECISIONS.has(decision) ? "allow" : "deny";
    if (DEBUG) {
      log$4(`respondToPermission [${questionId}]: ${decision} (tool=${toolName})`);
    } else {
      log$4(`Permission: ${toolName} → ${hookDecision}`);
    }
    pending.resolve({ decision: hookDecision, reason });
    return true;
  }
  // ─── Dynamic Options ───
  /**
   * Get permission card options for a given tool + input.
   * WebFetch gets domain-scoped options; all others get session-scoped.
   */
  getOptionsForTool(toolName, toolInput) {
    if (toolName === "Bash") {
      return [
        { id: "allow", label: "Allow Once", kind: "allow" },
        { id: "deny", label: "Deny", kind: "deny" }
      ];
    }
    return [
      { id: "allow", label: "Allow Once", kind: "allow" },
      { id: "allow-session", label: "Allow for Session", kind: "allow" },
      { id: "deny", label: "Deny", kind: "deny" }
    ];
  }
  // ─── Settings File Generation ───
  /**
   * Generate a per-run settings file with the PreToolUse HTTP hook.
   * The URL includes both appSecret and runToken for authentication.
   */
  generateSettingsFile(runToken) {
    const port = this._actualPort || this.port;
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: HOOK_MATCHER,
            hooks: [
              {
                type: "http",
                url: `http://127.0.0.1:${port}/hook/pre-tool-use/${this.appSecret}/${runToken}`,
                timeout: 300
              }
            ]
          }
        ]
      }
    };
    const dir = path.join(os.tmpdir(), "clui-hook-config");
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 448 });
    } catch {
    }
    const filePath = path.join(dir, `clui-hook-${runToken}.json`);
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), { mode: 384 });
    this.settingsFiles.set(runToken, filePath);
    if (DEBUG) {
      log$4(`Generated settings file: ${filePath}`);
    }
    return filePath;
  }
  // ─── HTTP Request Handling ───
  async _handleRequest(req, res) {
    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Not found")));
      return;
    }
    const segments = (req.url || "").split("/").filter(Boolean);
    if (segments.length !== 4 || segments[0] !== "hook" || segments[1] !== "pre-tool-use") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Invalid path")));
      return;
    }
    const urlSecret = segments[2];
    const urlToken = segments[3];
    if (urlSecret !== this.appSecret) {
      log$4("Rejected request: invalid app secret");
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Invalid credentials")));
      return;
    }
    const registration = this.runTokens.get(urlToken);
    if (!registration) {
      log$4(`Rejected request: unknown run token ${urlToken.substring(0, 8)}…`);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Unknown run")));
      return;
    }
    let body = "";
    let bodySize = 0;
    for await (const chunk of req) {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        log$4("Rejected request: body too large");
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify(denyResponse("Request too large")));
        return;
      }
      body += chunk;
    }
    let toolRequest;
    try {
      toolRequest = JSON.parse(body);
    } catch {
      log$4("Rejected request: invalid JSON");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Invalid JSON")));
      return;
    }
    if (!toolRequest.tool_name || !toolRequest.session_id || !toolRequest.hook_event_name) {
      log$4("Rejected request: missing required fields");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Missing required fields")));
      return;
    }
    if (toolRequest.hook_event_name !== "PreToolUse") {
      log$4(`Rejected request: unexpected hook event ${toolRequest.hook_event_name}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(denyResponse("Unexpected hook event")));
      return;
    }
    if (DEBUG) {
      log$4(`Hook request: tool=${toolRequest.tool_name} id=${toolRequest.tool_use_id} session=${toolRequest.session_id} tab=${registration.tabId.substring(0, 8)}…`);
    } else {
      log$4(`Hook: ${toolRequest.tool_name} → tab=${registration.tabId.substring(0, 8)}…`);
    }
    const sessionId = toolRequest.session_id;
    const toolName = toolRequest.tool_name;
    if (this.scopedAllows.has(`session:${sessionId}:tool:${toolName}`)) {
      if (DEBUG) log$4(`Auto-allowing ${toolName} (session-allowed)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(allowResponse("Allowed for session by user")));
      return;
    }
    if (toolName === "WebFetch") {
      const domain = extractDomain(toolRequest.tool_input?.url);
      if (domain && this.scopedAllows.has(`session:${sessionId}:webfetch:${domain}`)) {
        if (DEBUG) log$4(`Auto-allowing WebFetch to ${domain} (domain-allowed)`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(allowResponse(`Domain ${domain} allowed by user`)));
        return;
      }
    }
    if (toolName === "Bash" && isSafeBashCommand(toolRequest.tool_input?.command)) {
      if (DEBUG) log$4(`Auto-allowing safe Bash: ${String(toolRequest.tool_input?.command).substring(0, 80)}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(allowResponse("Safe read-only command")));
      return;
    }
    const questionId = `hook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const decision = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log$4(`Permission timeout [${questionId}] — auto-denying`);
        this.pendingRequests.delete(questionId);
        resolve({ decision: "deny", reason: "Permission timed out after 5 minutes" });
      }, PERMISSION_TIMEOUT_MS);
      this.pendingRequests.set(questionId, {
        toolRequest,
        resolve,
        timeout,
        questionId,
        runToken: urlToken
      });
      const options = this.getOptionsForTool(toolName, toolRequest.tool_input);
      this.emit("permission-request", questionId, toolRequest, registration.tabId, options);
    });
    const hookResponse = decision.decision === "allow" ? allowResponse(decision.reason || "Approved by user") : denyResponse(decision.reason || "Denied by user");
    if (DEBUG) {
      log$4(`Hook response [${questionId}]: ${decision.decision}`);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(hookResponse));
  }
}
function maskSensitiveFields(input) {
  const masked = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      masked[key] = "***";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      masked[key] = maskSensitiveFields(value);
    } else if (Array.isArray(value)) {
      masked[key] = value.map(
        (item) => item !== null && typeof item === "object" && !Array.isArray(item) ? maskSensitiveFields(item) : item
      );
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
const MAX_QUEUE_DEPTH = 32;
function log$3(msg) {
  log$7("ControlPlane", msg);
}
class ControlPlane extends events.EventEmitter {
  tabs = /* @__PURE__ */ new Map();
  inflightRequests = /* @__PURE__ */ new Map();
  requestQueue = [];
  runManager;
  ptyRunManager;
  /** Feature flag: use PTY transport for interactive permissions */
  interactivePty;
  /** Tracks which runs are using PTY transport (by requestId) */
  ptyRuns = /* @__PURE__ */ new Set();
  /** Tracks requestIds that are warmup init requests (invisible to renderer) */
  initRequestIds = /* @__PURE__ */ new Set();
  /** Permission hook server for PreToolUse HTTP hooks */
  permissionServer;
  /** Per-run tokens: requestId → runToken (for cleanup on exit/error) */
  runTokens = /* @__PURE__ */ new Map();
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves */
  permissionMode = "ask";
  /** Resolves when the permission server is ready (or failed). Dispatch awaits this. */
  hookServerReady;
  constructor(interactivePty = false) {
    super();
    this.interactivePty = interactivePty;
    this.runManager = new RunManager();
    this.ptyRunManager = new PtyRunManager();
    this.permissionServer = new PermissionServer();
    this.hookServerReady = this.permissionServer.start().then((port) => {
      log$3(`Permission hook server ready on port ${port}`);
    }).catch((err) => {
      log$3(`Failed to start permission hook server: ${err.message}`);
    });
    this.permissionServer.on("permission-request", (questionId, toolRequest, tabId, options) => {
      if (!this.tabs.has(tabId)) {
        log$3(`Permission request for closed tab ${tabId.substring(0, 8)}… — auto-denying`);
        this.permissionServer.respondToPermission(questionId, "deny", "Tab closed");
        return;
      }
      log$3(`Permission request [${questionId}]: tool=${toolRequest.tool_name} tab=${tabId.substring(0, 8)}… mode=${this.permissionMode}`);
      if (this.permissionMode === "auto") {
        this.permissionServer.respondToPermission(questionId, "allow", "Auto mode");
        return;
      }
      const safeInput = toolRequest.tool_input ? maskSensitiveFields(toolRequest.tool_input) : void 0;
      const permEvent = {
        type: "permission_request",
        questionId,
        toolName: toolRequest.tool_name,
        toolDescription: void 0,
        toolInput: safeInput,
        options
      };
      this.emit("event", tabId, permEvent);
    });
    log$3(`Interactive PTY transport: ${interactivePty ? "ENABLED" : "disabled"}`);
    this._wirePtyEvents();
    this.runManager.on("normalized", (requestId, event) => {
      const tabId = this._findTabByRequest(requestId);
      if (!tabId) return;
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.lastActivityAt = Date.now();
      if (event.type === "session_init") {
        tab.claudeSessionId = event.sessionId;
        if (this.initRequestIds.has(requestId)) {
          this.emit("event", tabId, { ...event, isWarmup: true });
          return;
        }
        if (tab.status === "connecting") {
          this._setTabStatus(tabId, "running");
        }
      }
      if (this.initRequestIds.has(requestId)) {
        return;
      }
      this.emit("event", tabId, event);
    });
    this.runManager.on("exit", (requestId, code, signal, sessionId) => {
      const runToken = this.runTokens.get(requestId);
      if (runToken) {
        this.permissionServer.unregisterRun(runToken);
        this.runTokens.delete(requestId);
      }
      const tabId = this._findTabByRequest(requestId);
      const inflight = this.inflightRequests.get(requestId);
      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve();
          this.inflightRequests.delete(requestId);
        }
        return;
      }
      const tab = this.tabs.get(tabId);
      tab.activeRequestId = null;
      tab.runPid = null;
      if (sessionId) tab.claudeSessionId = sessionId;
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId);
        this._setTabStatus(tabId, "idle");
        if (inflight) {
          inflight.resolve();
          this.inflightRequests.delete(requestId);
        }
        this._processQueue(tabId);
        return;
      }
      if (code === 0) {
        this._setTabStatus(tabId, "completed");
      } else if (signal === "SIGINT" || signal === "SIGKILL") {
        this._setTabStatus(tabId, "failed");
      } else {
        const enriched = this.runManager.getEnrichedError(requestId, code);
        this.emit("error", tabId, enriched);
        this._setTabStatus(tabId, code === null ? "dead" : "failed");
      }
      if (inflight) {
        inflight.resolve();
        this.inflightRequests.delete(requestId);
      }
      this._processQueue(tabId);
    });
    this.runManager.on("error", (requestId, err) => {
      const runToken = this.runTokens.get(requestId);
      if (runToken) {
        this.permissionServer.unregisterRun(runToken);
        this.runTokens.delete(requestId);
      }
      const tabId = this._findTabByRequest(requestId);
      const inflight = this.inflightRequests.get(requestId);
      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err);
          this.inflightRequests.delete(requestId);
        }
        return;
      }
      const tab = this.tabs.get(tabId);
      tab.activeRequestId = null;
      tab.runPid = null;
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId);
        log$3(`Init session error for tab ${tabId}: ${err.message}`);
        this._setTabStatus(tabId, "idle");
        if (inflight) {
          inflight.reject(err);
          this.inflightRequests.delete(requestId);
        }
        this._processQueue(tabId);
        return;
      }
      this._setTabStatus(tabId, "dead");
      const enriched = this.runManager.getEnrichedError(requestId, null);
      enriched.message = err.message;
      this.emit("error", tabId, enriched);
      if (inflight) {
        inflight.reject(err);
        this.inflightRequests.delete(requestId);
      }
    });
  }
  /**
   * Wire PtyRunManager events using the same routing logic as RunManager.
   */
  _wirePtyEvents() {
    this.ptyRunManager.on("normalized", (requestId, event) => {
      const tabId = this._findTabByRequest(requestId);
      if (!tabId) return;
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.lastActivityAt = Date.now();
      if (event.type === "session_init") {
        tab.claudeSessionId = event.sessionId;
        if (this.initRequestIds.has(requestId)) {
          this.emit("event", tabId, { ...event, isWarmup: true });
          return;
        }
        if (tab.status === "connecting") {
          this._setTabStatus(tabId, "running");
        }
      }
      if (this.initRequestIds.has(requestId)) return;
      this.emit("event", tabId, event);
    });
    this.ptyRunManager.on("exit", (requestId, code, signal, sessionId) => {
      const runToken = this.runTokens.get(requestId);
      if (runToken) {
        this.permissionServer.unregisterRun(runToken);
        this.runTokens.delete(requestId);
      }
      const tabId = this._findTabByRequest(requestId);
      const inflight = this.inflightRequests.get(requestId);
      this.ptyRuns.delete(requestId);
      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve();
          this.inflightRequests.delete(requestId);
        }
        return;
      }
      const tab = this.tabs.get(tabId);
      tab.activeRequestId = null;
      tab.runPid = null;
      if (sessionId) tab.claudeSessionId = sessionId;
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId);
        this._setTabStatus(tabId, "idle");
        if (inflight) {
          inflight.resolve();
          this.inflightRequests.delete(requestId);
        }
        this._processQueue(tabId);
        return;
      }
      if (code === 0) {
        this._setTabStatus(tabId, "completed");
      } else if (signal) {
        this._setTabStatus(tabId, "failed");
      } else {
        const enriched = this.ptyRunManager.getEnrichedError(requestId, code);
        this.emit("error", tabId, enriched);
        this._setTabStatus(tabId, code === null ? "dead" : "failed");
      }
      if (inflight) {
        inflight.resolve();
        this.inflightRequests.delete(requestId);
      }
      this._processQueue(tabId);
    });
    this.ptyRunManager.on("error", (requestId, err) => {
      const runToken = this.runTokens.get(requestId);
      if (runToken) {
        this.permissionServer.unregisterRun(runToken);
        this.runTokens.delete(requestId);
      }
      const tabId = this._findTabByRequest(requestId);
      const inflight = this.inflightRequests.get(requestId);
      this.ptyRuns.delete(requestId);
      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err);
          this.inflightRequests.delete(requestId);
        }
        return;
      }
      const tab = this.tabs.get(tabId);
      tab.activeRequestId = null;
      tab.runPid = null;
      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId);
        log$3(`PTY init session error for tab ${tabId}: ${err.message}`);
        this._setTabStatus(tabId, "idle");
        if (inflight) {
          inflight.reject(err);
          this.inflightRequests.delete(requestId);
        }
        this._processQueue(tabId);
        return;
      }
      this._setTabStatus(tabId, "dead");
      const enriched = this.ptyRunManager.getEnrichedError(requestId, null);
      enriched.message = err.message;
      this.emit("error", tabId, enriched);
      if (inflight) {
        inflight.reject(err);
        this.inflightRequests.delete(requestId);
      }
    });
  }
  // ─── Tab Lifecycle ───
  createTab() {
    const tabId = crypto.randomUUID();
    const entry = {
      tabId,
      claudeSessionId: null,
      status: "idle",
      activeRequestId: null,
      runPid: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      promptCount: 0
    };
    this.tabs.set(tabId, entry);
    log$3(`Tab created: ${tabId}`);
    return tabId;
  }
  /**
   * Eagerly initialize a session for a tab by running a minimal prompt.
   * Populates session metadata (model, MCP servers, tools) without visible messages.
   */
  initSession(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const requestId = `init-${tabId}`;
    this.initRequestIds.add(requestId);
    this.submitPrompt(tabId, requestId, {
      prompt: "hi",
      projectPath: process.cwd(),
      maxTurns: 1
    }).catch((err) => {
      this.initRequestIds.delete(requestId);
      log$3(`Init session failed for tab ${tabId}: ${err.message}`);
    });
  }
  /**
   * Clear stored session ID for a tab — used when working directory changes
   * so _dispatch won't inject a stale --resume from the old directory.
   */
  resetTabSession(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    log$3(`Resetting session for tab ${tabId} (was: ${tab.claudeSessionId})`);
    tab.claudeSessionId = null;
  }
  /**
   * Set global permission mode.
   * 'ask' = show permission cards, 'auto' = auto-approve all tool calls.
   */
  setPermissionMode(mode) {
    log$3(`Permission mode set to: ${mode}`);
    this.permissionMode = mode;
  }
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab.activeRequestId) {
      this.cancel(tab.activeRequestId);
      const inflight = this.inflightRequests.get(tab.activeRequestId);
      if (inflight) {
        inflight.reject(new Error("Tab closed"));
        this.inflightRequests.delete(tab.activeRequestId);
      }
    }
    this.requestQueue = this.requestQueue.filter((r) => {
      if (r.tabId === tabId) {
        const reason = new Error("Tab closed");
        r.reject(reason);
        for (const w of r.extraWaiters) w.reject(reason);
        return false;
      }
      return true;
    });
    this.tabs.delete(tabId);
    log$3(`Tab closed: ${tabId}`);
  }
  // ─── Submit Prompt ───
  /**
   * Submit a prompt to a specific tab. Returns a promise that resolves
   * when the run completes.
   *
   * Guards:
   *  - Rejects without targetSession (tabId)
   *  - Returns existing promise for duplicate requestId (idempotency)
   *  - Queues if tab is busy, rejects if queue is full
   */
  async submitPrompt(tabId, requestId, options) {
    if (!tabId) {
      throw new Error("No targetSession (tabId) provided — rejecting to prevent misrouting");
    }
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} does not exist`);
    }
    const existing = this.inflightRequests.get(requestId);
    if (existing) {
      log$3(`Duplicate requestId ${requestId} — returning existing inflight promise`);
      return existing.promise;
    }
    const queued = this.requestQueue.find((r) => r.requestId === requestId);
    if (queued) {
      log$3(`Duplicate requestId ${requestId} — already queued, adding waiter`);
      return new Promise((resolve, reject) => {
        queued.extraWaiters.push({ resolve, reject });
      });
    }
    if (tab.activeRequestId) {
      if (this.requestQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error("Request queue full — back-pressure");
      }
      log$3(`Tab ${tabId} busy — queuing request ${requestId} (queue depth: ${this.requestQueue.length + 1})`);
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          requestId,
          tabId,
          options,
          resolve,
          reject,
          enqueuedAt: Date.now(),
          extraWaiters: []
        });
      });
    }
    return this._dispatch(tabId, requestId, options);
  }
  async _dispatch(tabId, requestId, options) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} disappeared`);
    await this.hookServerReady;
    if (tab.claudeSessionId && !options.sessionId) {
      options = { ...options, sessionId: tab.claudeSessionId };
    }
    if (this.permissionServer.getPort()) {
      const runToken = this.permissionServer.registerRun(tabId, requestId, options.sessionId || null);
      this.runTokens.set(requestId, runToken);
      const hookSettingsPath = this.permissionServer.generateSettingsFile(runToken);
      options = { ...options, hookSettingsPath };
    }
    tab.activeRequestId = requestId;
    if (!this.initRequestIds.has(requestId)) tab.promptCount++;
    tab.lastActivityAt = Date.now();
    const newStatus = tab.claudeSessionId ? "running" : "connecting";
    this._setTabStatus(tabId, newStatus);
    const usePty = false;
    let pid = null;
    try {
      if (usePty) ;
      else {
        const handle = this.runManager.startRun(requestId, options);
        pid = handle.pid;
      }
      tab.runPid = pid;
    } catch (err) {
      tab.activeRequestId = null;
      tab.runPid = null;
      this._setTabStatus(tabId, "failed");
      throw err;
    }
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.inflightRequests.set(requestId, { requestId, tabId, promise, resolve, reject });
    return promise;
  }
  // ─── Cancel ───
  cancel(requestId) {
    const queueIdx = this.requestQueue.findIndex((r) => r.requestId === requestId);
    if (queueIdx !== -1) {
      const req = this.requestQueue.splice(queueIdx, 1)[0];
      const reason = new Error("Request cancelled");
      req.reject(reason);
      for (const w of req.extraWaiters) w.reject(reason);
      log$3(`Cancelled queued request ${requestId}`);
      return true;
    }
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.cancel(requestId);
    }
    return this.runManager.cancel(requestId);
  }
  /**
   * Cancel active run on a tab (by tabId instead of requestId).
   */
  cancelTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab?.activeRequestId) return false;
    return this.cancel(tab.activeRequestId);
  }
  // ─── Retry ───
  /**
   * Retry: re-submit the same prompt on the same tab/session.
   * If the tab is dead, creates a fresh session.
   */
  async retry(tabId, requestId, options) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} does not exist`);
    if (tab.status === "dead") {
      tab.claudeSessionId = null;
      this._setTabStatus(tabId, "idle");
    }
    return this.submitPrompt(tabId, requestId, options);
  }
  // ─── Permission Response ───
  respondToPermission(tabId, questionId, optionId) {
    if (questionId.startsWith("hook-")) {
      return this.permissionServer.respondToPermission(questionId, optionId);
    }
    const tab = this.tabs.get(tabId);
    if (!tab?.activeRequestId) return false;
    if (this.ptyRuns.has(tab.activeRequestId)) {
      return this.ptyRunManager.respondToPermission(tab.activeRequestId, questionId, optionId);
    }
    const msg = {
      type: "permission_response",
      question_id: questionId,
      option_id: optionId
    };
    return this.runManager.writeToStdin(tab.activeRequestId, msg);
  }
  // ─── Health ───
  getHealth() {
    const tabEntries = [];
    for (const [tabId, tab] of this.tabs) {
      let alive = false;
      if (tab.activeRequestId) {
        alive = this.runManager.isRunning(tab.activeRequestId) || this.ptyRunManager.isRunning(tab.activeRequestId);
      }
      tabEntries.push({
        tabId,
        status: tab.status,
        activeRequestId: tab.activeRequestId,
        claudeSessionId: tab.claudeSessionId,
        alive
      });
    }
    return {
      tabs: tabEntries,
      queueDepth: this.requestQueue.length
    };
  }
  getTabStatus(tabId) {
    return this.tabs.get(tabId);
  }
  getEnrichedError(requestId, exitCode) {
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.getEnrichedError(requestId, exitCode);
    }
    return this.runManager.getEnrichedError(requestId, exitCode);
  }
  // ─── Queue Processing ───
  _processQueue(tabId) {
    const idx = this.requestQueue.findIndex((r) => r.tabId === tabId);
    if (idx === -1) return;
    const req = this.requestQueue.splice(idx, 1)[0];
    log$3(`Processing queued request ${req.requestId} for tab ${tabId}`);
    this._dispatch(tabId, req.requestId, req.options).then((v) => {
      req.resolve(v);
      for (const w of req.extraWaiters) w.resolve(v);
    }).catch((e) => {
      req.reject(e);
      for (const w of req.extraWaiters) w.reject(e);
    });
  }
  // ─── Internal ───
  _findTabByRequest(requestId) {
    const inflight = this.inflightRequests.get(requestId);
    if (inflight) return inflight.tabId;
    for (const [tabId, tab] of this.tabs) {
      if (tab.activeRequestId === requestId) return tabId;
    }
    return null;
  }
  _setTabStatus(tabId, newStatus) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const oldStatus = tab.status;
    if (oldStatus === newStatus) return;
    tab.status = newStatus;
    log$3(`Tab ${tabId}: ${oldStatus} → ${newStatus}`);
    this.emit("tab-status-change", tabId, newStatus, oldStatus);
  }
  // ─── Shutdown ───
  shutdown() {
    log$3("Shutting down control plane");
    this.permissionServer.stop();
    for (const [tabId] of this.tabs) {
      this.closeTab(tabId);
    }
  }
}
const SKILLS = [
  {
    name: "skill-creator",
    source: {
      type: "github",
      repo: "anthropics/skills",
      path: "skills/skill-creator",
      commitSha: "b0cbd3df1533b396d281a6886d5132f623393a9c"
    },
    version: "1.0.0",
    requiredFiles: [
      "SKILL.md",
      "agents/grader.md",
      "agents/comparator.md",
      "agents/analyzer.md",
      "references/schemas.md",
      "scripts/run_loop.py",
      "scripts/run_eval.py",
      "scripts/package_skill.py"
    ]
  }
];
const BUNDLED_SKILLS_DIR = path.join(__dirname, "../../skills");
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const VERSION_FILE = ".clui-version";
function log$2(msg) {
  const { appendFileSync } = require("fs");
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] [skills] ${msg}
`;
  try {
    appendFileSync(path.join(os.homedir(), ".clui-debug.log"), line);
  } catch {
  }
}
function readVersionFile(skillDir) {
  const fp = path.join(skillDir, VERSION_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}
function writeVersionFile(skillDir, entry) {
  const meta = {
    version: entry.version,
    source: entry.source.type === "github" ? `github:${entry.source.repo}@${entry.source.commitSha}` : "bundled",
    installedBy: "clui",
    installedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs.writeFileSync(path.join(skillDir, VERSION_FILE), JSON.stringify(meta, null, 2) + "\n");
}
function validateSkill(dir, requiredFiles) {
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(dir, f))) {
      return `Missing required file: ${f}`;
    }
  }
  return null;
}
async function installGithubSkill(entry, onStatus) {
  const targetDir = path.join(SKILLS_DIR, entry.name);
  const tmpDir = path.join(SKILLS_DIR, `.tmp-${entry.name}-${crypto$1.randomUUID().slice(0, 8)}`);
  onStatus({ name: entry.name, state: "downloading" });
  log$2(`Downloading ${entry.name} from ${entry.source.repo}@${entry.source.commitSha}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const { repo, path: path2, commitSha } = entry.source;
    const pathDepth = path2.split("/").length + 1;
    const tarballUrl = `https://api.github.com/repos/${repo}/tarball/${commitSha}`;
    const cmd = [
      `curl -sL "${tarballUrl}"`,
      "|",
      `tar -xz --strip-components=${pathDepth} -C "${tmpDir}" "*/${path2}"`
    ].join(" ");
    child_process.execSync(cmd, { timeout: 6e4, stdio: "pipe" });
    onStatus({ name: entry.name, state: "validating" });
    const err = validateSkill(tmpDir, entry.requiredFiles);
    if (err) {
      throw new Error(`Validation failed: ${err}`);
    }
    if (fs.existsSync(targetDir)) {
      const existing = readVersionFile(targetDir);
      if (existing?.installedBy === "clui") {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } else {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        onStatus({ name: entry.name, state: "skipped", reason: "user-managed" });
        return;
      }
    }
    fs.renameSync(tmpDir, targetDir);
    writeVersionFile(targetDir, entry);
    log$2(`Installed ${entry.name} v${entry.version}`);
    onStatus({ name: entry.name, state: "installed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log$2(`Failed to install ${entry.name}: ${msg}`);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
    }
    onStatus({ name: entry.name, state: "failed", error: msg });
  }
}
async function installBundledSkill(entry, onStatus) {
  const sourceDir = path.join(BUNDLED_SKILLS_DIR, entry.name);
  const targetDir = path.join(SKILLS_DIR, entry.name);
  const tmpDir = path.join(SKILLS_DIR, `.tmp-${entry.name}-${crypto$1.randomUUID().slice(0, 8)}`);
  onStatus({ name: entry.name, state: "downloading" });
  log$2(`Copying bundled skill ${entry.name} from ${sourceDir}`);
  try {
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Bundled skill source not found: ${sourceDir}`);
    }
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.cpSync(sourceDir, tmpDir, { recursive: true });
    onStatus({ name: entry.name, state: "validating" });
    const err = validateSkill(tmpDir, entry.requiredFiles);
    if (err) {
      throw new Error(`Validation failed: ${err}`);
    }
    if (fs.existsSync(targetDir)) {
      const existing = readVersionFile(targetDir);
      if (existing?.installedBy === "clui") {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } else {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        onStatus({ name: entry.name, state: "skipped", reason: "user-managed" });
        return;
      }
    }
    fs.renameSync(tmpDir, targetDir);
    writeVersionFile(targetDir, entry);
    log$2(`Installed bundled skill ${entry.name} v${entry.version}`);
    onStatus({ name: entry.name, state: "installed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log$2(`Failed to install bundled skill ${entry.name}: ${msg}`);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
    }
    onStatus({ name: entry.name, state: "failed", error: msg });
  }
}
async function installSkill(entry, onStatus) {
  const targetDir = path.join(SKILLS_DIR, entry.name);
  if (fs.existsSync(targetDir)) {
    const meta = readVersionFile(targetDir);
    if (!meta) {
      log$2(`Skipping ${entry.name}: user-managed (no ${VERSION_FILE})`);
      onStatus({ name: entry.name, state: "skipped", reason: "user-managed" });
      return;
    }
    if (meta.version === entry.version && meta.installedBy === "clui") {
      const validationErr = validateSkill(targetDir, entry.requiredFiles);
      if (!validationErr) {
        log$2(`Skipping ${entry.name}: already at v${entry.version}`);
        onStatus({ name: entry.name, state: "skipped", reason: "up-to-date" });
        return;
      }
      log$2(`Repairing ${entry.name}: version matches but ${validationErr}`);
    }
    log$2(`Updating ${entry.name}: v${meta.version} → v${entry.version}`);
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (entry.source.type === "github") {
    await installGithubSkill(
      entry,
      onStatus
    );
  } else {
    await installBundledSkill(entry, onStatus);
  }
}
async function ensureSkills(onStatus = () => {
}) {
  log$2(`Checking ${SKILLS.length} skill(s)`);
  for (const entry of SKILLS) {
    onStatus({ name: entry.name, state: "pending" });
    try {
      await installSkill(entry, onStatus);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log$2(`Unexpected error installing ${entry.name}: ${msg}`);
      onStatus({ name: entry.name, state: "failed", error: msg });
    }
  }
  log$2("Skill provisioning complete");
}
function log$1(msg) {
  log$7("marketplace", msg);
}
const SOURCES = [
  { repo: "anthropics/skills", category: "Agent Skills" },
  { repo: "anthropics/knowledge-work-plugins", category: "Knowledge Work" },
  { repo: "anthropics/financial-services-plugins", category: "Financial Services" }
];
let cachedPlugins = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1e3;
const skillContentCache = /* @__PURE__ */ new Map();
async function fetchCatalog(forceRefresh) {
  if (!forceRefresh && cachedPlugins && Date.now() - cacheTimestamp < CACHE_TTL) {
    return { plugins: cachedPlugins, error: null };
  }
  const allPlugins = [];
  const errors = [];
  const results = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const marketplaceUrl = `https://raw.githubusercontent.com/${source.repo}/main/.claude-plugin/marketplace.json`;
      log$1(`Fetching marketplace: ${marketplaceUrl}`);
      const marketplaceRes = await netFetch(marketplaceUrl);
      if (!marketplaceRes.ok) {
        throw new Error(`Failed to fetch marketplace for ${source.repo}: ${marketplaceRes.status}`);
      }
      const marketplaceData = JSON.parse(marketplaceRes.body);
      const safeMarketplaceName = typeof marketplaceData.name === "string" && marketplaceData.name.trim().length > 0 ? marketplaceData.name.trim() : source.repo;
      const jobs = [];
      for (const entry of marketplaceData.plugins) {
        let entryAuthor = "";
        if (entry.author) {
          entryAuthor = typeof entry.author === "string" ? entry.author : entry.author.name || "";
        }
        if (entry.skills && entry.skills.length > 0) {
          for (const skillRef of entry.skills) {
            const skillPath = skillRef.replace(/^\.\//, "").replace(/\/$/, "");
            const individualName = skillPath.split("/").pop() || entry.name;
            jobs.push({
              installName: individualName,
              skillPath,
              entryDescription: entry.description || "",
              entryAuthor,
              useSkillMd: true
            });
          }
        } else {
          const normalizedSource = entry.source.replace(/^\.\//, "").replace(/\/$/, "");
          jobs.push({
            installName: entry.name,
            skillPath: normalizedSource || entry.name,
            entryDescription: entry.description || "",
            entryAuthor,
            useSkillMd: false
          });
        }
      }
      const jobResults = await Promise.allSettled(
        jobs.map(async (job) => {
          let name = "";
          let description = "";
          let version = "0.0.0";
          let author = job.entryAuthor || "Anthropic";
          if (job.useSkillMd) {
            const skillUrl = `https://raw.githubusercontent.com/${source.repo}/main/${job.skillPath}/SKILL.md`;
            try {
              const res = await netFetch(skillUrl);
              if (res.ok) {
                const parsed = parseSkillFrontmatter(res.body);
                name = parsed.name;
                description = parsed.description;
                skillContentCache.set(job.installName, res.body);
              }
            } catch (e) {
              log$1(`SKILL.md fetch failed for ${job.skillPath}`);
            }
          } else {
            const pluginUrl = `https://raw.githubusercontent.com/${source.repo}/main/${job.skillPath}/.claude-plugin/plugin.json`;
            try {
              const res = await netFetch(pluginUrl);
              if (res.ok) {
                const data = JSON.parse(res.body);
                name = data.name?.trim() || "";
                description = data.description || "";
                version = data.version?.trim() || "0.0.0";
                author = data.author?.trim() || author;
              }
            } catch (e) {
              log$1(`plugin.json fetch failed for ${job.skillPath}`);
            }
          }
          const dirName = job.skillPath.split("/").pop() || job.installName;
          if (!name) name = dirName;
          if (!description) description = job.entryDescription;
          const plugin = {
            id: `${source.repo}/${job.skillPath}`,
            name,
            description,
            version,
            author,
            marketplace: safeMarketplaceName,
            repo: source.repo,
            sourcePath: job.skillPath,
            installName: job.installName,
            category: source.category,
            tags: deriveSemanticTags(name, description, job.skillPath),
            isSkillMd: job.useSkillMd
          };
          return plugin;
        })
      );
      for (const r of jobResults) {
        if (r.status === "fulfilled") {
          allPlugins.push(r.value);
        } else {
          log$1(`Plugin fetch warning: ${r.reason}`);
        }
      }
    })
  );
  for (const r of results) {
    if (r.status === "rejected") {
      log$1(`Source fetch error: ${r.reason}`);
      errors.push(String(r.reason));
    }
  }
  if (allPlugins.length === 0 && errors.length > 0) {
    return { plugins: [], error: errors.join("; ") };
  }
  allPlugins.sort((a, b) => a.name.localeCompare(b.name));
  cachedPlugins = allPlugins;
  cacheTimestamp = Date.now();
  return { plugins: allPlugins, error: null };
}
async function listInstalled() {
  const claudeDir = path.join(os.homedir(), ".claude");
  const names = [];
  try {
    const raw = await promises.readFile(path.join(claudeDir, "plugins", "installed_plugins.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data.plugins) {
      for (const key of Object.keys(data.plugins)) {
        const pluginName = key.split("@")[0];
        if (pluginName) names.push(pluginName);
        names.push(key);
      }
    }
  } catch (e) {
    log$1(`listInstalled: no installed_plugins.json or parse error: ${e}`);
  }
  try {
    const entries = await promises.readdir(path.join(claudeDir, "skills"), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(entry.name);
      }
    }
  } catch (e) {
    log$1(`listInstalled: no skills dir or read error: ${e}`);
  }
  return [...new Set(names)];
}
async function installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd) {
  try {
    if (isSkillMd !== false) {
      const skillsDir = path.join(os.homedir(), ".claude", "skills", pluginName);
      let content = skillContentCache.get(pluginName);
      if (!content) {
        const path2 = sourcePath || `skills/${pluginName}`;
        const url = `https://raw.githubusercontent.com/${repo}/main/${path2}/SKILL.md`;
        log$1(`installPlugin: fetching ${url}`);
        const res = await netFetch(url);
        if (!res.ok) {
          return { ok: false, error: `Failed to fetch SKILL.md (${res.status})` };
        }
        content = res.body;
      }
      await promises.mkdir(skillsDir, { recursive: true });
      await promises.writeFile(path.join(skillsDir, "SKILL.md"), content, "utf-8");
      log$1(`installPlugin: wrote ${skillsDir}/SKILL.md`);
    } else {
      const addResult = await execAsync("claude", ["plugin", "marketplace", "add", repo], 15e3);
      if (addResult.exitCode !== 0 && !addResult.stdout.includes("already added") && !addResult.stderr.includes("already added")) {
        return { ok: false, error: addResult.stderr || "Failed to add marketplace" };
      }
      const installResult = await execAsync("claude", ["plugin", "install", `${pluginName}@${marketplace}`], 15e3);
      if (installResult.exitCode !== 0) {
        return { ok: false, error: installResult.stderr || "Failed to install plugin" };
      }
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log$1(`installPlugin error: ${msg}`);
    return { ok: false, error: msg };
  }
}
async function uninstallPlugin(pluginName) {
  try {
    const skillsDir = path.join(os.homedir(), ".claude", "skills", pluginName);
    await promises.rm(skillsDir, { recursive: true, force: true });
    log$1(`uninstallPlugin: removed ${skillsDir}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log$1(`uninstallPlugin error: ${msg}`);
    return { ok: false, error: msg };
  }
}
function netFetch(url) {
  return new Promise((resolve, reject) => {
    const request = electron.net.request(url);
    request.on("response", (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body
        });
      });
    });
    request.on("error", (err) => reject(err));
    request.end();
  });
}
function parseSkillFrontmatter(content) {
  let name = "";
  let description = "";
  const lines = content.split("\n");
  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch && !name) {
      name = nameMatch[1].replace(/^["']|["']$/g, "").trim();
    }
    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch && !description) {
      description = descMatch[1].replace(/^["']|["']$/g, "").trim();
      if (description.length > 200) {
        description = description.substring(0, 197) + "...";
      }
    }
    if (name && description) break;
    if (line.startsWith("# ")) break;
  }
  return { name, description };
}
const TAG_RULES = [
  { tag: "Design", patterns: /\b(figma|ui|ux|design|sketch|prototype|wireframe|layout|css|style|visual)\b/i },
  { tag: "Product", patterns: /\b(prd|roadmap|strategy|product|backlog|prioriti[sz]|feature\s*request|user\s*stor)\b/i },
  { tag: "Research", patterns: /\b(research|interview|insights?|survey|user\s*study|ethnograph|discover)\b/i },
  { tag: "Docs", patterns: /\b(doc(ument)?s?|writing|spec(ification)?|readme|markdown|technical\s*writ|content)\b/i },
  { tag: "Spreadsheet", patterns: /\b(sheet|spreadsheet|xlsx?|csv|tabular|pivot|formula)\b/i },
  { tag: "Slides", patterns: /\b(slides?|presentation|deck|pptx?|keynote|pitch)\b/i },
  { tag: "Analysis", patterns: /\b(analy[sz](is|e|ing)|insight|metric|dashboard|report(ing)?|data\s*viz|statistic)\b/i },
  { tag: "Finance", patterns: /\b(financ|accounting|budget|revenue|forecast|valuation|portfolio|investment)\b/i },
  { tag: "Compliance", patterns: /\b(risk|audit|policy|compliance|regulat|governance|sox|gdpr|hipaa)\b/i },
  { tag: "Management", patterns: /\b(manag|planning|meeting|ops|operations|team|workflow|project\s*plan)\b/i },
  { tag: "Automation", patterns: /\b(automat|workflow|pipeline|ci\s*cd|deploy|integrat|orchestrat|script)\b/i },
  { tag: "Code", patterns: /\b(code|coding|program|develop|engineer|debug|refactor|test(ing)?|linter?)\b/i },
  { tag: "Creative", patterns: /\b(creative|brainstorm|ideation|copywriting|storytelling|narrative)\b/i },
  { tag: "Sales", patterns: /\b(sales|crm|prospect|lead|deal|pipeline|outreach|cold\s*(call|email))\b/i },
  { tag: "Support", patterns: /\b(support|customer|helpdesk|ticket|troubleshoot|faq|knowledge\s*base)\b/i },
  { tag: "Security", patterns: /\b(secur|vulnerabilit|pentest|threat|encrypt|auth(enticat|ori[sz]))\b/i },
  { tag: "Data", patterns: /\b(data|database|sql|etl|warehouse|lake|ingest|transform|schema)\b/i },
  { tag: "AI/ML", patterns: /\b(ai|ml|machine\s*learn|model|train|inference|llm|prompt|embed)\b/i }
];
function deriveSemanticTags(name, description, skillPath) {
  const text = `${name} ${description} ${skillPath}`.toLowerCase();
  const matched = [];
  for (const rule of TAG_RULES) {
    if (rule.patterns.test(text)) {
      matched.push(rule.tag);
    }
    if (matched.length >= 2) break;
  }
  return matched;
}
function execAsync(cmd, args, timeout) {
  return new Promise((resolve) => {
    child_process.execFile(cmd, args, { timeout, env: getCliEnv() }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? 1 : 0,
        stdout: stdout || "",
        stderr: stderr || ""
      });
    });
  });
}
const IPC = {
  // Request-response (renderer → main)
  START: "clui:start",
  CREATE_TAB: "clui:create-tab",
  PROMPT: "clui:prompt",
  CANCEL: "clui:cancel",
  STOP_TAB: "clui:stop-tab",
  RETRY: "clui:retry",
  STATUS: "clui:status",
  TAB_HEALTH: "clui:tab-health",
  CLOSE_TAB: "clui:close-tab",
  SELECT_DIRECTORY: "clui:select-directory",
  OPEN_EXTERNAL: "clui:open-external",
  OPEN_IN_TERMINAL: "clui:open-in-terminal",
  ATTACH_FILES: "clui:attach-files",
  TAKE_SCREENSHOT: "clui:take-screenshot",
  TRANSCRIBE_AUDIO: "clui:transcribe-audio",
  PASTE_IMAGE: "clui:paste-image",
  GET_DIAGNOSTICS: "clui:get-diagnostics",
  RESPOND_PERMISSION: "clui:respond-permission",
  INIT_SESSION: "clui:init-session",
  RESET_TAB_SESSION: "clui:reset-tab-session",
  ANIMATE_HEIGHT: "clui:animate-height",
  LIST_SESSIONS: "clui:list-sessions",
  LOAD_SESSION: "clui:load-session",
  // Window management
  RESIZE_HEIGHT: "clui:resize-height",
  SET_WINDOW_WIDTH: "clui:set-window-width",
  HIDE_WINDOW: "clui:hide-window",
  WINDOW_SHOWN: "clui:window-shown",
  SET_IGNORE_MOUSE_EVENTS: "clui:set-ignore-mouse-events",
  IS_VISIBLE: "clui:is-visible",
  // Skill provisioning (main → renderer)
  SKILL_STATUS: "clui:skill-status",
  // Theme
  GET_THEME: "clui:get-theme",
  THEME_CHANGED: "clui:theme-changed",
  // Marketplace
  MARKETPLACE_FETCH: "clui:marketplace-fetch",
  MARKETPLACE_INSTALLED: "clui:marketplace-installed",
  MARKETPLACE_INSTALL: "clui:marketplace-install",
  MARKETPLACE_UNINSTALL: "clui:marketplace-uninstall",
  // Permission mode
  SET_PERMISSION_MODE: "clui:set-permission-mode",
  // Screen sharing
  SET_CONTENT_PROTECTION: "clui:set-content-protection"
};
const DEBUG_MODE = process.env.CLUI_DEBUG === "1";
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === "1";
function log(msg) {
  log$7("main", msg);
}
let mainWindow = null;
let tray = null;
let screenshotCounter = 0;
let toggleSequence = 0;
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === "1";
const controlPlane = new ControlPlane(INTERACTIVE_PTY);
const BAR_WIDTH = 1040;
const PILL_HEIGHT = 720;
const PILL_BOTTOM_MARGIN = 24;
function broadcast(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}
function snapshotWindowState(reason) {
  if (!SPACES_DEBUG) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`);
    return;
  }
  const b = mainWindow.getBounds();
  const cursor = electron.screen.getCursorScreenPoint();
  const display = electron.screen.getDisplayNearestPoint(cursor);
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces();
  const wcFocused = mainWindow.webContents.isFocused();
  log(
    `[spaces] ${reason} vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} bounds=(${b.x},${b.y},${b.width}x${b.height}) cursor=(${cursor.x},${cursor.y}) display=${display.id} workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  );
}
function scheduleToggleSnapshots(toggleId, phase) {
  if (!SPACES_DEBUG) return;
  const probes = [0, 100, 400, 1200];
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`);
    }, delay);
  }
}
controlPlane.on("event", (tabId, event) => {
  broadcast("clui:normalized-event", tabId, event);
});
controlPlane.on("tab-status-change", (tabId, newStatus, oldStatus) => {
  broadcast("clui:tab-status-change", tabId, newStatus, oldStatus);
});
controlPlane.on("error", (tabId, error) => {
  broadcast("clui:enriched-error", tabId, error);
});
function createWindow() {
  const cursor = electron.screen.getCursorScreenPoint();
  const display = electron.screen.getDisplayNearestPoint(cursor);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  const { x: dx, y: dy } = display.workArea;
  const x = dx + Math.round((screenWidth - BAR_WIDTH) / 2);
  const y = dy + screenHeight - PILL_HEIGHT - PILL_BOTTOM_MARGIN;
  mainWindow = new electron.BrowserWindow({
    width: BAR_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    ...process.platform === "darwin" ? { type: "panel" } : {},
    // NSPanel — non-activating, joins all spaces
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: "#00000000",
    show: false,
    icon: path.join(__dirname, "../../resources/icon.icns"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
      // Required for <webview> element in renderer
    }
  });
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setContentProtection(false);
  mainWindow.webContents.on("did-attach-webview", (_event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      webviewContents.loadURL(url);
      return { action: "deny" };
    });
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.setIgnoreMouseEvents(true, { forward: true });
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  let forceQuit = false;
  electron.app.on("before-quit", () => {
    forceQuit = true;
  });
  mainWindow.on("close", (e) => {
    if (!forceQuit) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function showWindow(source = "unknown") {
  if (!mainWindow) return;
  const toggleId = ++toggleSequence;
  const cursor = electron.screen.getCursorScreenPoint();
  const display = electron.screen.getDisplayNearestPoint(cursor);
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: dx, y: dy } = display.workArea;
  mainWindow.setBounds({
    x: dx + Math.round((sw - BAR_WIDTH) / 2),
    y: dy + sh - PILL_HEIGHT - PILL_BOTTOM_MARGIN,
    width: BAR_WIDTH,
    height: PILL_HEIGHT
  });
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source} move-to-display id=${display.id}`);
    snapshotWindowState(`showWindow#${toggleId} pre-show`);
  }
  mainWindow.show();
  mainWindow.webContents.focus();
  broadcast(IPC.WINDOW_SHOWN);
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, "show");
}
function toggleWindow(source = "unknown") {
  if (!mainWindow) return;
  const toggleId = ++toggleSequence;
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`);
    snapshotWindowState(`toggle#${toggleId} pre`);
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, "hide");
  } else {
    showWindow(source);
  }
}
electron.ipcMain.on(IPC.RESIZE_HEIGHT, () => {
});
electron.ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
});
electron.ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
});
electron.ipcMain.on(IPC.HIDE_WINDOW, () => {
  mainWindow?.hide();
});
electron.ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false;
});
electron.ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore, options) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {});
  }
});
electron.ipcMain.handle(IPC.START, async () => {
  log("IPC START — fetching static CLI info");
  const { execSync } = require("child_process");
  let version = "unknown";
  try {
    version = execSync("claude -v", { encoding: "utf-8", timeout: 5e3, env: getCliEnv() }).trim();
  } catch {
  }
  let auth = {};
  try {
    const raw = execSync("claude auth status", { encoding: "utf-8", timeout: 5e3, env: getCliEnv() }).trim();
    auth = JSON.parse(raw);
  } catch {
  }
  let mcpServers = [];
  try {
    const raw = execSync("claude mcp list", { encoding: "utf-8", timeout: 5e3, env: getCliEnv() }).trim();
    if (raw) mcpServers = raw.split("\n").filter(Boolean);
  } catch {
  }
  return { version, auth, mcpServers, projectPath: process.cwd(), homePath: require("os").homedir() };
});
electron.ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab();
  log(`IPC CREATE_TAB → ${tabId}`);
  return { tabId };
});
electron.ipcMain.on(IPC.INIT_SESSION, (_event, tabId) => {
  log(`IPC INIT_SESSION: ${tabId}`);
  controlPlane.initSession(tabId);
});
electron.ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`);
  controlPlane.resetTabSession(tabId);
});
electron.ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`);
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`);
  }
  if (!tabId) {
    throw new Error("No tabId provided — prompt rejected");
  }
  if (!requestId) {
    throw new Error("No requestId provided — prompt rejected");
  }
  try {
    await controlPlane.submitPrompt(tabId, requestId, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`PROMPT error: ${msg}`);
    throw err;
  }
});
electron.ipcMain.handle(IPC.CANCEL, (_event, requestId) => {
  log(`IPC CANCEL: ${requestId}`);
  return controlPlane.cancel(requestId);
});
electron.ipcMain.handle(IPC.STOP_TAB, (_event, tabId) => {
  log(`IPC STOP_TAB: ${tabId}`);
  return controlPlane.cancelTab(tabId);
});
electron.ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`);
  return controlPlane.retry(tabId, requestId, options);
});
electron.ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth();
});
electron.ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth();
});
electron.ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId) => {
  log(`IPC CLOSE_TAB: ${tabId}`);
  controlPlane.closeTab(tabId);
});
electron.ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode) => {
  if (mode !== "ask" && mode !== "auto") {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`);
    return;
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`);
  controlPlane.setPermissionMode(mode);
});
electron.ipcMain.on(IPC.SET_CONTENT_PROTECTION, (_event, protect) => {
  mainWindow?.setContentProtection(protect);
});
electron.ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`);
  return controlPlane.respondToPermission(tabId, questionId, optionId);
});
electron.ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : ""}`);
  try {
    const cwd = projectPath || process.cwd();
    const encodedPath = cwd.replace(/\//g, "-");
    const sessionsDir = path.join(os.homedir(), ".claude", "projects", encodedPath);
    if (!fs.existsSync(sessionsDir)) {
      log(`LIST_SESSIONS: directory not found: ${sessionsDir}`);
      return [];
    }
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const sessions = [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const file of files) {
      const fileSessionId = file.replace(/\.jsonl$/, "");
      if (!UUID_RE.test(fileSessionId)) continue;
      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.size < 100) continue;
      const meta = {
        validated: false,
        slug: null,
        firstMessage: null,
        lastTimestamp: null
      };
      await new Promise((resolve) => {
        const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
        rl.on("line", (line) => {
          try {
            const obj = JSON.parse(line);
            if (!meta.validated && obj.type && obj.uuid && obj.timestamp) {
              meta.validated = true;
            }
            if (obj.slug && !meta.slug) meta.slug = obj.slug;
            if (obj.timestamp) meta.lastTimestamp = obj.timestamp;
            if (obj.type === "user" && !meta.firstMessage) {
              const content = obj.message?.content;
              if (typeof content === "string") {
                meta.firstMessage = content.substring(0, 100);
              } else if (Array.isArray(content)) {
                const textPart = content.find((p) => p.type === "text");
                meta.firstMessage = textPart?.text?.substring(0, 100) || null;
              }
            }
          } catch {
          }
        });
        rl.on("close", () => resolve());
      });
      if (meta.validated) {
        sessions.push({
          sessionId: fileSessionId,
          slug: meta.slug,
          firstMessage: meta.firstMessage,
          lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
          size: stat.size
        });
      }
    }
    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    return sessions.slice(0, 20);
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`);
    return [];
  }
});
electron.ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg) => {
  const sessionId = typeof arg === "string" ? arg : arg.sessionId;
  const projectPath = typeof arg === "string" ? void 0 : arg.projectPath;
  log(`IPC LOAD_SESSION ${sessionId}${projectPath ? ` (path=${projectPath})` : ""}`);
  try {
    const cwd = projectPath || process.cwd();
    const encodedPath = cwd.replace(/\//g, "-");
    const filePath = path.join(os.homedir(), ".claude", "projects", encodedPath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];
    const messages = [];
    await new Promise((resolve) => {
      const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
      rl.on("line", (line) => {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "user") {
            const content = obj.message?.content;
            let text = "";
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
            }
            if (text) {
              messages.push({ role: "user", content: text, timestamp: new Date(obj.timestamp).getTime() });
            }
          } else if (obj.type === "assistant") {
            const content = obj.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  messages.push({ role: "assistant", content: block.text, timestamp: new Date(obj.timestamp).getTime() });
                } else if (block.type === "tool_use" && block.name) {
                  messages.push({
                    role: "tool",
                    content: "",
                    toolName: block.name,
                    timestamp: new Date(obj.timestamp).getTime()
                  });
                }
              }
            }
          }
        } catch {
        }
      });
      rl.on("close", () => resolve());
    });
    return messages;
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`);
    return [];
  }
});
electron.ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null;
  if (process.platform === "darwin") electron.app.focus();
  const options = { properties: ["openDirectory"] };
  const result = process.platform === "darwin" ? await electron.dialog.showOpenDialog(options) : await electron.dialog.showOpenDialog(mainWindow, options);
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url) => {
  try {
    if (!/^https?:\/\//i.test(url)) return false;
    await electron.shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});
electron.ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null;
  if (process.platform === "darwin") electron.app.focus();
  const options = {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "All Files", extensions: ["*"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
      { name: "Code", extensions: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "md", "json", "yaml", "toml"] }
    ]
  };
  const result = process.platform === "darwin" ? await electron.dialog.showOpenDialog(options) : await electron.dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) return null;
  const { basename, extname } = require("path");
  const { readFileSync, statSync: statSync2 } = require("fs");
  const IMAGE_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
  const mimeMap = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".yaml": "text/yaml",
    ".toml": "text/toml"
  };
  return result.filePaths.map((fp) => {
    const ext = extname(fp).toLowerCase();
    const mime = mimeMap[ext] || "application/octet-stream";
    const stat = statSync2(fp);
    let dataUrl;
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp);
        dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
      }
    }
    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? "image" : "file",
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size
    };
  });
});
electron.ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null;
  if (SPACES_DEBUG) snapshotWindowState("screenshot pre-hide");
  mainWindow.hide();
  await new Promise((r) => setTimeout(r, 300));
  try {
    const { execSync } = require("child_process");
    const { join: join2 } = require("path");
    const { tmpdir } = require("os");
    const { readFileSync, existsSync: existsSync2 } = require("fs");
    const timestamp = Date.now();
    const screenshotPath = join2(tmpdir(), `clui-screenshot-${timestamp}.png`);
    execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
      timeout: 3e4,
      stdio: "ignore"
    });
    if (!existsSync2(screenshotPath)) {
      return null;
    }
    const buf = readFileSync(screenshotPath);
    return {
      id: crypto.randomUUID(),
      type: "image",
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
      size: buf.length
    };
  } catch {
    return null;
  } finally {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.focus();
    }
    broadcast(IPC.WINDOW_SHOWN);
    if (SPACES_DEBUG) {
      log("[spaces] screenshot restore show+focus");
      snapshotWindowState("screenshot restore immediate");
      setTimeout(() => snapshotWindowState("screenshot restore +200ms"), 200);
    }
  }
});
let pasteCounter = 0;
electron.ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl) => {
  try {
    const { writeFileSync } = require("fs");
    const { join: join2 } = require("path");
    const { tmpdir } = require("os");
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/);
    if (!match) return null;
    const [, mimeType, ext, base64Data] = match;
    const buf = Buffer.from(base64Data, "base64");
    const timestamp = Date.now();
    const filePath = join2(tmpdir(), `clui-paste-${timestamp}.${ext}`);
    writeFileSync(filePath, buf);
    return {
      id: crypto.randomUUID(),
      type: "image",
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length
    };
  } catch {
    return null;
  }
});
electron.ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64) => {
  const { writeFileSync, existsSync: existsSync2, unlinkSync, readFileSync } = require("fs");
  const { execSync } = require("child_process");
  const { join: join2 } = require("path");
  const { tmpdir } = require("os");
  const tmpWav = join2(tmpdir(), `clui-voice-${Date.now()}.wav`);
  try {
    const buf = Buffer.from(audioBase64, "base64");
    writeFileSync(tmpWav, buf);
    const candidates = [
      "/opt/homebrew/bin/whisper-cli",
      "/usr/local/bin/whisper-cli",
      "/opt/homebrew/bin/whisper",
      "/usr/local/bin/whisper",
      join2(os.homedir(), ".local/bin/whisper")
    ];
    let whisperBin = "";
    for (const c of candidates) {
      if (existsSync2(c)) {
        whisperBin = c;
        break;
      }
    }
    if (!whisperBin) {
      try {
        whisperBin = execSync('/bin/zsh -lc "whence -p whisper-cli"', { encoding: "utf-8" }).trim();
      } catch {
      }
    }
    if (!whisperBin) {
      try {
        whisperBin = execSync('/bin/zsh -lc "whence -p whisper"', { encoding: "utf-8" }).trim();
      } catch {
      }
    }
    if (!whisperBin) {
      return {
        error: "Whisper not found. Install with: brew install whisper-cli",
        transcript: null
      };
    }
    const isWhisperCpp = whisperBin.includes("whisper-cli");
    const modelCandidates = [
      join2(os.homedir(), ".local/share/whisper/ggml-base.bin"),
      join2(os.homedir(), ".local/share/whisper/ggml-tiny.bin"),
      "/opt/homebrew/share/whisper-cpp/models/ggml-base.bin",
      "/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin",
      // Fall back to English-only models if multilingual not available
      join2(os.homedir(), ".local/share/whisper/ggml-base.en.bin"),
      join2(os.homedir(), ".local/share/whisper/ggml-tiny.en.bin"),
      "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin",
      "/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin"
    ];
    let modelPath = "";
    for (const m of modelCandidates) {
      if (existsSync2(m)) {
        modelPath = m;
        break;
      }
    }
    const isEnglishOnly = modelPath.includes(".en.");
    log(`Transcribing with: ${whisperBin} (model: ${modelPath || "default"}, lang: ${isEnglishOnly ? "en" : "auto"})`);
    let output;
    if (isWhisperCpp) {
      if (!modelPath) {
        return {
          error: "Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
          transcript: null
        };
      }
      const langFlag = isEnglishOnly ? "-l en" : "-l auto";
      output = execSync(
        `"${whisperBin}" -m "${modelPath}" -f "${tmpWav}" --no-timestamps ${langFlag}`,
        { encoding: "utf-8", timeout: 3e4 }
      );
    } else {
      const langFlag = isEnglishOnly ? "--language en" : "";
      output = execSync(
        `"${whisperBin}" "${tmpWav}" --model tiny ${langFlag} --output_format txt --output_dir "${tmpdir()}"`,
        { encoding: "utf-8", timeout: 3e4 }
      );
      const txtPath = tmpWav.replace(".wav", ".txt");
      if (existsSync2(txtPath)) {
        const transcript2 = readFileSync(txtPath, "utf-8").trim();
        try {
          unlinkSync(txtPath);
        } catch {
        }
        return { error: null, transcript: transcript2 };
      }
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null
      };
    }
    const HALLUCINATIONS = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i;
    const transcript = output.replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, "").trim();
    if (HALLUCINATIONS.test(transcript)) {
      return { error: null, transcript: "" };
    }
    return { error: null, transcript: transcript || "" };
  } catch (err) {
    log(`Transcription error: ${err.message}`);
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null
    };
  } finally {
    try {
      unlinkSync(tmpWav);
    } catch {
    }
  }
});
electron.ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync: existsSync2 } = require("fs");
  const health = controlPlane.getHealth();
  let recentLogs = "";
  if (existsSync2(LOG_FILE$1)) {
    try {
      const content = readFileSync(LOG_FILE$1, "utf-8");
      const lines = content.split("\n");
      recentLogs = lines.slice(-100).join("\n");
    } catch {
    }
  }
  return {
    health,
    logPath: LOG_FILE$1,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: electron.app.getVersion(),
    transport: INTERACTIVE_PTY ? "pty" : "stream-json"
  };
});
electron.ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg) => {
  const { execFile } = require("child_process");
  const claudeBin = "claude";
  let sessionId = null;
  let projectPath = process.cwd();
  if (typeof arg === "string") {
    sessionId = arg;
  } else if (arg && typeof arg === "object") {
    sessionId = arg.sessionId ?? null;
    projectPath = arg.projectPath && arg.projectPath !== "~" ? arg.projectPath : process.cwd();
  }
  const projectDir = projectPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let cmd;
  if (sessionId) {
    cmd = `cd \\"${projectDir}\\" && ${claudeBin} --resume ${sessionId}`;
  } else {
    cmd = `cd \\"${projectDir}\\" && ${claudeBin}`;
  }
  const script = `tell application "Terminal"
  activate
  do script "${cmd}"
end tell`;
  try {
    execFile("/usr/bin/osascript", ["-e", script], (err) => {
      if (err) log(`Failed to open terminal: ${err.message}`);
      else log(`Opened terminal with: ${cmd}`);
    });
    return true;
  } catch (err) {
    log(`Failed to open terminal: ${err}`);
    return false;
  }
});
electron.ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log("IPC MARKETPLACE_FETCH");
  return fetchCatalog(forceRefresh);
});
electron.ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log("IPC MARKETPLACE_INSTALLED");
  return listInstalled();
});
electron.ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`);
  return installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd);
});
electron.ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`);
  return uninstallPlugin(pluginName);
});
electron.ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: electron.nativeTheme.shouldUseDarkColors };
});
electron.nativeTheme.on("updated", () => {
  broadcast(IPC.THEME_CHANGED, electron.nativeTheme.shouldUseDarkColors);
});
async function requestPermissions() {
  if (process.platform !== "darwin") return;
  try {
    const micStatus = electron.systemPreferences.getMediaAccessStatus("microphone");
    if (micStatus === "not-determined") {
      await electron.systemPreferences.askForMediaAccess("microphone");
    }
  } catch (err) {
    log(`Permission preflight: microphone check failed — ${err.message}`);
  }
}
electron.app.whenReady().then(async () => {
  if (process.platform === "darwin" && electron.app.dock) {
    electron.app.dock.hide();
  }
  await requestPermissions();
  ensureSkills((status) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ""}`);
    broadcast(IPC.SKILL_STATUS, status);
  }).catch((err) => log(`Skill provisioning error: ${err.message}`));
  createWindow();
  snapshotWindowState("after createWindow");
  if (SPACES_DEBUG) {
    mainWindow?.on("show", () => snapshotWindowState("event window show"));
    mainWindow?.on("hide", () => snapshotWindowState("event window hide"));
    mainWindow?.on("focus", () => snapshotWindowState("event window focus"));
    mainWindow?.on("blur", () => snapshotWindowState("event window blur"));
    mainWindow?.webContents.on("focus", () => snapshotWindowState("event webContents focus"));
    mainWindow?.webContents.on("blur", () => snapshotWindowState("event webContents blur"));
    electron.app.on("browser-window-focus", () => snapshotWindowState("event app browser-window-focus"));
    electron.app.on("browser-window-blur", () => snapshotWindowState("event app browser-window-blur"));
    electron.screen.on("display-added", (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`);
      snapshotWindowState("event display-added");
    });
    electron.screen.on("display-removed", (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`);
      snapshotWindowState("event display-removed");
    });
    electron.screen.on("display-metrics-changed", (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(",")}`);
      snapshotWindowState("event display-metrics-changed");
    });
  }
  const registered = electron.globalShortcut.register("Alt+Space", () => toggleWindow("shortcut Alt+Space"));
  if (!registered) {
    log("Alt+Space shortcut registration failed — macOS input sources may claim it");
  }
  electron.globalShortcut.register("CommandOrControl+Shift+K", () => toggleWindow("shortcut Cmd/Ctrl+Shift+K"));
  const trayIconPath = path.join(__dirname, "../../resources/trayTemplate.png");
  const trayIcon = electron.nativeImage.createFromPath(trayIconPath);
  trayIcon.setTemplateImage(true);
  tray = new electron.Tray(trayIcon);
  tray.setToolTip("Clui CC — Claude Code UI");
  tray.on("click", () => toggleWindow("tray click"));
  tray.setContextMenu(
    electron.Menu.buildFromTemplate([
      { label: "Show Clui CC", click: () => showWindow("tray menu") },
      { label: "Quit", click: () => {
        electron.app.quit();
      } }
    ])
  );
  electron.app.on("activate", () => showWindow("app activate"));
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
  controlPlane.shutdown();
  flushLogs();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
