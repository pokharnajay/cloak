import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, EyeSlash, SignOut, Camera, Keyboard, ArrowsLeftRight } from '@phosphor-icons/react'
import { ShortcutEditor } from './ShortcutEditor'
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
  const soundEnabled = useThemeStore((s) => s.soundEnabled)
  const setSoundEnabled = useThemeStore((s) => s.setSoundEnabled)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const visibleInScreenShare = useThemeStore((s) => s.visibleInScreenShare)
  const setVisibleInScreenShare = useThemeStore((s) => s.setVisibleInScreenShare)
  const screenshotMode = useThemeStore((s) => s.screenshotMode)
  const setScreenshotMode = useThemeStore((s) => s.setScreenshotMode)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  // Sync persisted screen-share preference to the main process on mount.
  useEffect(() => {
    window.clui?.setContentProtection(!visibleInScreenShare)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preferredProvider = useSessionStore((s) => s.preferredProvider)
  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false)
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
                    return (
                      <button
                        key={id}
                        onClick={() => setPreferredModel(id, PROVIDERS[id].models[0].modelId)}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors"
                        style={{
                          background: isActive ? colors.accent + '22' : 'transparent',
                          color: isActive ? colors.accent : colors.textMuted,
                          border: `1px solid ${isActive ? colors.accent + '44' : colors.containerBorder}`,
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

            {/* Notification sound */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Bell size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Notification sound
                  </div>
                </div>
                <RowToggle
                  checked={soundEnabled}
                  onChange={setSoundEnabled}
                  colors={colors}
                  label="Toggle notification sound"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Screenshot mode — hidden for now, always fullscreen
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Camera size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Screenshot mode
                </div>
              </div>
              <div className="flex gap-1.5 ml-5">
                {([
                  { value: 'fullscreen' as const, label: 'Full Screen' },
                  { value: 'region' as const, label: 'Select Region' },
                ] as const).map((opt) => {
                  const isActive = screenshotMode === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setScreenshotMode(opt.value)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors"
                      style={{
                        background: isActive ? colors.accent + '22' : 'transparent',
                        color: isActive ? colors.accent : colors.textSecondary,
                        border: `1px solid ${isActive ? colors.accent + '44' : colors.containerBorder}`,
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{
                          border: `1.5px solid ${isActive ? colors.accent : colors.textMuted}`,
                          background: isActive ? colors.accent : 'transparent',
                          boxShadow: isActive ? `inset 0 0 0 2px ${colors.popoverBg}` : 'none',
                        }}
                      />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />
            */}

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

            {/* Keyboard shortcuts */}
            <div>
              <button
                onClick={() => { setShortcutEditorOpen(true); setOpen(false) }}
                className="flex items-center gap-2 w-full text-left"
              >
                <Keyboard size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Keyboard shortcuts
                </div>
              </button>
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
      <ShortcutEditor open={shortcutEditorOpen} onClose={() => setShortcutEditorOpen(false)} />
    </>
  )
}
