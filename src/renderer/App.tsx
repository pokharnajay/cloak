import React, { useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Camera, HeadCircuit } from '@phosphor-icons/react'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { StatusBar } from './components/StatusBar'
import { MarketplacePanel } from './components/MarketplacePanel'
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { useSessionStore } from './stores/sessionStore'
import { useColors, useThemeStore, spacing } from './theme'

const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }
const SPRING = { type: 'spring' as const, stiffness: 320, damping: 32, mass: 0.8 }

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()

  const activeTabStatus = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.status)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const colors = useColors()
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const expandedUI = useThemeStore((s) => s.expandedUI)

  // ─── Theme initialization ───
  useEffect(() => {
    window.clui.getTheme().then(({ isDark }) => {
      setSystemTheme(isDark)
    }).catch(() => {})

    const unsub = window.clui.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    useSessionStore.getState().initStaticInfo().then(() => {
      const homeDir = useSessionStore.getState().staticInfo?.homePath || '~'
      const tab = useSessionStore.getState().tabs[0]
      if (tab) {
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, workingDirectory: homeDir, hasChosenDirectory: false } : t)),
        }))
        window.clui.createTab().then(({ tabId }) => {
          useSessionStore.setState((s) => ({
            tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, id: tabId } : t)),
            activeTabId: tabId,
          }))
        }).catch(() => {})
      }
    })
  }, [])

  // Listen for screenshot-ask global shortcut (screenshot pre-attached, focus input)
  useEffect(() => {
    const unsub = window.clui.onScreenshotAsk((attachment) => {
      addAttachments([attachment])
      // Expand overlay if collapsed
      if (!useSessionStore.getState().isExpanded) {
        useSessionStore.getState().toggleExpanded()
      }
    })
    return unsub
  }, [addAttachments])

  // Stealth mode blocked action — show in-app message instead of OS dialog
  const [stealthMsg, setStealthMsg] = useState<string | null>(null)
  useEffect(() => {
    const unsub = window.clui.onStealthBlocked((msg) => {
      setStealthMsg(msg)
      setTimeout(() => setStealthMsg(null), 4000)
    })
    return unsub
  }, [])

  // Provider toast notifications (Codex install progress, missing API key, etc.)
  const [providerToast, setProviderToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null)
  useEffect(() => {
    const unsub = window.clui.onProviderToast((toast) => {
      setProviderToast(toast)
      setTimeout(() => setProviderToast(null), 5000)
    })
    return unsub
  }, [])

  // OS-level click-through (RAF-throttled to avoid per-pixel IPC)
  useEffect(() => {
    if (!window.clui?.setIgnoreMouseEvents) return
    let lastIgnored: boolean | null = null

    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isUI = !!(el && el.closest('[data-clui-ui]'))
      const shouldIgnore = !isUI
      if (shouldIgnore !== lastIgnored) {
        lastIgnored = shouldIgnore
        if (shouldIgnore) {
          window.clui.setIgnoreMouseEvents(true, { forward: true })
        } else {
          window.clui.setIgnoreMouseEvents(false)
        }
      }
    }

    const onMouseLeave = () => {
      if (lastIgnored !== true) {
        lastIgnored = true
        window.clui.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  const isExpanded = useSessionStore((s) => s.isExpanded)
  const marketplaceOpen = useSessionStore((s) => s.marketplaceOpen)
  const isStealth = !useThemeStore((s) => s.visibleInScreenShare)
  const isCodex = useSessionStore((s) => s.preferredProvider) === 'codex'
  const isRunning = activeTabStatus === 'running' || activeTabStatus === 'connecting'
  const needsAttention = activeTabStatus === 'failed' || activeTabStatus === 'dead'
  const hasPermission = useSessionStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return (tab?.permissionQueue?.length ?? 0) > 0
  })

  // Ambient status glow for collapsed pill
  const ambientGlow = !isExpanded
    ? isRunning
      ? `0 0 24px 4px rgba(44, 177, 188, 0.2), 0 0 8px 2px rgba(44, 177, 188, 0.15)`
      : hasPermission
        ? `0 0 24px 4px rgba(240, 180, 41, 0.25), 0 0 8px 2px rgba(240, 180, 41, 0.15)`
        : needsAttention
          ? `0 0 20px 4px rgba(225, 45, 57, 0.2)`
          : undefined
    : undefined

  // Layout dimensions
  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = expandedUI ? 15 : 15
  const bodyMaxHeight = expandedUI ? 520 : 400

  const handleScreenshot = useCallback(async () => {
    const result = await window.clui.takeScreenshot('fullscreen')
    if (!result) return
    addAttachments([result])
  }, [addAttachments])

  const handleAttachFile = useCallback(async () => {
    const files = await window.clui.attachFiles()
    if (!files || files.length === 0) return
    addAttachments(files)
  }, [addAttachments])

  // ─── Drag & Drop files onto overlay ───
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isStealth) return // Block drag in stealth mode
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [isStealth])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (isStealth) return // Block drop in stealth mode

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const attachments = files.map((file) => ({
      id: crypto.randomUUID(),
      type: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
      name: file.name,
      path: (file as any).path || file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    }))
    addAttachments(attachments)
  }, [addAttachments, isStealth])

  return (
    <PopoverLayerProvider>
      <div
        className="flex flex-col justify-end h-full"
        style={{ background: 'transparent' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Stealth mode blocked toast */}
        <AnimatePresence>
          {stealthMsg && (
            <motion.div
              data-clui-ui
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-[11px]"
              style={{
                background: 'rgba(225, 45, 57, 0.15)',
                border: '1px solid rgba(225, 45, 57, 0.3)',
                color: '#E12D39',
                backdropFilter: 'blur(12px)',
                maxWidth: 360,
                textAlign: 'center',
                pointerEvents: 'auto',
              }}
            >
              {stealthMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Provider toast (Codex install, missing API key, etc.) */}
        <AnimatePresence>
          {providerToast && (
            <motion.div
              data-clui-ui
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-[11px]"
              style={{
                background: providerToast.type === 'error'
                  ? 'rgba(225, 45, 57, 0.15)'
                  : providerToast.type === 'success'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(59, 130, 246, 0.15)',
                border: `1px solid ${
                  providerToast.type === 'error'
                    ? 'rgba(225, 45, 57, 0.3)'
                    : providerToast.type === 'success'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : 'rgba(59, 130, 246, 0.3)'
                }`,
                color: providerToast.type === 'error'
                  ? '#E12D39'
                  : providerToast.type === 'success'
                    ? '#10B981'
                    : '#3B82F6',
                backdropFilter: 'blur(12px)',
                maxWidth: 400,
                textAlign: 'center',
                pointerEvents: 'auto',
              }}
            >
              {providerToast.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drop zone overlay */}
        <AnimatePresence>
          {isDragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              data-clui-ui
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{
                background: 'rgba(44, 177, 188, 0.08)',
                border: '2px dashed rgba(44, 177, 188, 0.4)',
                borderRadius: 20,
                margin: 20,
              }}
            >
              <div className="text-center">
                <div className="text-[14px] font-medium" style={{ color: colors.accent }}>Drop files here</div>
                <div className="text-[12px] mt-1" style={{ color: colors.textTertiary }}>Files will be attached to your message</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Content column, centered ─── */}
        <div style={{ width: contentWidth, position: 'relative', margin: '0 auto', transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)' }}>

          <AnimatePresence initial={false}>
            {marketplaceOpen && (
              <div
                data-clui-ui
                style={{
                  width: 720,
                  maxWidth: 720,
                  marginLeft: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 14,
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.985 }}
                  transition={TRANSITION}
                >
                  <div
                    data-clui-ui
                    className="glass-surface overflow-hidden no-drag"
                    style={{
                      borderRadius: 24,
                      maxHeight: 470,
                    }}
                  >
                    <MarketplacePanel />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* ─── Tabs / message shell ─── */}
          <motion.div
            data-clui-ui
            className="overflow-hidden flex flex-col drag-region"
            animate={{
              width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
              marginBottom: isExpanded ? 10 : -14,
              marginLeft: isExpanded ? 0 : cardCollapsedMargin,
              marginRight: isExpanded ? 0 : cardCollapsedMargin,
              background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
              borderColor: colors.containerBorder,
              boxShadow: isExpanded ? colors.cardShadow : (ambientGlow || colors.cardShadowCollapsed),
            }}
            transition={SPRING}
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: 20,
              position: 'relative',
              zIndex: isExpanded ? 20 : 10,
            }}
          >
            <div className="no-drag">
              <TabStrip />
            </div>

            {/* Body — chat history */}
            <motion.div
              initial={false}
              animate={{
                maxHeight: isExpanded ? bodyMaxHeight : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={SPRING}
              className="overflow-hidden no-drag"
            >
              <div>
                <ConversationView />
                <StatusBar />
              </div>
            </motion.div>
          </motion.div>

          {/* ─── Input row — circles float outside left ─── */}
          <motion.div key="input-row" data-clui-ui className="relative"
            style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={TRANSITION}>

            {/* Stacked circle buttons */}
            <div data-clui-ui className="circles-out">
              <div className="btn-stack">
                {/* Attach file — Claude only (Codex only supports images via screenshot) */}
                {!isCodex && (
                  <button
                    className="stack-btn stack-btn-1 glass-surface"
                    title={isStealth ? "Disabled in stealth mode" : "Attach file"}
                    onClick={handleAttachFile}
                    disabled={isRunning || isStealth}
                  >
                    <Paperclip size={17} />
                  </button>
                )}
                <button
                  className={`stack-btn ${isCodex ? 'stack-btn-1' : 'stack-btn-2'} glass-surface`}
                  title="Take screenshot"
                  onClick={handleScreenshot}
                  disabled={isRunning}
                >
                  <Camera size={17} />
                </button>
                {/* Skills marketplace — Claude only */}
                {!isCodex && (
                  <button
                    className={`stack-btn ${isCodex ? 'stack-btn-2' : 'stack-btn-3'} glass-surface`}
                    title="Skills & Plugins"
                    onClick={() => useSessionStore.getState().toggleMarketplace()}
                    disabled={isRunning}
                  >
                    <HeadCircuit size={17} />
                  </button>
                )}
              </div>
            </div>

            {/* Input pill */}
            <div
              data-clui-ui
              className="glass-surface w-full"
              style={{ minHeight: 50, borderRadius: 25, padding: '0 6px 0 16px', background: colors.inputPillBg }}
            >
              <InputBar />
            </div>
          </motion.div>
        </div>
      </div>
    </PopoverLayerProvider>
  )
}
