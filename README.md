<p align="center">
  <img src="resources/banner.png" alt="Cloak — Invisible overlay for Claude Code" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/pokharnajay/cloak/releases/latest"><img src="https://img.shields.io/github/v/release/pokharnajay/cloak?style=flat-square&color=2CB1BC&label=Download&v=2" alt="Download"/></a>
  <a href="https://github.com/pokharnajay/cloak/releases/latest"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1A2733?style=flat-square" alt="Platform"/></a>
  <img src="https://img.shields.io/github/license/pokharnajay/cloak?style=flat-square&color=2CB1BC" alt="License"/>
</p>

An invisible, floating desktop overlay for **Claude Code** and **OpenAI Codex**. Always-on-top, stealth-mode interface with multi-tab sessions, keyboard-driven permissions, screenshots, and dual AI provider support.

## Install

### macOS

**Option 1 — Homebrew** (recommended):

```bash
brew install pokharnajay/cloak
```

**Option 2 — One-line script:**

```bash
curl -sL https://raw.githubusercontent.com/pokharnajay/cloak/main/install.sh | bash
```

**Option 3 — DMG:**

1. Download [Cloak-0.2.0-arm64.dmg](https://github.com/pokharnajay/cloak/releases/latest)
2. Open the DMG, drag **Cloak** to Applications
3. If macOS blocks it, open Terminal and run: `xattr -cr /Applications/Cloak.app`
4. Grant Accessibility & Screen Recording permissions when prompted

### Windows

Download and run the installer — adds to Start menu, Desktop, and Programs:

| Download | Architecture |
|----------|-------------|
| [Cloak-Setup-0.2.0-x64.exe](https://github.com/pokharnajay/cloak/releases/latest) | Windows x64 |

## Features

- **Dual AI providers** — Claude Code and OpenAI Codex with isolated conversations
- **Multi-tab sessions** — each tab runs its own Claude/Codex session with live streaming
- **Keyboard permission handling** — Enter to approve, Esc to deny, number keys for options
- **Screenshot + Ask** — single hotkey captures your screen and sends to AI (Option+Shift+S)
- **Stealth mode** — completely invisible in screen shares (no tray icon, no dialogs, no notifications)
- **File attachments** — drag & drop, file picker, clipboard paste
- **Session history** — browse and resume past Claude conversations
- **Model switching** — Opus 4.6, Sonnet 4.6, Haiku 4.5 (Claude); config.toml models (Codex)
- **Permission modes** — Ask, Auto, or Plan
- **Dark / Light theme** — smooth animated transitions
- **Always on top** — floats on all workspaces and fullscreen apps

## Keyboard Shortcuts

| Action | macOS | Windows |
|--------|-------|---------|
| Toggle overlay | Option + Space | Ctrl + Space |
| Screenshot + Ask | Option + Shift + S | Ctrl + Shift + S |
| Approve permission | Enter | Enter |
| Deny permission | Esc | Esc |

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
| AI Provider | Claude | Switch between Claude Code and Codex |
| Stealth mode | On | Invisible in screen shares |
| Dark theme | On | Toggle dark/light mode |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Move to Trash" on first open | Use the one-line installer, or run: `xattr -cr /Applications/Cloak.app && codesign --force --deep --sign - /Applications/Cloak.app` |
| App won't open (macOS) | System Settings > Privacy & Security > Open Anyway |
| `npm install` fails | `xcode-select --install` and `pip install setuptools` |
| `claude` not found | `npm i -g @anthropic-ai/claude-code` |
| `codex` not found | `npm i -g @openai/codex` |
| Screenshots black/empty | Grant Screen Recording permission |
| Shortcut not registering | May conflict with OS shortcut — close other apps |

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
