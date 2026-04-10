import React, { useState, useEffect, useRef } from 'react'
import { X, CheckCircle, XCircle, ArrowClockwise, Terminal, DownloadSimple } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

// Auto-poll interval (ms) — checks if auth completed in the background
const POLL_INTERVAL = 4000

export function SetupOverlay() {
  const showSetupOverlay = useSessionStore((s) => s.showSetupOverlay)
  const providerAuth = useSessionStore((s) => s.providerAuth)
  const setShowSetupOverlay = useSessionStore((s) => s.setShowSetupOverlay)
  const checkAndSetProviderAuth = useSessionStore((s) => s.checkAndSetProviderAuth)
  const platform = useSessionStore((s) => s.staticInfo?.platform) || 'darwin'
  const colors = useColors()

  const [checking, setChecking] = useState(false)
  const [claudeInstalling, setClaudeInstalling] = useState(false)
  const [codexInstalling, setCodexInstalling] = useState(false)
  const [installError, setInstallError] = useState<{ claude?: string; codex?: string }>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMac = platform === 'darwin'
  const claudeAuth = providerAuth?.claude ?? false
  const codexAuth = providerAuth?.codex ?? false
  const eitherAuthed = claudeAuth || codexAuth

  // Auto-close when both providers are checked and at least one is authed
  useEffect(() => {
    if (showSetupOverlay && eitherAuthed) {
      setShowSetupOverlay(false)
    }
  }, [eitherAuthed, showSetupOverlay, setShowSetupOverlay])

  // Auto-poll while overlay is open
  useEffect(() => {
    if (!showSetupOverlay) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      await checkAndSetProviderAuth()
    }, POLL_INTERVAL)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [showSetupOverlay, checkAndSetProviderAuth])

  if (!showSetupOverlay) return null

  const handleCheckAgain = async () => {
    setChecking(true)
    await checkAndSetProviderAuth()
    setChecking(false)
  }

  const handleInstallClaude = async () => {
    setClaudeInstalling(true)
    setInstallError((e) => ({ ...e, claude: undefined }))
    const result = await window.clui.installClaude()
    setClaudeInstalling(false)
    if (!result.ok) {
      setInstallError((e) => ({ ...e, claude: result.error || 'Install failed' }))
    } else {
      await checkAndSetProviderAuth()
    }
  }

  const handleInstallCodex = async () => {
    setCodexInstalling(true)
    setInstallError((e) => ({ ...e, codex: undefined }))
    const result = await window.clui.installCodex()
    setCodexInstalling(false)
    if (!result.ok) {
      setInstallError((e) => ({ ...e, codex: result.error || 'Install failed' }))
    } else {
      await checkAndSetProviderAuth()
    }
  }

  const handleOpenTerminalClaude = async () => {
    await window.clui.openAuthTerminal('claude')
  }

  const handleOpenTerminalCodex = async () => {
    await window.clui.openAuthTerminal('codex')
  }

  return (
    <div
      data-clui-ui
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: 440,
          background: colors.containerBg,
          border: `1px solid ${colors.containerBorder}`,
          borderRadius: 16,
          boxShadow: colors.containerShadow,
          padding: '24px',
          position: 'relative',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        {/* Close button */}
        <button
          onClick={() => setShowSetupOverlay(false)}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'none',
            border: 'none',
            color: colors.textMuted,
            cursor: 'default',
            padding: 4,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Terminal size={28} weight="duotone" style={{ color: colors.accent, marginBottom: 8 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary, letterSpacing: '0.5px' }}>
            Setup Required
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Cloak needs at least one CLI installed and authenticated.
          </div>
        </div>

        {/* Claude Code Card */}
        <ProviderCard
          name="Claude Code"
          authenticated={claudeAuth}
          installCmd="npm install -g @anthropic-ai/claude-code"
          authHint={isMac ? 'Run "claude" in Terminal to log in' : 'Run "claude" in PowerShell to log in'}
          installing={claudeInstalling}
          installError={installError.claude}
          onInstall={handleInstallClaude}
          onOpenTerminal={handleOpenTerminalClaude}
          colors={colors}
        />

        <div style={{ height: 12 }} />

        {/* Codex Card */}
        <ProviderCard
          name="OpenAI Codex"
          authenticated={codexAuth}
          installCmd="npm install -g @openai/codex"
          authHint={isMac ? 'Run "codex" in Terminal to log in' : 'Run "codex" in PowerShell to log in'}
          installing={codexInstalling}
          installError={installError.codex}
          onInstall={handleInstallCodex}
          onOpenTerminal={handleOpenTerminalCodex}
          colors={colors}
        />

        {/* Auto-poll notice */}
        <div
          style={{
            marginTop: 16,
            padding: '8px 12px',
            borderRadius: 8,
            background: colors.surfacePrimary,
            border: `1px solid ${colors.containerBorder}`,
            fontSize: 11,
            color: colors.textMuted,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <ArrowClockwise size={11} style={{ opacity: 0.6 }} />
          Checking automatically every few seconds…
        </div>

        {/* Manual check button */}
        <button
          onClick={handleCheckAgain}
          disabled={checking}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '9px 0',
            borderRadius: 10,
            border: `1px solid ${colors.accent}55`,
            background: colors.accent + '18',
            color: colors.accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'background 0.15s',
            opacity: checking ? 0.6 : 1,
          }}
          onMouseEnter={(e) => { if (!checking) e.currentTarget.style.background = colors.accent + '28' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.accent + '18' }}
        >
          <ArrowClockwise size={14} weight="bold" style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} />
          {checking ? 'Checking…' : 'Check Now'}
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function ProviderCard({
  name,
  authenticated,
  installCmd,
  authHint,
  installing,
  installError,
  onInstall,
  onOpenTerminal,
  colors,
}: {
  name: string
  authenticated: boolean
  installCmd: string
  authHint: string
  installing: boolean
  installError?: string
  onInstall: () => void
  onOpenTerminal: () => void
  colors: any
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        background: colors.surfacePrimary,
        border: `1px solid ${authenticated ? '#22c55e33' : colors.containerBorder}`,
      }}
    >
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: authenticated ? 0 : 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500 }}>
          {authenticated ? (
            <>
              <CheckCircle size={14} weight="fill" color="#22c55e" />
              <span style={{ color: '#22c55e' }}>Ready</span>
            </>
          ) : (
            <>
              <XCircle size={14} weight="fill" color="#ef4444" />
              <span style={{ color: '#ef4444' }}>Not set up</span>
            </>
          )}
        </div>
      </div>

      {/* Setup steps (only when not authenticated) */}
      {!authenticated && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Step 1: Install */}
          <div>
            <div style={{ fontSize: 11, color: colors.textSecondary, fontWeight: 500, marginBottom: 5 }}>
              Step 1 — Install
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <code
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: colors.surfaceSecondary,
                  color: colors.accent,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {installCmd}
              </code>
              <button
                onClick={onInstall}
                disabled={installing}
                style={{
                  flexShrink: 0,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: `1px solid ${colors.accent}55`,
                  background: colors.accent + '18',
                  color: colors.accent,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: installing ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
                title="Install automatically via npm"
              >
                <DownloadSimple
                  size={12}
                  weight="bold"
                  style={{ animation: installing ? 'spin 1s linear infinite' : 'none' }}
                />
                {installing ? 'Installing…' : 'Auto-install'}
              </button>
            </div>
            {installError && (
              <div style={{ marginTop: 4, fontSize: 10, color: '#ef4444', wordBreak: 'break-word' }}>
                {installError}
              </div>
            )}
          </div>

          {/* Step 2: Authenticate */}
          <div>
            <div style={{ fontSize: 11, color: colors.textSecondary, fontWeight: 500, marginBottom: 5 }}>
              Step 2 — Authenticate
            </div>
            <button
              onClick={onOpenTerminal}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.containerBorder}`,
                background: colors.surfaceSecondary,
                color: colors.textSecondary,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                textAlign: 'left',
              }}
              title="Open a terminal with the auth command ready to run"
            >
              <Terminal size={12} />
              {authHint}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
