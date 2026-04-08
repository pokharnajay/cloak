import React, { useState } from 'react'
import { X, CheckCircle, XCircle, ArrowClockwise, Terminal } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

export function SetupOverlay() {
  const showSetupOverlay = useSessionStore((s) => s.showSetupOverlay)
  const providerAuth = useSessionStore((s) => s.providerAuth)
  const setShowSetupOverlay = useSessionStore((s) => s.setShowSetupOverlay)
  const checkAndSetProviderAuth = useSessionStore((s) => s.checkAndSetProviderAuth)
  const platform = useSessionStore((s) => s.staticInfo?.platform) || 'darwin'
  const colors = useColors()
  const [checking, setChecking] = useState(false)

  if (!showSetupOverlay) return null

  const isMac = platform === 'darwin'
  const terminalName = isMac ? 'Terminal' : 'PowerShell'
  const claudeAuth = providerAuth?.claude ?? false
  const codexAuth = providerAuth?.codex ?? false

  const handleCheckAgain = async () => {
    setChecking(true)
    await checkAndSetProviderAuth()
    setChecking(false)
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
          width: 420,
          background: colors.containerBg,
          border: `1px solid ${colors.containerBorder}`,
          borderRadius: 16,
          boxShadow: colors.containerShadow,
          padding: '24px',
          position: 'relative',
          maxHeight: '80vh',
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
            Cloak needs at least one CLI authenticated to work.
          </div>
        </div>

        {/* Claude Code Card */}
        <ProviderCard
          name="Claude Code"
          authenticated={claudeAuth}
          installCmd="npm install -g @anthropic-ai/claude-code"
          authCmd="claude"
          terminalName={terminalName}
          colors={colors}
        />

        <div style={{ height: 12 }} />

        {/* Codex Card */}
        <ProviderCard
          name="OpenAI Codex"
          authenticated={codexAuth}
          installCmd="npm install -g @openai/codex"
          authCmd="codex"
          terminalName={terminalName}
          colors={colors}
        />

        {/* Restart notice */}
        <div
          style={{
            marginTop: 16,
            padding: '10px 12px',
            borderRadius: 8,
            background: colors.accent + '12',
            border: `1px solid ${colors.accent}33`,
            fontSize: 11,
            color: colors.accent,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          After authenticating in {terminalName}, click "Check Again" below.
        </div>

        {/* Check Again button */}
        <button
          onClick={handleCheckAgain}
          disabled={checking}
          style={{
            marginTop: 14,
            width: '100%',
            padding: '10px 0',
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
          {checking ? 'Checking...' : 'Check Again'}
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
  authCmd,
  terminalName,
  colors,
}: {
  name: string
  authenticated: boolean
  installCmd: string
  authCmd: string
  terminalName: string
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500 }}>
          {authenticated ? (
            <>
              <CheckCircle size={14} weight="fill" color="#22c55e" />
              <span style={{ color: '#22c55e' }}>Authenticated</span>
            </>
          ) : (
            <>
              <XCircle size={14} weight="fill" color="#ef4444" />
              <span style={{ color: '#ef4444' }}>Not authenticated</span>
            </>
          )}
        </div>
      </div>

      {/* Instructions (only show if not authenticated) */}
      {!authenticated && (
        <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: colors.textSecondary, fontWeight: 500 }}>1. Install:</span>
          </div>
          <code
            style={{
              display: 'block',
              padding: '6px 10px',
              borderRadius: 6,
              background: colors.surfaceSecondary,
              color: colors.accent,
              fontSize: 11,
              fontFamily: 'monospace',
              marginBottom: 8,
              wordBreak: 'break-all',
            }}
          >
            {installCmd}
          </code>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: colors.textSecondary, fontWeight: 500 }}>2. Authenticate in {terminalName}:</span>
          </div>
          <code
            style={{
              display: 'block',
              padding: '6px 10px',
              borderRadius: 6,
              background: colors.surfaceSecondary,
              color: colors.accent,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
          >
            {authCmd}
          </code>
        </div>
      )}
    </div>
  )
}
