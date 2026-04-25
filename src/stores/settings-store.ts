import { create } from 'zustand'
import { settingsRepository } from '../data'
import { isValidCssColor } from '../utils/css'
import { parseHorizonSlots } from '../utils/horizon-slots'
import type { WeekStart } from '../utils/effective-date'
import { HORIZON_KEYS, type HorizonKey } from '../services/horizons'
import type { CanvasViewport } from './ui-store'
import type { RailsState } from '../models/canvas-rails'
import { parseRailsState, serializeRailsState } from '../models/canvas-rails'

export type ThemeMode = 'light' | 'dark' | 'system'

/** Default ceiling for the tag registry. No Settings UI exposes this yet;
 * override by writing a `maxTags` row to the settings repo. */
const DEFAULT_MAX_TAGS = 500

export interface ThemeColors {
  accent: string
  canvasBg: string
  surface: string
  danger: string
  warning: string
  star: string
  scheduled: string
  deadline: string
}

const defaultColors: ThemeColors = {
  accent: '#a2cfcb',
  canvasBg: '#0e0e0e',
  surface: '#191a1a',
  danger: '#ee7d77',
  warning: '#f5a623',
  star: '#f5c842',
  scheduled: '#7ec4bc',
  deadline: '#e86bf0',
}

interface SettingsState {
  colors: ThemeColors
  themeMode: ThemeMode
  defaultProjectId: number | null
  defaultStatusId: number | null
  quickStatusId: number | null
  seededAssignedStatusId: number | null
  seededFollowupStatusId: number | null
  completedRetentionDays: number | null // null = keep forever
  weekStartsOn: WeekStart
  canvasViewport: CanvasViewport | null
  /** HorizonKey → `ListDefinition.id` the ribbon cell renders. */
  horizonSlots: Partial<Record<HorizonKey, number>>
  /** Which horizon cell is currently selected (drives the hero card). */
  selectedHorizon: HorizonKey
  /** Per-horizon collapse toggle (Phase 5 wires the UI). */
  horizonCollapsed: Partial<Record<HorizonKey, boolean>>
  /** Persisted canvas rails layout (null = no persisted state). */
  canvasRails: RailsState | null
  /** Ceiling for tag registry size. `tag-store.add` throws when `tags.length`
   * reaches this value. Guards against runaway `#tag` creation from NLP input.
   */
  maxTags: number

  load: () => Promise<void>
  setColor: (key: keyof ThemeColors, value: string) => Promise<void>
  resetColors: () => Promise<void>
  setThemeMode: (mode: ThemeMode) => Promise<void>
  setDefaultProjectId: (id: number | null) => Promise<void>
  setDefaultStatusId: (id: number | null) => Promise<void>
  setQuickStatusId: (id: number | null) => Promise<void>
  setCompletedRetentionDays: (days: number | null) => Promise<void>
  setWeekStartsOn: (day: WeekStart) => Promise<void>
  setCanvasViewport: (vp: CanvasViewport) => void
  setHorizonSlot: (key: HorizonKey, listDefinitionId: number | null) => Promise<void>
  setSelectedHorizon: (key: HorizonKey) => Promise<void>
  setHorizonCollapsed: (key: HorizonKey, collapsed: boolean) => Promise<void>
  setCanvasRails: (rails: RailsState) => void
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
  danger: '--color-danger',
  warning: '--color-warning',
  star: '--color-followup',
  scheduled: '--color-scheduled',
  deadline: '--color-deadline',
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

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
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

function isValidWeekStart(n: unknown): n is WeekStart {
  return n === 0 || n === 1
}

function isValidHorizonKey(v: unknown): v is HorizonKey {
  return typeof v === 'string' && (HORIZON_KEYS as readonly string[]).includes(v)
}

function parseHorizonCollapsed(value: string | undefined | null): Partial<Record<HorizonKey, boolean>> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<HorizonKey, boolean>> = {}
    for (const key of HORIZON_KEYS) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'boolean') out[key] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Track which color keys have user-customized values in IndexedDB */
let customizedColorKeys = new Set<string>()

/**
 * Build a twin-debounced setter for high-frequency settings writes (viewport,
 * rails). The inner set is debounced at `setMs`; the repo persist is debounced
 * at the longer `persistMs`. Collapses React Flow's ~60/sec onViewportChange
 * and rapid slot operations to a handful of Zustand set() + one repo.put.
 */
function createDebouncedPersist<T>(opts: {
  setMs: number
  persistMs: number
  apply: (value: T) => void
  persist: (value: T) => void
}): (value: T) => void {
  let setTimer: ReturnType<typeof setTimeout> | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  return (value: T) => {
    if (setTimer) clearTimeout(setTimer)
    setTimer = setTimeout(() => {
      opts.apply(value)
      setTimer = undefined
    }, opts.setMs)
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => opts.persist(value), opts.persistMs)
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  colors: { ...defaultColors },
  themeMode: 'dark' as ThemeMode,
  defaultProjectId: null,
  defaultStatusId: null,
  quickStatusId: null,
  seededAssignedStatusId: null,
  seededFollowupStatusId: null,
  completedRetentionDays: null,
  weekStartsOn: 1 as WeekStart,
  canvasViewport: null,
  horizonSlots: {},
  selectedHorizon: 'thisweek' as HorizonKey,
  horizonCollapsed: {},
  canvasRails: null,
  maxTags: DEFAULT_MAX_TAGS,

  async load() {
    try {
      const rows = await settingsRepository.getAll()
      const colors = { ...defaultColors }
      const customKeys = new Set<string>()
      let defaultProjectId: number | null = null
      let defaultStatusId: number | null = null
      let quickStatusId: number | null = null
      let seededAssignedStatusId: number | null = null
      let seededFollowupStatusId: number | null = null
      let completedRetentionDays: number | null = null
      let themeMode: ThemeMode = 'dark'
      let weekStartsOn: WeekStart = 1
      let canvasViewport: CanvasViewport | null = null
      let horizonSlots: Partial<Record<HorizonKey, number>> = {}
      let selectedHorizon: HorizonKey = 'thisweek'
      let horizonCollapsed: Partial<Record<HorizonKey, boolean>> = {}
      let canvasRails: RailsState | null = null
      let maxTags: number = DEFAULT_MAX_TAGS
      for (const row of rows) {
        if (row.key.startsWith('color.')) {
          const colorKey = row.key.replace('color.', '') as keyof ThemeColors
          if (colorKey in colors && isValidCssColor(row.value)) {
            colors[colorKey] = row.value
            customKeys.add(colorKey)
          }
        } else if (row.key === 'defaultProjectId') {
          defaultProjectId = row.value ? Number(row.value) : null
        } else if (row.key === 'defaultStatusId') {
          defaultStatusId = row.value ? Number(row.value) : null
        } else if (row.key === 'quickStatusId') {
          quickStatusId = row.value ? Number(row.value) : null
        } else if (row.key === 'seededAssignedStatusId') {
          seededAssignedStatusId = row.value ? Number(row.value) : null
        } else if (row.key === 'seededFollowupStatusId') {
          seededFollowupStatusId = row.value ? Number(row.value) : null
        } else if (row.key === 'completedRetentionDays') {
          const parsed = row.value ? Number(row.value) : null
          completedRetentionDays = parsed != null && isValidRetentionDays(parsed) ? parsed : null
        } else if (row.key === 'themeMode') {
          if (isValidThemeMode(row.value)) themeMode = row.value
        } else if (row.key === 'weekStartsOn') {
          const parsed = Number(row.value)
          if (isValidWeekStart(parsed)) weekStartsOn = parsed
        } else if (row.key === 'canvasViewport') {
          try {
            const parsed = JSON.parse(row.value)
            if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) && Number.isFinite(parsed.zoom)) {
              canvasViewport = { x: parsed.x, y: parsed.y, zoom: parsed.zoom }
            }
          } catch { /* ignore invalid JSON */ }
        } else if (row.key === 'horizonSlots') {
          horizonSlots = parseHorizonSlots(row.value)
        } else if (row.key === 'selectedHorizon') {
          if (isValidHorizonKey(row.value)) selectedHorizon = row.value
        } else if (row.key === 'horizonCollapsed') {
          horizonCollapsed = parseHorizonCollapsed(row.value)
        } else if (row.key === 'canvasRails') {
          canvasRails = parseRailsState(row.value)
        } else if (row.key === 'maxTags') {
          const parsed = Number(row.value)
          if (Number.isInteger(parsed) && parsed > 0) maxTags = parsed
        }
      }
      customizedColorKeys = customKeys
      if (quickStatusId == null && seededFollowupStatusId != null) quickStatusId = seededFollowupStatusId
      // Strip dormant Dashboard-era keys (`dashboardUserLists`,
      // `notesPinnedToDashboard`) and the older `notesDock` / `notesVisible`
      // legacy rows so they don't accumulate forever in IndexedDB. The store
      // surface for these was retired in code-review-2026-04-25 P8.
      await settingsRepository.bulkDelete([
        'dashboardUserLists',
        'notesPinnedToDashboard',
        'notesDock',
        'notesVisible',
      ])
      set({ colors, defaultProjectId, defaultStatusId, quickStatusId, seededAssignedStatusId, seededFollowupStatusId, completedRetentionDays, themeMode, weekStartsOn, canvasViewport, horizonSlots, selectedHorizon, horizonCollapsed, canvasRails, maxTags })
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

  async setDefaultStatusId(id: number | null) {
    if (id == null) {
      await settingsRepository.delete('defaultStatusId')
    } else {
      await settingsRepository.put('defaultStatusId', String(id))
    }
    set({ defaultStatusId: id })
  },

  async setQuickStatusId(id: number | null) {
    if (id == null) {
      await settingsRepository.delete('quickStatusId')
    } else {
      await settingsRepository.put('quickStatusId', String(id))
    }
    set({ quickStatusId: id })
  },

  async setWeekStartsOn(day: WeekStart) {
    if (!isValidWeekStart(day)) return
    await settingsRepository.put('weekStartsOn', String(day))
    set({ weekStartsOn: day })
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

  async setHorizonSlot(key: HorizonKey, listDefinitionId: number | null) {
    const next = { ...get().horizonSlots }
    if (listDefinitionId == null) delete next[key]
    else next[key] = listDefinitionId
    await settingsRepository.put('horizonSlots', JSON.stringify(next))
    set({ horizonSlots: next })
  },

  async setSelectedHorizon(key: HorizonKey) {
    if (!isValidHorizonKey(key)) return
    await settingsRepository.put('selectedHorizon', key)
    set({ selectedHorizon: key })
  },

  async setHorizonCollapsed(key: HorizonKey, collapsed: boolean) {
    const next = { ...get().horizonCollapsed }
    if (collapsed) next[key] = true
    else delete next[key]
    await settingsRepository.put('horizonCollapsed', JSON.stringify(next))
    set({ horizonCollapsed: next })
  },

  setCanvasRails: createDebouncedPersist<RailsState>({
    setMs: 150,
    persistMs: 500,
    apply: (rails) => set({ canvasRails: rails }),
    persist: (rails) => { settingsRepository.put('canvasRails', serializeRailsState(rails)) },
  }),

  // React Flow fires onViewportChange ~60/sec during pan/zoom; subscribers
  // (CanvasView) re-render on every set(), which is wasteful since the value
  // is only read as defaultViewport on mount. 150ms trailing debounce collapses
  // the re-render storm to a handful while keeping getState() callers
  // (App.createFloatingNote, FilteredListPopup) close to current — the viewport
  // has almost always settled before these fire.
  setCanvasViewport: createDebouncedPersist<CanvasViewport>({
    setMs: 150,
    persistMs: 500,
    apply: (vp) => set({ canvasViewport: vp }),
    persist: (vp) => { settingsRepository.put('canvasViewport', JSON.stringify(vp)) },
  }),
}))
