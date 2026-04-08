import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, ArrowsOutSimple, Moon, EyeSlash, SignOut, Keyboard, ArrowsLeftRight } from '@phosphor-icons/react'
import { useThemeStore } from '../theme'
import { useSessionStore, PROVIDERS } from '../stores/sessionStore'
import type { ProviderId } from '../../shared/types'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'

function RowToggle({
  checked,
  onChange,
  colors,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  colors: ReturnType<typeof useColors>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? colors.accent : colors.surfaceSecondary,
        border: `1px solid ${checked ? colors.accent : colors.containerBorder}`,
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
        style={{
          left: checked ? 18 : 2,
          background: '#fff',
        }}
      />
    </button>
  )
}

/* ─── Settings popover ─── */

export function SettingsPopover() {
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const visibleInScreenShare = useThemeStore((s) => s.visibleInScreenShare)
  const setVisibleInScreenShare = useThemeStore((s) => s.setVisibleInScreenShare)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  // Sync persisted screen-share preference to the main process on mount.
  useEffect(() => {
    window.clui?.setContentProtection(!visibleInScreenShare)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preferredProvider = useSessionStore((s) => s.preferredProvider)
  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6
    const margin = 8
    const right = window.innerWidth - rect.right

    // Always open upward from trigger
    setPos({ bottom: window.innerHeight - rect.top + gap, right, maxHeight: Math.max(120, rect.top - margin) })
  }, [isExpanded])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onResize = () => updatePos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, updatePos])

  // Keep panel tracking the trigger continuously while open so it follows
  // width/position animations of the top bar without feeling "stuck in space."
  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      updatePos()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [open, expandedUI, isExpanded, updatePos])

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title="Settings"
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {popoverLayer && open && createPortal(
        <>
          {/* Transparent backdrop — catches clicks anywhere including inside webview */}
          <div
            data-clui-ui
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 999, pointerEvents: 'auto' }}
          />
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 240,
            pointerEvents: 'auto',
            zIndex: 1000,
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            ...(pos.maxHeight != null ? { maxHeight: pos.maxHeight, overflowY: 'auto' as const } : {}),
          }}
        >
          <div className="p-3 flex flex-col gap-2.5">
            {/* Full width */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowsOutSimple size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Full width
                  </div>
                </div>
                <RowToggle
                  checked={expandedUI}
                  onChange={(next) => {
                    setExpandedUI(next)
                  }}
                  colors={colors}
                  label="Toggle full width panel"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* AI Provider toggle */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowsLeftRight size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    AI Provider
                  </div>
                </div>
                <div className="flex gap-1">
                  {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
                    const isActive = (preferredProvider || 'claude') === id
                    const providerAuth = useSessionStore.getState().providerAuth
                    const isLocked = providerAuth ? !providerAuth[id] : false
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          if (isLocked) return
                          setPreferredModel(id, PROVIDERS[id].models[0].modelId)
                        }}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors"
                        title={isLocked ? `${PROVIDERS[id].label} is not authenticated. Run "${id === 'claude' ? 'claude' : 'codex'}" in your terminal.` : ''}
                        style={{
                          background: isActive ? colors.accent + '22' : 'transparent',
                          color: isLocked ? colors.textMuted + '66' : isActive ? colors.accent : colors.textMuted,
                          border: `1px solid ${isActive ? colors.accent + '44' : colors.containerBorder}`,
                          opacity: isLocked ? 0.4 : 1,
                          cursor: 'default',
                        }}
                      >
                        {PROVIDERS[id].label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Stealth Mode (inverted: ON = invisible = contentProtection true) */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <EyeSlash size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Stealth mode
                  </div>
                </div>
                <RowToggle
                  checked={!visibleInScreenShare}
                  onChange={(stealth) => setVisibleInScreenShare(!stealth)}
                  colors={colors}
                  label="Toggle stealth mode"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Theme */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Moon size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Dark theme
                  </div>
                </div>
                <RowToggle
                  checked={themeMode === 'dark'}
                  onChange={(next) => setThemeMode(next ? 'dark' : 'light')}
                  colors={colors}
                  label="Toggle dark theme"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Shortcut display */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Keyboard size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Toggle
                </div>
              </div>
              <div className="text-[11px] font-mono" style={{ color: colors.textMuted }}>
                {staticInfo?.platform === 'darwin' ? '⌥ Space' : 'Ctrl Space'}
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Quit */}
            <div>
              <button
                onClick={() => window.close()}
                className="flex items-center gap-2 w-full text-left"
              >
                <SignOut size={14} style={{ color: colors.statusError }} />
                <div className="text-[12px] font-medium" style={{ color: colors.statusError }}>
                  Quit Cloak
                </div>
              </button>
            </div>
          </div>
        </motion.div>
        </>,
        popoverLayer,
      )}
    </>
  )
}
