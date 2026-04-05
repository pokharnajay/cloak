<p align="center">
  <img src="resources/banner.png" alt="Cloak — Invisible overlay for Claude Code" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/pokharnajay/cloak/releases/latest"><img src="https://img.shields.io/github/v/release/pokharnajay/cloak?style=flat-square&color=2CB1BC&label=Download&v=2" alt="Download"/></a>
  <a href="https://github.com/pokharnajay/cloak/releases/latest"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1A2733?style=flat-square" alt="Platform"/></a>
  <img src="https://img.shields.io/github/license/pokharnajay/cloak?style=flat-square&color=2CB1BC" alt="License"/>
</p>

An invisible, floating desktop overlay for **Claude Code** on macOS and Windows. Always-on-top, stealth-mode interface with multi-tab sessions, keyboard-driven permissions, screenshots, configurable shortcuts, and a skills marketplace.

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Cloak.dmg](https://github.com/pokharnajay/cloak/releases/latest) |
| Windows | Coming soon |

> macOS: Open the DMG, drag **Cloak** to Applications. First launch: **System Settings > Privacy & Security > Open Anyway**.

## Features

- **Multi-tab Claude sessions** — each tab runs `claude -p` with live streaming, tool calls, and permission approval
- **Keyboard permission handling** — Enter to approve, Esc to deny, number keys for options
- **Screenshot + Ask** — single hotkey captures your screen and asks Claude (Option+Shift+S / Ctrl+Shift+S)
- **Configurable keyboard shortcuts** — edit all hotkeys from Settings
- **Voice input** — local speech-to-text via Whisper (macOS)
- **File attachments** — drag & drop, file picker, clipboard paste
- **Session history** — browse and resume past conversations
- **Model switching** — Opus 4.6, Sonnet 4.6, Haiku 4.5
- **Permission modes** — Ask (manual) or Auto (approve all)
- **Skills marketplace** — install community skills and plugins
- **Stealth mode** — completely invisible in screen shares, notifications suppressed
- **Dark / Light theme** — smooth animated transitions
- **Always on top** — floats on all workspaces and fullscreen apps
- **Cross-platform** — macOS and Windows

## Keyboard Shortcuts

| Action | macOS | Windows |
|--------|-------|---------|
| Toggle overlay | Option + Space | Ctrl + Space |
| Toggle (secondary) | Cmd + Shift + K | Ctrl + Shift + K |
| Screenshot + Ask | Option + Shift + S | Ctrl + Shift + S |
| Approve permission | Enter | Enter |
| Deny permission | Esc | Esc |

All shortcuts are configurable from **Settings > Keyboard shortcuts**.

## Setup from Source

### Prerequisites

- **Node.js 20+** (LTS)
- **Python 3.12+** with `setuptools`
- **Claude Code CLI** authenticated (`npm i -g @anthropic-ai/claude-code && claude`)

### macOS

```bash
xcode-select --install
git clone https://github.com/pokharnajay/cloak.git
cd cloak
npm install
npm run dist
```

Copy to Applications:

```bash
rm -rf "/Applications/Cloak.app"
ditto "release/mac-arm64/Cloak.app" "/Applications/Cloak.app"
codesign --force --deep --sign - "/Applications/Cloak.app"
```

Or double-click `install-app.command`.

### Windows

```powershell
git clone https://github.com/pokharnajay/cloak.git
cd cloak
npm install
npm run dist:win
```

### Voice Input (macOS only)

```bash
brew install whisper-cli
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Full width | Off | Expand overlay to full width |
| Visible in screen sharing | Off | Show/hide from screen capture |
| Notification sound | Off | Sound when task completes while hidden |
| Dark theme | On | Toggle dark/light mode |
| Keyboard shortcuts | — | Edit all global hotkeys |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App won't open (macOS) | System Settings > Privacy & Security > Open Anyway |
| `npm install` fails | `xcode-select --install` and `pip install setuptools` |
| `claude` not found | `npm i -g @anthropic-ai/claude-code` |
| Screenshots black/empty | Grant Screen Recording permission |
| Shortcut not registering | May be reserved by OS — try a different combo |

```bash
npm run doctor
```

## Tech Stack

| Component | Version |
|-----------|---------|
| Electron | 35.x |
| React | 19.x |
| Framer Motion | 12.x |
| Zustand | 5.x |

## License

[MIT](LICENSE)
