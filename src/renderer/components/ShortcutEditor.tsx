import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Keyboard, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useColors } from '../theme'

interface ShortcutConfig {
  toggleOverlay: string
  toggleOverlayAlt: string
  screenshotAsk: string
}

const SHORTCUT_LABELS: Record<keyof ShortcutConfig, string> = {
  toggleOverlay: 'Toggle Overlay',
  toggleOverlayAlt: 'Toggle Overlay (Secondary)',
  screenshotAsk: 'Screenshot + Ask',
}

const SHORTCUT_DESCRIPTIONS: Record<keyof ShortcutConfig, string> = {
  toggleOverlay: 'Show or hide the overlay',
  toggleOverlayAlt: 'Secondary shortcut to toggle',
  screenshotAsk: 'Capture screen and ask Claude',
}

/** Convert a DOM KeyboardEvent into an Electron accelerator string.
 *  Uses e.code (physical key) instead of e.key to avoid macOS Alt+key
 *  producing Unicode characters (e.g., Alt+S = ß instead of 'S'). */
function eventToAccelerator(e: KeyboardEvent, isMac: boolean): string | null {
  const code = e.code
  // Ignore standalone modifier presses
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
       'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) return null

  const parts: string[] = []
  if (isMac) {
    if (e.metaKey) parts.push('Command')
    if (e.ctrlKey) parts.push('Control')
  } else {
    if (e.ctrlKey) parts.push('Ctrl')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Map physical key codes to Electron accelerator names
  const codeMap: Record<string, string> = {
    Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape',
    Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
    Comma: ',', Period: '.', Slash: '/',
  }

  let keyName: string
  if (codeMap[code]) {
    keyName = codeMap[code]
  } else if (code.startsWith('Key')) {
    // KeyA → A, KeyZ → Z
    keyName = code.slice(3)
  } else if (code.startsWith('Digit')) {
    // Digit0 → 0, Digit9 → 9
    keyName = code.slice(5)
  } else if (code.startsWith('F') && /^F\d+$/.test(code)) {
    // F1-F12
    keyName = code
  } else {
    keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key
  }

  parts.push(keyName)

  // Must have at least one modifier
  if (parts.length < 2) return null
  return parts.join('+')
}

/** Format accelerator for display with platform symbols */
function formatAccelerator(accel: string, isMac: boolean): string {
  if (!accel) return '—'
  if (isMac) {
    return accel
      .replace(/Command/g, '⌘')
      .replace(/Control/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/\+/g, ' ')
  }
  return accel
}

interface Props {
  open: boolean
  onClose: () => void
}

export function ShortcutEditor({ open, onClose }: Props) {
  const colors = useColors()
  const [shortcuts, setShortcuts] = useState<ShortcutConfig | null>(null)
  const [defaults, setDefaults] = useState<ShortcutConfig | null>(null)
  const [platform, setPlatform] = useState<string>('mac')
  const [recording, setRecording] = useState<keyof ShortcutConfig | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const isMac = platform === 'mac'

  useEffect(() => {
    if (!open) return
    window.clui.getShortcuts().then(({ shortcuts: s, defaults: d, platform: p }) => {
      setShortcuts(s as ShortcutConfig)
      setDefaults(d as ShortcutConfig)
      setPlatform(p)
    })
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  // Key recording
  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setPendingKey(null)
        return
      }
      const accel = eventToAccelerator(e, isMac)
      if (accel) {
        setPendingKey(accel)
        setShortcuts((prev) => prev ? { ...prev, [recording]: accel } : prev)
        setRecording(null)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, isMac])

  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!shortcuts) return
    setSaveError(null)
    const result = await window.clui.setShortcuts(shortcuts) as any
    if (result.ok) {
      onClose()
    } else {
      // Some shortcuts failed — update UI with what actually got saved
      if (result.shortcuts) setShortcuts(result.shortcuts as ShortcutConfig)
      const failed = Object.entries(result.results || {})
        .filter(([, ok]) => !ok)
        .map(([key]) => SHORTCUT_LABELS[key as keyof ShortcutConfig] || key)
      setSaveError(`Could not register: ${failed.join(', ')}. The shortcut may be reserved by your OS.`)
    }
  }, [shortcuts, onClose])

  const handleReset = useCallback(async () => {
    if (!defaults) return
    setSaveError(null)
    setShortcuts({ ...defaults })
    await window.clui.setShortcuts(defaults)
  }, [defaults])

  if (!open || !shortcuts) return null

  const keys = Object.keys(SHORTCUT_LABELS) as Array<keyof ShortcutConfig>

  // Render directly into document.body to avoid any stacking context issues
  return createPortal(
    <>
      <div
        data-clui-ui
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'auto', background: 'rgba(0,0,0,0.3)' }}
      />
      <motion.div
        ref={panelRef}
        data-clui-ui
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 340,
          pointerEvents: 'auto',
          zIndex: 100000,
          background: colors.popoverBg,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: colors.popoverShadow,
          border: `1px solid ${colors.popoverBorder}`,
          borderRadius: 16,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <Keyboard size={16} style={{ color: colors.accent }} />
            <span className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
              Keyboard Shortcuts
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded-full"
            style={{ color: colors.textTertiary }}
          >
            <X size={12} />
          </button>
        </div>

        {/* Platform indicator */}
        <div className="px-4 pb-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: colors.surfaceHover, color: colors.textTertiary }}>
            {isMac ? 'macOS' : 'Windows'}
          </span>
        </div>

        {/* Shortcut rows */}
        <div className="px-4 pb-2">
          {keys.map((key) => {
            const isRecording = recording === key
            return (
              <div key={key} className="py-2" style={{ borderBottom: `1px solid ${colors.popoverBorder}` }}>
                <div className="flex items-center justify-between mb-0.5">
                  <div>
                    <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      {SHORTCUT_LABELS[key]}
                    </div>
                    <div className="text-[10px]" style={{ color: colors.textMuted }}>
                      {SHORTCUT_DESCRIPTIONS[key]}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setRecording(isRecording ? null : key)
                      setPendingKey(null)
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      background: isRecording ? colors.accent + '22' : colors.surfaceHover,
                      color: isRecording ? colors.accent : colors.textSecondary,
                      border: `1px solid ${isRecording ? colors.accent + '44' : colors.containerBorder}`,
                      minWidth: 100,
                      textAlign: 'center',
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                  >
                    {isRecording ? 'Press keys...' : formatAccelerator(shortcuts[key], isMac)}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Error message */}
        {saveError && (
          <div className="mx-4 mb-2 text-[10px] px-2.5 py-1.5 rounded-md" style={{ background: colors.statusErrorBg, color: colors.statusError }}>
            {saveError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md transition-colors"
            style={{ color: colors.textTertiary, background: colors.surfaceHover }}
          >
            <ArrowCounterClockwise size={11} />
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors"
            style={{
              background: colors.accent,
              color: '#fff',
            }}
          >
            Save
          </button>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}
