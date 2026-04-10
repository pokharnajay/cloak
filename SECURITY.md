# Cloak — Security Checklist

Comprehensive audit of the Electron overlay app's security posture, code protection, and user-trust surface.

---

## 1. Electron Process Isolation

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1 | `contextIsolation: true` | Done | Renderer JS cannot access Node APIs directly |
| 1.2 | `nodeIntegration: false` | Done | No raw `require()` in renderer |
| 1.3 | `sandbox: false` | Acceptable | Required for preload to use `ipcRenderer`; contextIsolation still enforces the boundary |
| 1.4 | `webviewTag: false` | Done | Set to `false` — `<webview>` tags are not used and allowing them would widen the attack surface |
| 1.5 | Preload only exposes typed API | Done | `contextBridge.exposeInMainWorld('clui', api)` — no raw IPC leakage |
| 1.6 | IPC surface minimized | Done | All channels defined in `shared/types.ts` IPC enum; no wildcard handlers |

---

## 2. Input Validation & Injection

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | `shell.openExternal` validates scheme | Done | Only `http://` and `https://` allowed; blocks `file://`, `javascript:`, etc. |
| 2.2 | No SQL / eval injection vectors | Done | App has no database; no `eval()` in non-bundled code |
| 2.3 | Subprocess commands never interpolate user input raw | Done | `execFile` with args array used throughout platform.ts — no shell injection |
| 2.4 | File paths sanitized before use | Done | `join(homedir(), ...)` pattern; no user-supplied path concatenation without validation |
| 2.5 | No hardcoded secrets / API keys in source | Done | Grep confirmed zero hardcoded tokens |
| 2.6 | Auth tokens stored in OS credential store | Partial | Claude uses `~/.claude/.credentials.json` (file-based, not Keychain); Codex uses `~/.codex/auth.json`. Fine for a CLI tool. |

---

## 3. Content Security Policy (CSP)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1 | CSP meta tag in `index.html` | Done | Added: blocks remote scripts, allows only `'self'` + `'unsafe-inline'` (required by Tailwind/Vite) |
| 3.2 | `unsafe-eval` in CSP | Present | Required by Vite dev mode and some React internals; acceptable in packaged app where DevTools are blocked |
| 3.3 | `object-src 'none'` | Done | Blocks Flash and embedded objects |
| 3.4 | `base-uri 'none'` | Done | Prevents base tag hijacking |
| 3.5 | Remote images/fonts blocked | Done | `img-src 'self' data: blob:`, `font-src 'self' data:` |

---

## 4. DevTools & Debugging Access

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | DevTools blocked in production | Done | `devtools-opened` auto-closes in packaged mode |
| 4.2 | F12 / Cmd+Alt+I keyboard shortcuts blocked | Done | `before-input-event` intercepts these in production |
| 4.3 | `app.isPackaged` gate on all DevTools code | Done | Check in place before any DevTools call |
| 4.4 | Source maps disabled in production | Done | `sourcemap: false` in all vite build targets |

---

## 5. Code Protection (Shipped Binary)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | Main process minified + mangled | Done | Terser with `mangle: true`, removes all readable names |
| 5.2 | Preload minified + mangled | Done | Same terser settings as main |
| 5.3 | Renderer minified + mangled | Done | Terser with `toplevel: true` |
| 5.4 | ASAR packing | Done (default) | electron-builder packs all JS into app.asar |
| 5.5 | ASAR encryption | Not done | Requires paid Electron Forge fuse or custom native module; standard ASAR is extractable with `asar extract`. Consider after Apple cert. |
| 5.6 | Bytenode V8 bytecode (main) | Optional | Script at `scripts/compile-bytecode.js` exists; run as post-build step for maximum protection. Skipped in default dist build due to arch-specific bytecode complexity. |
| 5.7 | License: UNLICENSED (proprietary) | Done | MIT replaced with proprietary copyright notice |

---

## 6. Stealth / Screen Recording

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | `setContentProtection(true)` by default | Done | Hides from macOS screen recorder and most capture tools |
| 6.2 | Content protection applied before first `show()` | Done | Set immediately after `new BrowserWindow()` |
| 6.3 | No tray icon / dock icon | Done | Fully invisible from taskbar and dock |
| 6.4 | `skipTaskbar: true` | Done | Absent from Windows taskbar |
| 6.5 | `setVisibleOnAllWorkspaces` re-asserted after `show()` | Done | Prevents Spaces/fullscreen sliding bug on macOS |
| 6.6 | `alwaysOnTop: true` | Done | Overlay always above other windows |
| 6.7 | `type: 'panel'` (macOS NSPanel) | Done | Non-activating — won't steal focus |
| 6.8 | SetupOverlay inherits content protection | Done | Same BrowserWindow, protection applies to all content |
| 6.9 | Screen recording TCC pre-registered on launch | Done | `desktopCapturer.getSources()` triggered in `ready-to-show` |

---

## 7. macOS Entitlements

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | `cs.allow-jit` | Required | Needed for V8/Electron JIT compilation |
| 7.2 | `cs.allow-unsigned-executable-memory` | Required | Same — Electron JIT requirement |
| 7.3 | `cs.disable-library-validation` | Broad | Allows loading unsigned dylibs. Needed for ad-hoc signed builds. Remove or narrow once you have an Apple Developer cert with proper code signing. |
| 7.4 | `device.audio-input` | Required | For Whisper voice input |
| 7.5 | No `files.all` / `network.client` entitlements | Good | App doesn't request broad filesystem or network entitlements |
| 7.6 | Hardened runtime | TODO | Enable `hardened-runtime: true` in electron-builder config once you have an Apple Developer cert. Required for notarization. |

---

## 8. Auto-Update Security

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 8.1 | Auto-updater (electron-updater) | Not implemented | Users get no update notifications; updates are manual (download new installer). |
| 8.2 | Update signature verification | N/A | No updater = no signature risk, but also no security patches delivered automatically. |
| 8.3 | Action: Add `electron-updater` | Recommended | Checks GitHub Releases; verifies signature before applying. Needs code signing cert. Implement when you have an Apple Developer cert. |

---

## 9. Network & IPC

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 9.1 | App makes no outbound network calls itself | Done | All AI calls go through Claude/Codex CLIs as subprocess; app doesn't call APIs directly |
| 9.2 | `openExternal` scheme allowlist | Done | Only `http/https` |
| 9.3 | No remote module usage | Done | `enableRemoteModule` is not set (defaults to `false` in Electron 14+) |
| 9.4 | WebSocket (Vite HMR) only in dev | Done | CSP `connect-src` allows `ws://localhost:*` — harmless in dev, irrelevant in prod |

---

## 10. User Friction — Installation & Auth

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 10.1 | Claude Code CLI auto-install button | Done | `installClaude()` via npm, shown in SetupOverlay |
| 10.2 | Codex CLI auto-install button | Done | `installCodex()` via npm, shown in SetupOverlay |
| 10.3 | Auto-poll for auth completion | Done | SetupOverlay polls `checkProviders()` every 4 seconds |
| 10.4 | Auto-close overlay when authenticated | Done | Closes immediately when one or more provider auth detected |
| 10.5 | "Open Terminal" button pre-runs auth command | Done | `openAuthTerminal('claude')` / `openAuthTerminal('codex')` |
| 10.6 | No "Restart Cloak" required after auth | Done | Auth poll detects credentials without restart |
| 10.7 | Node.js not present — fallback instructions | TODO | If npm is not found, auto-install fails silently. Show a helpful message: "npm not found — install Node.js from nodejs.org" |
| 10.8 | Homebrew install path (macOS) | Future | Could detect Homebrew and offer `brew install` as alternative |
| 10.9 | Windows `winget` install path | Future | Winget support for Claude/Codex not yet published; npm is correct for now |

---

## 11. Privacy

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 11.1 | Screenshot data stays local | Done | Screenshots passed to CLI subprocess via stdin/file; never sent to Cloak servers |
| 11.2 | Audio transcription local | Done | Whisper runs locally; no audio sent to cloud |
| 11.3 | Session data stored in `~/.claude/` | Done | Same location as CLI — consistent with user expectations |
| 11.4 | No telemetry / analytics | Done | No PostHog, Mixpanel, or similar SDK in the app |
| 11.5 | Log file location disclosed | Done | `~/.claude/clui-cc.log` (discoverable via diagnostics) |

---

## Priority Action Items

| Priority | Action |
|----------|--------|
| ~~High~~ Done | ~~Set `webviewTag: false` in BrowserWindow options~~ — fixed |
| Medium | Add Node.js/npm detection in SetupOverlay — show `nodejs.org` link if npm not found |
| Medium | Add `electron-updater` for automatic update delivery once Apple cert acquired |
| Low | Remove `cs.disable-library-validation` entitlement and enable hardened runtime after getting Apple Developer cert |
| Low | Enable bytenode bytecode compilation in the default dist build |
| Nice-to-have | Investigate ASAR encryption via Electron Forge paid plan or custom native loader |
