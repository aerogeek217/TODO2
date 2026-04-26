import { create } from 'zustand'
import { settingsRepository } from '../data'
import { isValidCssColor } from '../utils/css'
import { parseHorizonSlots, resolveLegacySelectedHorizon } from '../utils/horizon-slots'
import type { WeekStart } from '../utils/effective-date'
import type { CanvasViewport } from './ui-store'
import type { RailsState } from '../models/canvas-rails'
import { parseRailsState, serializeRailsState } from '../models/canvas-rails'
import type { ProjectGroupBy } from '../models'
import { DEFAULT_CANVAS_MAX_EXTENT, isValidCanvasMaxExtent } from '../utils/canvas-bounds'

const PROJECT_GROUP_BY_VALUES = ['status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date'] as const

export function isValidProjectGroupBy(v: unknown): v is ProjectGroupBy {
  return typeof v === 'string' && (PROJECT_GROUP_BY_VALUES as readonly string[]).includes(v)
}

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
  /** Ordered list of `ListDefinition.id`s the horizons widget renders as rows.
   * Position in the array is the row's order; the defId is the row's identity. */
  horizonSlots: number[]
  /** Which horizon row is currently selected (drives the task list below the bars). */
  selectedHorizonDefId: number | null
  /** Persisted canvas rails layout (null = no persisted state). */
  canvasRails: RailsState | null
  /** Ceiling for tag registry size. `tag-store.add` throws when `tags.length`
   * reaches this value. Guards against runaway `#tag` creation from NLP input.
   */
  maxTags: number
  /** Default groupBy seeded on every new project. `null` = no grouping. */
  defaultProjectGroupBy: ProjectGroupBy | null
  /** Half-side of the persisted-position bounding box. Every drag / cascade /
   * spawn site clamps to ±N before writing to a repository so widgets cannot
   * drift off-canvas. Configurable via SettingsPage. */
  canvasMaxExtent: number

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
  /** Append a list-def id (or insert at `atIndex` when provided). */
  addHorizon: (defId: number, atIndex?: number) => Promise<void>
  /** Remove the row at `atIndex`. Selected def falls back to the new first entry (or null when empty). */
  removeHorizon: (atIndex: number) => Promise<void>
  reorderHorizons: (fromIndex: number, toIndex: number) => Promise<void>
  /** Replace the def at `atIndex`. No-op when out of range. */
  setHorizonAt: (atIndex: number, defId: number) => Promise<void>
  setSelectedHorizonDefId: (defId: number | null) => Promise<void>
  setCanvasRails: (rails: RailsState) => void
  setDefaultProjectGroupBy: (groupBy: ProjectGroupBy | null) => Promise<void>
  setCanvasMaxExtent: (n: number) => Promise<void>
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
  horizonSlots: [] as number[],
  selectedHorizonDefId: null as number | null,
  canvasRails: null,
  maxTags: DEFAULT_MAX_TAGS,
  defaultProjectGroupBy: 'tag' as ProjectGroupBy,
  canvasMaxExtent: DEFAULT_CANVAS_MAX_EXTENT,

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
      let horizonSlots: number[] = []
      let selectedHorizonDefId: number | null = null
      let legacySelectedHorizon: string | null = null
      let legacyHorizonSlotsValue: string | null = null
      let canvasRails: RailsState | null = null
      let maxTags: number = DEFAULT_MAX_TAGS
      let defaultProjectGroupBy: ProjectGroupBy | null = 'tag'
      let canvasMaxExtent: number = DEFAULT_CANVAS_MAX_EXTENT
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
          legacyHorizonSlotsValue = row.value
        } else if (row.key === 'selectedHorizonDefId') {
          if (row.value === '' || row.value == null) selectedHorizonDefId = null
          else {
            const n = Number(row.value)
            if (Number.isFinite(n)) selectedHorizonDefId = n
          }
        } else if (row.key === 'selectedHorizon') {
          // Legacy key — resolved against legacy `horizonSlots` map below.
          legacySelectedHorizon = row.value
        } else if (row.key === 'canvasRails') {
          canvasRails = parseRailsState(row.value)
        } else if (row.key === 'maxTags') {
          const parsed = Number(row.value)
          if (Number.isInteger(parsed) && parsed > 0) maxTags = parsed
        } else if (row.key === 'defaultProjectGroupBy') {
          if (row.value === '') defaultProjectGroupBy = null
          else if (isValidProjectGroupBy(row.value)) defaultProjectGroupBy = row.value
        } else if (row.key === 'canvasMaxExtent') {
          const parsed = Number(row.value)
          if (isValidCanvasMaxExtent(parsed)) canvasMaxExtent = parsed
        }
      }
      customizedColorKeys = customKeys
      if (quickStatusId == null && seededFollowupStatusId != null) quickStatusId = seededFollowupStatusId
      // Resolve legacy `selectedHorizon` (HorizonKey string) → defId via the
      // legacy map row. Only consulted when the new `selectedHorizonDefId`
      // setting is unset; the new key wins as soon as the user makes any
      // selection. Falls back to the first horizonSlots entry when neither
      // is set.
      if (selectedHorizonDefId == null) {
        const legacyResolved = resolveLegacySelectedHorizon(legacySelectedHorizon, legacyHorizonSlotsValue)
        if (legacyResolved != null && horizonSlots.includes(legacyResolved)) {
          selectedHorizonDefId = legacyResolved
        } else if (horizonSlots.length > 0) {
          selectedHorizonDefId = horizonSlots[0] ?? null
        }
      }
      // Strip dormant Dashboard-era keys (`dashboardUserLists`,
      // `notesPinnedToDashboard`, `dashboardTopOrder`) and the older
      // `notesDock` / `notesVisible` legacy rows so they don't accumulate
      // forever in IndexedDB. The store surface for these was retired in
      // code-review-2026-04-25 P8. `horizonCollapsed` is dropped here too
      // (P6 retired the per-key collapse state — flexible-slot model has
      // no analogue). Legacy `selectedHorizon` is retained until the user
      // makes a selection (then `setSelectedHorizonDefId` writes the new
      // key); stripping eagerly would lose the resolved selection on the
      // following load if no other horizon mutation has happened.
      await settingsRepository.bulkDelete([
        'dashboardUserLists',
        'notesPinnedToDashboard',
        'dashboardTopOrder',
        'notesDock',
        'notesVisible',
        'horizonCollapsed',
      ])
      set({ colors, defaultProjectId, defaultStatusId, quickStatusId, seededAssignedStatusId, seededFollowupStatusId, completedRetentionDays, themeMode, weekStartsOn, canvasViewport, horizonSlots, selectedHorizonDefId, canvasRails, maxTags, defaultProjectGroupBy, canvasMaxExtent })
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

  async addHorizon(defId: number, atIndex?: number) {
    if (!Number.isFinite(defId)) return
    const current = get().horizonSlots
    const insertAt = atIndex == null ? current.length : Math.max(0, Math.min(atIndex, current.length))
    const next = [...current.slice(0, insertAt), defId, ...current.slice(insertAt)]
    await settingsRepository.put('horizonSlots', JSON.stringify(next))
    let nextSelected = get().selectedHorizonDefId
    if (nextSelected == null) {
      nextSelected = next[0] ?? null
      await settingsRepository.put('selectedHorizonDefId', nextSelected == null ? '' : String(nextSelected))
    }
    set({ horizonSlots: next, selectedHorizonDefId: nextSelected })
  },

  async removeHorizon(atIndex: number) {
    const current = get().horizonSlots
    if (atIndex < 0 || atIndex >= current.length) return
    const removed = current[atIndex]
    const next = [...current.slice(0, atIndex), ...current.slice(atIndex + 1)]
    await settingsRepository.put('horizonSlots', JSON.stringify(next))
    let nextSelected = get().selectedHorizonDefId
    if (removed != null && nextSelected === removed) {
      nextSelected = next[0] ?? null
      await settingsRepository.put('selectedHorizonDefId', nextSelected == null ? '' : String(nextSelected))
    }
    set({ horizonSlots: next, selectedHorizonDefId: nextSelected })
  },

  async reorderHorizons(fromIndex: number, toIndex: number) {
    const current = get().horizonSlots
    if (fromIndex < 0 || fromIndex >= current.length) return
    if (toIndex < 0 || toIndex >= current.length) return
    if (fromIndex === toIndex) return
    const next = [...current]
    const [moved] = next.splice(fromIndex, 1)
    if (moved == null) return
    next.splice(toIndex, 0, moved)
    await settingsRepository.put('horizonSlots', JSON.stringify(next))
    set({ horizonSlots: next })
  },

  async setHorizonAt(atIndex: number, defId: number) {
    const current = get().horizonSlots
    if (atIndex < 0 || atIndex >= current.length) return
    if (!Number.isFinite(defId)) return
    const prev = current[atIndex]
    const next = [...current]
    next[atIndex] = defId
    await settingsRepository.put('horizonSlots', JSON.stringify(next))
    let nextSelected = get().selectedHorizonDefId
    if (prev != null && nextSelected === prev) {
      nextSelected = defId
      await settingsRepository.put('selectedHorizonDefId', String(nextSelected))
    }
    set({ horizonSlots: next, selectedHorizonDefId: nextSelected })
  },

  async setSelectedHorizonDefId(defId: number | null) {
    if (defId != null && !Number.isFinite(defId)) return
    await settingsRepository.put('selectedHorizonDefId', defId == null ? '' : String(defId))
    set({ selectedHorizonDefId: defId })
  },

  async setDefaultProjectGroupBy(groupBy: ProjectGroupBy | null) {
    if (groupBy != null && !isValidProjectGroupBy(groupBy)) return
    await settingsRepository.put('defaultProjectGroupBy', groupBy ?? '')
    set({ defaultProjectGroupBy: groupBy })
  },

  async setCanvasMaxExtent(n: number) {
    if (!isValidCanvasMaxExtent(n)) return
    await settingsRepository.put('canvasMaxExtent', String(n))
    set({ canvasMaxExtent: n })
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
