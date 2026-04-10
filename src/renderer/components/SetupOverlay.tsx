import React, { useState, useEffect, useRef } from 'react'
import {
  X, CheckCircle, XCircle, ArrowClockwise, Terminal,
  DownloadSimple, Globe, Key, ArrowRight,
} from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

const POLL_INTERVAL = 4000

type ClaudeAuthState = 'idle' | 'installing' | 'waiting-browser' | 'success' | 'error'
type CodexAuthState  = 'idle' | 'installing' | 'saving-key' | 'success' | 'error'

export function SetupOverlay() {
  const showSetupOverlay        = useSessionStore((s) => s.showSetupOverlay)
  const providerAuth            = useSessionStore((s) => s.providerAuth)
  const setShowSetupOverlay     = useSessionStore((s) => s.setShowSetupOverlay)
  const checkAndSetProviderAuth = useSessionStore((s) => s.checkAndSetProviderAuth)
  const platform = useSessionStore((s) => s.staticInfo?.platform) || 'darwin'
  const colors = useColors()

  // Claude state
  const [claudeState, setClaudeState]   = useState<ClaudeAuthState>('idle')
  const [claudeError, setClaudeError]   = useState<string | undefined>()
  const [claudeInstallErr, setClaudeInstallErr] = useState<string | undefined>()

  // Codex state
  const [codexState, setCodexState]     = useState<CodexAuthState>('idle')
  const [codexError, setCodexError]     = useState<string | undefined>()
  const [codexInstallErr, setCodexInstallErr]   = useState<string | undefined>()
  const [codexApiKey, setCodexApiKey]   = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)

  const [checking, setChecking] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMac      = platform === 'darwin'
  const claudeAuth = providerAuth?.claude ?? false
  const codexAuth  = providerAuth?.codex  ?? false

  // Auto-close when at least one provider is authenticated
  useEffect(() => {
    if (showSetupOverlay && (claudeAuth || codexAuth)) {
      setShowSetupOverlay(false)
    }
  }, [claudeAuth, codexAuth, showSetupOverlay, setShowSetupOverlay])

  // Auto-poll while overlay is open
  useEffect(() => {
    if (!showSetupOverlay) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(() => checkAndSetProviderAuth(), POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [showSetupOverlay, checkAndSetProviderAuth])

  if (!showSetupOverlay) return null

  // ─── Claude handlers ───

  const handleClaudeInstall = async () => {
    setClaudeState('installing')
    setClaudeInstallErr(undefined)
    const result = await window.clui.installClaude()
    if (result.ok) {
      setClaudeState('idle')
      await checkAndSetProviderAuth()
    } else {
      setClaudeState('error')
      setClaudeInstallErr(result.error || 'Install failed')
      setClaudeState('idle')
    }
  }

  const handleClaudeLogin = async () => {
    setClaudeState('waiting-browser')
    setClaudeError(undefined)
    // This opens the browser automatically from the main process once the URL is captured.
    const result = await window.clui.authClaudeWithBrowser()
    if (result.ok) {
      setClaudeState('success')
      await checkAndSetProviderAuth()
    } else {
      setClaudeState('error')
      setClaudeError(result.error || 'Login failed')
    }
  }

  const handleCancelClaudeLogin = () => setClaudeState('idle')

  // ─── Codex handlers ───

  const handleCodexInstall = async () => {
    setCodexState('installing')
    setCodexInstallErr(undefined)
    const result = await window.clui.installCodex()
    if (result.ok) {
      setCodexState('idle')
      await checkAndSetProviderAuth()
    } else {
      setCodexState('error')
      setCodexInstallErr(result.error || 'Install failed')
      setCodexState('idle')
    }
  }

  const handleCodexSaveKey = async () => {
    if (!codexApiKey.trim()) return
    setCodexState('saving-key')
    setCodexError(undefined)
    const result = await window.clui.authCodexWithApiKey(codexApiKey.trim())
    if (result.ok) {
      setCodexState('success')
      await checkAndSetProviderAuth()
    } else {
      setCodexState('error')
      setCodexError(result.error || 'Failed to save API key')
    }
  }

  const handleOpenTerminalCodex = () => window.clui.openAuthTerminal(isMac ? 'codex' : 'codex')

  const handleCheckNow = async () => {
    setChecking(true)
    await checkAndSetProviderAuth()
    setChecking(false)
  }

  return (
    <div
      data-clui-ui
      style={{
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: 460,
          background: colors.containerBg,
          border: `1px solid ${colors.containerBorder}`,
          borderRadius: 16,
          boxShadow: colors.containerShadow,
          padding: '24px',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Close */}
        <button
          onClick={() => setShowSetupOverlay(false)}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', color: colors.textMuted,
            cursor: 'default', padding: 4, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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

        {/* ── Claude Code card ── */}
        <ProviderSection
          name="Claude Code"
          badge="anthropic.com · Pro / Max / Team / Enterprise"
          authenticated={claudeAuth}
          colors={colors}
        >
          {!claudeAuth && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Step 1 — Install */}
              <StepRow label="Step 1 — Install">
                <CodeTag colors={colors}>npm install -g @anthropic-ai/claude-code</CodeTag>
                <SmallBtn
                  loading={claudeState === 'installing'}
                  icon={<DownloadSimple size={11} weight="bold" />}
                  onClick={handleClaudeInstall}
                  loadingLabel="Installing…"
                  label="Auto-install"
                  colors={colors}
                />
                {claudeInstallErr && <ErrText>{claudeInstallErr}</ErrText>}
              </StepRow>

              {/* Step 2 — Login */}
              <StepRow label="Step 2 — Log in with your Anthropic account">
                {claudeState === 'waiting-browser' ? (
                  <WaitingBrowser
                    label="Browser opened — finish sign-in, then return here"
                    onCancel={handleCancelClaudeLogin}
                    colors={colors}
                  />
                ) : (
                  <PrimaryBtn
                    icon={<Globe size={13} weight="bold" />}
                    onClick={handleClaudeLogin}
                    colors={colors}
                  >
                    Login with Browser
                  </PrimaryBtn>
                )}
                {claudeState === 'error' && claudeError && <ErrText>{claudeError}</ErrText>}
              </StepRow>
            </div>
          )}
        </ProviderSection>

        <div style={{ height: 12 }} />

        {/* ── Codex card ── */}
        <ProviderSection
          name="OpenAI Codex"
          badge="openai.com · Plus / Pro / Business / Enterprise — or API key"
          authenticated={codexAuth}
          colors={colors}
        >
          {!codexAuth && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Step 1 — Install */}
              <StepRow label="Step 1 — Install">
                <CodeTag colors={colors}>npm install -g @openai/codex</CodeTag>
                <SmallBtn
                  loading={codexState === 'installing'}
                  icon={<DownloadSimple size={11} weight="bold" />}
                  onClick={handleCodexInstall}
                  loadingLabel="Installing…"
                  label="Auto-install"
                  colors={colors}
                />
                {codexInstallErr && <ErrText>{codexInstallErr}</ErrText>}
              </StepRow>

              {/* Step 2 — Authenticate */}
              <StepRow label="Step 2 — Authenticate">
                {/* Primary: Browser OAuth via terminal (Codex needs a TTY for its interactive picker) */}
                <PrimaryBtn
                  icon={<Globe size={13} weight="bold" />}
                  onClick={handleOpenTerminalCodex}
                  colors={colors}
                >
                  Login with Browser
                </PrimaryBtn>
                <div style={{ fontSize: 10, color: colors.textMuted, lineHeight: 1.4, paddingLeft: 2 }}>
                  A terminal will open — select <strong style={{ color: colors.textSecondary }}>"Sign in with ChatGPT"</strong> and your browser will open automatically. Cloak detects when you're done.
                </div>

                {/* Secondary: API key */}
                <div style={{ height: 2 }} />
                <button
                  onClick={() => setShowApiKeyInput((v) => !v)}
                  style={{
                    alignSelf: 'flex-start', padding: '4px 9px', borderRadius: 5,
                    border: `1px solid ${colors.containerBorder}`,
                    background: 'none', color: colors.textMuted,
                    fontSize: 10, cursor: 'default',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Key size={10} weight="bold" />
                  {showApiKeyInput ? 'Hide' : 'Or enter an API key instead'}
                </button>

                {showApiKeyInput && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    <input
                      type="password"
                      value={codexApiKey}
                      onChange={(e) => setCodexApiKey(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCodexSaveKey() }}
                      placeholder="sk-..."
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 6,
                        border: `1px solid ${colors.containerBorder}`,
                        background: colors.surfaceSecondary,
                        color: colors.textPrimary, fontSize: 11, fontFamily: 'monospace',
                        outline: 'none',
                      }}
                      autoFocus
                    />
                    <button
                      onClick={handleCodexSaveKey}
                      disabled={!codexApiKey.trim() || codexState === 'saving-key'}
                      style={{
                        padding: '6px 10px', borderRadius: 6,
                        border: `1px solid ${colors.accent}55`,
                        background: colors.accent + '18',
                        color: colors.accent, fontSize: 11, fontWeight: 600,
                        cursor: 'default', display: 'flex', alignItems: 'center', gap: 4,
                        opacity: !codexApiKey.trim() || codexState === 'saving-key' ? 0.5 : 1,
                      }}
                    >
                      {codexState === 'saving-key' ? (
                        <ArrowClockwise size={11} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <ArrowRight size={11} weight="bold" />
                      )}
                      {codexState === 'saving-key' ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}

                {codexState === 'error' && codexError && <ErrText>{codexError}</ErrText>}
              </StepRow>
            </div>
          )}
        </ProviderSection>

        {/* Auto-poll notice */}
        <div style={{
          marginTop: 16, padding: '7px 12px', borderRadius: 8,
          background: colors.surfacePrimary, border: `1px solid ${colors.containerBorder}`,
          fontSize: 11, color: colors.textMuted, textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <ArrowClockwise size={11} style={{ opacity: 0.5 }} />
          Checking automatically every few seconds…
        </div>

        {/* Manual check */}
        <button
          onClick={handleCheckNow}
          disabled={checking}
          style={{
            marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 10,
            border: `1px solid ${colors.accent}55`, background: colors.accent + '18',
            color: colors.accent, fontSize: 13, fontWeight: 600, cursor: 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: checking ? 0.6 : 1,
          }}
          onMouseEnter={(e) => { if (!checking) e.currentTarget.style.background = colors.accent + '28' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.accent + '18' }}
        >
          <ArrowClockwise size={14} weight="bold" style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} />
          {checking ? 'Checking…' : 'Check Now'}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── Sub-components ───

function ProviderSection({ name, badge, authenticated, children, colors }: {
  name: string; badge: string; authenticated: boolean; children: React.ReactNode; colors: any
}) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 10,
      background: colors.surfacePrimary,
      border: `1px solid ${authenticated ? '#22c55e33' : colors.containerBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: authenticated ? 0 : 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{name}</div>
          <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>{badge}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
          {authenticated ? (
            <><CheckCircle size={14} weight="fill" color="#22c55e" /><span style={{ color: '#22c55e' }}>Ready</span></>
          ) : (
            <><XCircle size={14} weight="fill" color="#ef4444" /><span style={{ color: '#ef4444' }}>Not set up</span></>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function StepRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 500, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
    </div>
  )
}

function CodeTag({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <code style={{
      display: 'block', padding: '5px 9px', borderRadius: 5,
      background: colors.surfaceSecondary, color: colors.accent,
      fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all',
    }}>{children}</code>
  )
}

function SmallBtn({ loading, icon, onClick, loadingLabel, label, colors }: {
  loading: boolean; icon: React.ReactNode; onClick: () => void
  loadingLabel: string; label: string; colors: any
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 5,
        border: `1px solid ${colors.accent}55`, background: colors.accent + '18',
        color: colors.accent, fontSize: 10, fontWeight: 600, cursor: 'default',
        display: 'flex', alignItems: 'center', gap: 4, opacity: loading ? 0.6 : 1,
      }}
    >
      <span style={{ animation: loading ? 'spin 1s linear infinite' : 'none', display: 'flex' }}>{icon}</span>
      {loading ? loadingLabel : label}
    </button>
  )
}

function PrimaryBtn({ icon, onClick, children, colors }: {
  icon: React.ReactNode; onClick: () => void; children: React.ReactNode; colors: any
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '9px 12px', borderRadius: 7,
        border: `1px solid ${colors.accent}66`, background: colors.accent + '22',
        color: colors.accent, fontSize: 12, fontWeight: 600, cursor: 'default',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = colors.accent + '35')}
      onMouseLeave={(e) => (e.currentTarget.style.background = colors.accent + '22')}
    >
      {icon}{children}
    </button>
  )
}

function WaitingBrowser({ label, onCancel, colors }: { label: string; onCancel: () => void; colors: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ArrowClockwise size={13} style={{ animation: 'spin 1.2s linear infinite', color: colors.accent, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: colors.textMuted, flex: 1 }}>{label}</span>
      <button
        onClick={onCancel}
        style={{
          padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'default',
          border: `1px solid ${colors.containerBorder}`, background: 'none', color: colors.textMuted,
        }}
      >Cancel</button>
    </div>
  )
}

function ErrText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#ef4444', wordBreak: 'break-word' }}>{children}</div>
}
