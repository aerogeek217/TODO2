import { create } from 'zustand'
import { settingsRepository } from '../data'
import { isValidCssColor } from '../data/import-validation'
import type { CanvasViewport } from './ui-store'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeColors {
  accent: string
  canvasBg: string
  surface: string
  priorityHigh: string
  priorityMedium: string
  star: string
}

const defaultColors: ThemeColors = {
  accent: '#a2cfcb',
  canvasBg: '#0e0e0e',
  surface: '#191a1a',
  priorityHigh: '#ee7d77',
  priorityMedium: '#f5a623',
  star: '#f5c842',
}

interface SettingsState {
  colors: ThemeColors
  themeMode: ThemeMode
  defaultProjectId: number | null
  completedRetentionDays: number | null // null = keep forever
  canvasViewport: CanvasViewport | null

  load: () => Promise<void>
  setColor: (key: keyof ThemeColors, value: string) => Promise<void>
  resetColors: () => Promise<void>
  setThemeMode: (mode: ThemeMode) => Promise<void>
  setDefaultProjectId: (id: number | null) => Promise<void>
  setCompletedRetentionDays: (days: number | null) => Promise<void>
  setCanvasViewport: (vp: CanvasViewport) => void
}

function expandHex(hex: string): string {
  // Expand 3-digit hex (#abc) to 6-digit (#aabbcc)
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function dimColor(hex: string): string {
  const expanded = expandHex(hex)
  if (expanded.length !== 7) return hex // guard against unexpected lengths
  const r = parseInt(expanded.slice(1, 3), 16)
  const g = parseInt(expanded.slice(3, 5), 16)
  const b = parseInt(expanded.slice(5, 7), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex
  const f = 0.55
  const dr = Math.round(r * f)
  const dg = Math.round(g * f)
  const db = Math.round(b * f)
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`
}

/** CSS variable name for each ThemeColors key */
const colorVarMap: Record<keyof ThemeColors, string> = {
  accent: '--color-accent',
  canvasBg: '--color-canvas-bg',
  surface: '--color-surface',
  priorityHigh: '--color-priority-high',
  priorityMedium: '--color-priority-medium',
  star: '--color-star',
}

/**
 * Apply only user-customized color overrides as inline styles.
 * Non-customized colors fall through to the CSS theme (dark/light).
 */
function applyThemeOverrides(customizedKeys: Set<string>, colors: ThemeColors) {
  const root = document.documentElement
  for (const [key, varName] of Object.entries(colorVarMap)) {
    if (customizedKeys.has(key)) {
      root.style.setProperty(varName, colors[key as keyof ThemeColors])
    } else {
      root.style.removeProperty(varName)
    }
  }
  if (customizedKeys.has('accent')) {
    root.style.setProperty('--color-accent-dim', dimColor(colors.accent))
  } else {
    root.style.removeProperty('--color-accent-dim')
  }
}

function clearAllThemeOverrides() {
  const root = document.documentElement
  for (const varName of Object.values(colorVarMap)) {
    root.style.removeProperty(varName)
  }
  root.style.removeProperty('--color-accent-dim')
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyThemeMode(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  document.documentElement.setAttribute('data-theme', resolved)
}

let mediaQueryCleanup: (() => void) | null = null

function setupMediaQueryListener(mode: ThemeMode) {
  if (mediaQueryCleanup) {
    mediaQueryCleanup()
    mediaQueryCleanup = null
  }
  if (mode === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyThemeMode('system')
    mq.addEventListener('change', handler)
    mediaQueryCleanup = () => mq.removeEventListener('change', handler)
  }
}

function isValidThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system'
}

function isValidRetentionDays(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 3650
}

/** Track which color keys have user-customized values in IndexedDB */
let customizedColorKeys = new Set<string>()
let vpDebounceTimer: ReturnType<typeof setTimeout> | undefined

export const useSettingsStore = create<SettingsState>((set, get) => ({
  colors: { ...defaultColors },
  themeMode: 'dark' as ThemeMode,
  defaultProjectId: null,
  completedRetentionDays: null,
  canvasViewport: null,

  async load() {
    try {
      const rows = await settingsRepository.getAll()
      const colors = { ...defaultColors }
      const customKeys = new Set<string>()
      let defaultProjectId: number | null = null
      let completedRetentionDays: number | null = null
      let themeMode: ThemeMode = 'dark'
      let canvasViewport: CanvasViewport | null = null
      for (const row of rows) {
        if (row.key.startsWith('color.')) {
          const colorKey = row.key.replace('color.', '') as keyof ThemeColors
          if (colorKey in colors && isValidCssColor(row.value)) {
            colors[colorKey] = row.value
            customKeys.add(colorKey)
          }
        } else if (row.key === 'defaultProjectId') {
          defaultProjectId = row.value ? Number(row.value) : null
        } else if (row.key === 'completedRetentionDays') {
          const parsed = row.value ? Number(row.value) : null
          completedRetentionDays = parsed != null && isValidRetentionDays(parsed) ? parsed : null
        } else if (row.key === 'themeMode') {
          if (isValidThemeMode(row.value)) themeMode = row.value
        } else if (row.key === 'canvasViewport') {
          try {
            const parsed = JSON.parse(row.value)
            if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.zoom === 'number') {
              canvasViewport = parsed
            }
          } catch { /* ignore invalid JSON */ }
        }
      }
      customizedColorKeys = customKeys
      set({ colors, defaultProjectId, completedRetentionDays, themeMode, canvasViewport })
      applyThemeMode(themeMode)
      setupMediaQueryListener(themeMode)
      applyThemeOverrides(customizedColorKeys, colors)
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  },

  async setColor(key: keyof ThemeColors, value: string) {
    if (!isValidCssColor(value)) return
    await settingsRepository.put(`color.${key}`, value)
    customizedColorKeys.add(key)
    const colors = { ...get().colors, [key]: value }
    set({ colors })
    applyThemeOverrides(customizedColorKeys, colors)
  },

  async resetColors() {
    const keys = Object.keys(defaultColors).map((k) => `color.${k}`)
    await settingsRepository.bulkDelete(keys)
    customizedColorKeys = new Set()
    set({ colors: { ...defaultColors } })
    clearAllThemeOverrides()
  },

  async setThemeMode(mode: ThemeMode) {
    await settingsRepository.put('themeMode', mode)
    set({ themeMode: mode })
    applyThemeMode(mode)
    setupMediaQueryListener(mode)
  },

  async setDefaultProjectId(id: number | null) {
    if (id == null) {
      await settingsRepository.delete('defaultProjectId')
    } else {
      await settingsRepository.put('defaultProjectId', String(id))
    }
    set({ defaultProjectId: id })
  },

  async setCompletedRetentionDays(days: number | null) {
    if (days == null) {
      await settingsRepository.delete('completedRetentionDays')
    } else if (!isValidRetentionDays(days)) {
      return
    } else {
      await settingsRepository.put('completedRetentionDays', String(days))
    }
    set({ completedRetentionDays: days })
  },

  setCanvasViewport(vp: CanvasViewport) {
    set({ canvasViewport: vp })
    if (vpDebounceTimer) clearTimeout(vpDebounceTimer)
    vpDebounceTimer = setTimeout(() => {
      settingsRepository.put('canvasViewport', JSON.stringify(vp))
    }, 500)
  },
}))
