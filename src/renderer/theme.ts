/**
 * CLUI Design Tokens — Dual theme (dark + light)
 * Colors derived from ChatCN oklch system and design-fixed.html reference.
 */
import { create } from 'zustand'

// ─── Color palettes ───

const darkColors = {
  // Container — near-black with subtle cool tint
  containerBg: '#111318',
  containerBgCollapsed: '#0e1015',
  containerBorder: '#1f2933',
  containerShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)',
  cardShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 1px rgba(44, 177, 188, 0.15)',
  cardShadowCollapsed: '0 2px 10px rgba(0,0,0,0.5)',

  // Surface layers
  surfacePrimary: '#1a1d24',
  surfaceSecondary: '#242830',
  surfaceHover: 'rgba(255, 255, 255, 0.06)',
  surfaceActive: 'rgba(255, 255, 255, 0.1)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#1f2933',
  inputFocusBorder: 'rgba(44, 177, 188, 0.6)',
  inputPillBg: '#14171d',

  // Text — crisp, high readability
  textPrimary: '#FFFFFF',
  textSecondary: '#B8CBDC',
  textTertiary: '#7A93AC',
  textMuted: '#3E5068',

  // Accent — vivid cyan
  accent: '#2CB1BC',
  accentLight: 'rgba(44, 177, 188, 0.12)',
  accentSoft: 'rgba(44, 177, 188, 0.18)',

  // Status dots
  statusIdle: '#627D98',
  statusRunning: '#2CB1BC',
  statusRunningBg: 'rgba(44, 177, 188, 0.12)',
  statusComplete: '#27AB83',
  statusCompleteBg: 'rgba(39, 171, 131, 0.12)',
  statusError: '#E12D39',
  statusErrorBg: 'rgba(225, 45, 57, 0.1)',
  statusDead: '#E12D39',
  statusPermission: '#F0B429',
  statusPermissionGlow: 'rgba(240, 180, 41, 0.45)',

  // Tab
  tabActive: '#1a1d24',
  tabActiveBorder: '#2a3040',
  tabInactive: 'transparent',
  tabHover: 'rgba(255, 255, 255, 0.05)',

  // User message bubble
  userBubble: '#1a1d24',
  userBubbleBorder: '#2a3040',
  userBubbleText: '#F0F4F8',

  // Tool card
  toolBg: '#1a1d24',
  toolBorder: '#2a3040',
  toolRunningBorder: 'rgba(44, 177, 188, 0.35)',
  toolRunningBg: 'rgba(44, 177, 188, 0.06)',

  // Timeline
  timelineLine: '#1f2933',
  timelineNode: 'rgba(44, 177, 188, 0.25)',
  timelineNodeActive: '#2CB1BC',

  // Scrollbar
  scrollThumb: 'rgba(255, 255, 255, 0.12)',
  scrollThumbHover: 'rgba(255, 255, 255, 0.22)',

  // Stop button
  stopBg: '#E12D39',
  stopHover: '#CF1124',

  // Send button
  sendBg: '#2CB1BC',
  sendHover: '#14919B',
  sendDisabled: 'rgba(44, 177, 188, 0.3)',

  // Popover
  popoverBg: '#14171d',
  popoverBorder: '#1f2933',
  popoverShadow: '0 8px 32px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.35)',

  // Code block
  codeBg: '#0b0d12',

  // Mic button
  micBg: '#1a1d24',
  micColor: '#9FB3C8',
  micDisabled: '#334E68',

  // Placeholder
  placeholder: '#627D98',

  // Disabled button color
  btnDisabled: '#334E68',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#F0F4F8',
  btnHoverBg: '#1a1d24',

  // Accent border variants
  accentBorder: 'rgba(44, 177, 188, 0.2)',
  accentBorderMedium: 'rgba(44, 177, 188, 0.35)',

  // Permission card (amber)
  permissionBorder: 'rgba(240, 180, 41, 0.35)',
  permissionShadow: '0 2px 12px rgba(240, 180, 41, 0.1)',
  permissionHeaderBg: 'rgba(240, 180, 41, 0.08)',
  permissionHeaderBorder: 'rgba(240, 180, 41, 0.15)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(39, 171, 131, 0.12)',
  permissionAllowHoverBg: 'rgba(39, 171, 131, 0.25)',
  permissionAllowBorder: 'rgba(39, 171, 131, 0.3)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(225, 45, 57, 0.1)',
  permissionDenyHoverBg: 'rgba(225, 45, 57, 0.2)',
  permissionDenyBorder: 'rgba(225, 45, 57, 0.25)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(225, 45, 57, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(225, 45, 57, 0.15)',
} as const

const lightColors = {
  // Container — clean white with subtle blue-grey tint
  containerBg: '#F5F7FA',
  containerBgCollapsed: '#F0F4F8',
  containerBorder: '#D9E2EC',
  containerShadow: '0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
  cardShadow: '0 4px 16px rgba(0,0,0,0.06), 0 0 1px rgba(10, 108, 116, 0.1)',
  cardShadowCollapsed: '0 2px 8px rgba(0,0,0,0.07)',

  // Surface layers
  surfacePrimary: '#E4E7EB',
  surfaceSecondary: '#D9E2EC',
  surfaceHover: 'rgba(0, 0, 0, 0.04)',
  surfaceActive: 'rgba(0, 0, 0, 0.07)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#D9E2EC',
  inputFocusBorder: 'rgba(10, 108, 116, 0.5)',
  inputPillBg: '#ffffff',

  // Text — blue grey hierarchy, high contrast
  textPrimary: '#102A43',
  textSecondary: '#486581',
  textTertiary: '#829AB1',
  textMuted: '#D9E2EC',

  // Accent — deeper cyan for light mode
  accent: '#0A6C74',
  accentLight: 'rgba(10, 108, 116, 0.08)',
  accentSoft: 'rgba(10, 108, 116, 0.12)',

  // Status dots
  statusIdle: '#829AB1',
  statusRunning: '#0A6C74',
  statusRunningBg: 'rgba(10, 108, 116, 0.1)',
  statusComplete: '#0C6B58',
  statusCompleteBg: 'rgba(12, 107, 88, 0.1)',
  statusError: '#AB091E',
  statusErrorBg: 'rgba(171, 9, 30, 0.06)',
  statusDead: '#AB091E',
  statusPermission: '#CB6E17',
  statusPermissionGlow: 'rgba(203, 110, 23, 0.3)',

  // Tab
  tabActive: '#E4E7EB',
  tabActiveBorder: '#D9E2EC',
  tabInactive: 'transparent',
  tabHover: 'rgba(0, 0, 0, 0.04)',

  // User message bubble
  userBubble: '#E4E7EB',
  userBubbleBorder: '#D9E2EC',
  userBubbleText: '#102A43',

  // Tool card
  toolBg: '#E4E7EB',
  toolBorder: '#D9E2EC',
  toolRunningBorder: 'rgba(10, 108, 116, 0.3)',
  toolRunningBg: 'rgba(10, 108, 116, 0.05)',

  // Timeline
  timelineLine: '#D9E2EC',
  timelineNode: 'rgba(10, 108, 116, 0.2)',
  timelineNodeActive: '#0A6C74',

  // Scrollbar
  scrollThumb: 'rgba(0, 0, 0, 0.1)',
  scrollThumbHover: 'rgba(0, 0, 0, 0.18)',

  // Stop button
  stopBg: '#E12D39',
  stopHover: '#CF1124',

  // Send button
  sendBg: '#0A6C74',
  sendHover: '#044E54',
  sendDisabled: 'rgba(10, 108, 116, 0.3)',

  // Popover
  popoverBg: '#F5F7FA',
  popoverBorder: '#D9E2EC',
  popoverShadow: '0 8px 32px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',

  // Code block
  codeBg: '#E4E7EB',

  // Mic button
  micBg: '#E4E7EB',
  micColor: '#486581',
  micDisabled: '#BCCCDC',

  // Placeholder
  placeholder: '#829AB1',

  // Disabled button color
  btnDisabled: '#BCCCDC',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#102A43',
  btnHoverBg: '#E4E7EB',

  // Accent border variants
  accentBorder: 'rgba(10, 108, 116, 0.15)',
  accentBorderMedium: 'rgba(10, 108, 116, 0.25)',

  // Permission card (amber)
  permissionBorder: 'rgba(203, 110, 23, 0.3)',
  permissionShadow: '0 2px 12px rgba(203, 110, 23, 0.08)',
  permissionHeaderBg: 'rgba(203, 110, 23, 0.06)',
  permissionHeaderBorder: 'rgba(203, 110, 23, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(12, 107, 88, 0.1)',
  permissionAllowHoverBg: 'rgba(12, 107, 88, 0.22)',
  permissionAllowBorder: 'rgba(12, 107, 88, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(171, 9, 30, 0.08)',
  permissionDenyHoverBg: 'rgba(171, 9, 30, 0.18)',
  permissionDenyBorder: 'rgba(171, 9, 30, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(171, 9, 30, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(171, 9, 30, 0.12)',
} as const

export type ColorPalette = { [K in keyof typeof darkColors]: string }

// ─── Theme store ───

export type ThemeMode = 'system' | 'light' | 'dark'
export type ScreenshotMode = 'fullscreen' | 'region'

interface ThemeState {
  isDark: boolean
  themeMode: ThemeMode
  soundEnabled: boolean
  expandedUI: boolean
  visibleInScreenShare: boolean
  screenshotMode: ScreenshotMode
  _systemIsDark: boolean
  setIsDark: (isDark: boolean) => void
  setThemeMode: (mode: ThemeMode) => void
  setSoundEnabled: (enabled: boolean) => void
  setExpandedUI: (expanded: boolean) => void
  setVisibleInScreenShare: (visible: boolean) => void
  setScreenshotMode: (mode: ScreenshotMode) => void
  setSystemTheme: (isDark: boolean) => void
}

/** Convert camelCase token name to --clui-kebab-case CSS custom property */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/** Sync all JS design tokens to CSS custom properties on :root */
function syncTokensToCss(tokens: ColorPalette): void {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(`--clui-${camelToKebab(key)}`, value)
  }
}

function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  syncTokensToCss(isDark ? darkColors : lightColors)
}

const SETTINGS_KEY = 'clui-settings'

function loadSettings(): { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; visibleInScreenShare: boolean; screenshotMode: ScreenshotMode } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        themeMode: ['light', 'dark'].includes(parsed.themeMode) ? parsed.themeMode : 'dark',
        soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : false,
        expandedUI: typeof parsed.expandedUI === 'boolean' ? parsed.expandedUI : false,
        visibleInScreenShare: typeof parsed.visibleInScreenShare === 'boolean' ? parsed.visibleInScreenShare : false,
        screenshotMode: ['fullscreen', 'region'].includes(parsed.screenshotMode) ? parsed.screenshotMode : 'region',
      }
    }
  } catch {}
  return { themeMode: 'dark', soundEnabled: false, expandedUI: false, visibleInScreenShare: false, screenshotMode: 'region' }
}

function saveSettings(s: { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; visibleInScreenShare: boolean; screenshotMode: ScreenshotMode }): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

// Always start in compact UI mode on launch, with screen sharing and notifications off.
const saved = { ...loadSettings(), expandedUI: false, visibleInScreenShare: false, soundEnabled: false }

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: saved.themeMode === 'dark' ? true : saved.themeMode === 'light' ? false : true,
  themeMode: saved.themeMode,
  soundEnabled: saved.soundEnabled,
  expandedUI: saved.expandedUI,
  visibleInScreenShare: saved.visibleInScreenShare,
  screenshotMode: saved.screenshotMode,
  _systemIsDark: true,
  setIsDark: (isDark) => {
    set({ isDark })
    applyTheme(isDark)
  },
  setThemeMode: (mode) => {
    const resolved = mode === 'system' ? get()._systemIsDark : mode === 'dark'
    set({ themeMode: mode, isDark: resolved })
    applyTheme(resolved)
    const s = get(); saveSettings({ themeMode: mode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, visibleInScreenShare: s.visibleInScreenShare, screenshotMode: s.screenshotMode })
  },
  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled })
    const s = get(); saveSettings({ themeMode: s.themeMode, soundEnabled: enabled, expandedUI: s.expandedUI, visibleInScreenShare: s.visibleInScreenShare, screenshotMode: s.screenshotMode })
  },
  setExpandedUI: (expanded) => {
    set({ expandedUI: expanded })
    const s = get(); saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: expanded, visibleInScreenShare: s.visibleInScreenShare, screenshotMode: s.screenshotMode })
  },
  setVisibleInScreenShare: (visible) => {
    set({ visibleInScreenShare: visible })
    const s = get(); saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, visibleInScreenShare: visible, screenshotMode: s.screenshotMode })
    window.clui?.setContentProtection(!visible)
  },
  setScreenshotMode: (mode) => {
    set({ screenshotMode: mode })
    const s = get(); saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, visibleInScreenShare: s.visibleInScreenShare, screenshotMode: mode })
  },
  setSystemTheme: (isDark) => {
    set({ _systemIsDark: isDark })
    // Only apply if following system
    if (get().themeMode === 'system') {
      set({ isDark })
      applyTheme(isDark)
    }
  },
}))

// Initialize CSS vars with saved theme
syncTokensToCss(saved.themeMode === 'light' ? lightColors : darkColors)

// Inject CSS transition rule so --clui-* color tokens animate smoothly on theme switch
;(() => {
  const s = document.createElement('style')
  s.textContent = `*, *::before, *::after { transition-property: background-color, border-color, color, box-shadow, fill, stroke, opacity; transition-duration: 0.32s; transition-timing-function: cubic-bezier(0.4, 0, 0.1, 1); }`
  document.head.appendChild(s)
})()

/** Reactive hook — returns the active color palette */
export function useColors(): ColorPalette {
  const isDark = useThemeStore((s) => s.isDark)
  return isDark ? darkColors : lightColors
}

/** Non-reactive getter — use outside React components */
export function getColors(isDark: boolean): ColorPalette {
  return isDark ? darkColors : lightColors
}

// ─── Backward compatibility ───
// Legacy static export — components being migrated should use useColors() instead
export const colors = darkColors

// ─── Spacing ───

export const spacing = {
  contentWidth: 460,
  containerRadius: 20,
  containerPadding: 12,
  tabHeight: 32,
  inputMinHeight: 44,
  inputMaxHeight: 160,
  conversationMaxHeight: 380,
  pillRadius: 9999,
  circleSize: 36,
  circleGap: 8,
} as const

// ─── Animation ───

export const motion = {
  spring: { type: 'spring' as const, stiffness: 500, damping: 30 },
  easeOut: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const },
  fadeIn: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.15 },
  },
} as const
