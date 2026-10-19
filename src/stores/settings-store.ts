import { create } from 'zustand'
import { settingsRepository } from '../data'
import { SETTING_KEYS } from '../data/setting-keys'
import { isValidCssColor } from '../utils/css'
import type { WeekStart } from '../utils/effective-date'
import type { FilterSettings } from '../utils/filter-match'
import { DEFAULT_THEMED_COLORS, THEME_COLOR_VARS, parseColorSettingKey } from '../models/theme-colors'
import type { ThemeColors, ThemedColors, ThemeName } from '../models/theme-colors'
import {
  DEFAULT_FOLLOWUP_INTERVAL,
  addFollowupInterval,
  formatFollowupInterval,
  parseFollowupInterval,
  type FollowupInterval,
} from '../utils/followup'
import {
  DEFAULT_URGENT_DUE_WITHIN_DAYS,
  formatUrgentDueWithinDays,
  parseUrgentDueWithinDays,
  type UrgentDueWithinDays,
} from '../utils/urgency'
import { DEFAULT_HOT_RULE, formatHotRule, normalizeHotRule, parseHotRule, type HotRule } from '../utils/hot'
import {
  DEFAULT_CHECKIN_OPEN_METHOD,
  DEFAULT_CHECKIN_TASK_SCOPE,
  formatCheckinTaskScope,
  isCheckinOpenMethod,
  parseCheckinTaskScope,
  type CheckinOpenMethod,
  type CheckinTaskScope,
} from '../utils/checkin-settings'
import type { ShortcutChord, ShortcutId, ShortcutOverrides } from '../models/keyboard-shortcut'
import {
  formatShortcutOverrides,
  readShortcutOverrides,
  shortcutRefusal,
  withShortcut,
} from '../utils/shortcut-bindings'
import type { EisenhowerPanes } from '../models/eisenhower-settings'
import {
  formatEisenhowerSource,
  formatPanesSetting,
  parseEisenhowerSource,
  pickPanes,
  readPanesSetting,
} from '../data/eisenhower-shape'
import { readFresh, trackWrite } from './store-helpers'
import { useUndoStore, type UndoEntry } from './undo-store'
import { registerModuleReset } from '../utils/module-reset'

export type ThemeMode = 'light' | 'dark' | 'system'

export type { ThemeColors, ThemedColors, ThemeName } from '../models/theme-colors'
export { DEFAULT_THEMED_COLORS } from '../models/theme-colors'

interface SettingsState {
  colors: ThemedColors
  themeMode: ThemeMode
  defaultStatusId: number | null
  quickStatusId: number | null
  seededAssignedStatusId: number | null
  completedRetentionDays: number | null // null = keep forever
  weekStartsOn: WeekStart
  /** Next follow-up for new tasks and after "Mark followed up" = today + this. */
  followupDefaultInterval: FollowupInterval
  /** "Due date makes a task urgent": days ahead (0 = today), null = off. */
  urgentDueWithinDays: UrgentDueWithinDays
  /** Hot rule: OR of lines, each an AND of markers (`utils/hot.ts`). */
  hotRule: HotRule
  /** How a check-in email opens in the mail app. */
  checkinOpenMethod: CheckinOpenMethod
  /**
   * Which open tasks a check-in covers, as stored. A `list` scope may name a
   * list that no longer exists: read it through `resolveCheckinTaskScope`.
   */
  checkinTaskScope: CheckinTaskScope
  /** The user's keyboard shortcut changes by binding id (the rest keep their defaults). */
  shortcutOverrides: ShortcutOverrides
  /**
   * The Eisenhower panes that differ from their defaults (every Eisenhower
   * tab and the dashboard section), in their stored form; `{}` = the four
   * default quadrants.
   */
  eisenhowerPanes: EisenhowerPanes
  /**
   * The saved list whose tasks the Eisenhower considers (every Eisenhower
   * tab and the dashboard section); `null` = all tasks. May name a list
   * that was deleted (the matrix says so).
   */
  eisenhowerListId: number | null

  load: () => Promise<void>
  setColor: (theme: ThemeName, key: keyof ThemeColors, value: string) => Promise<void>
  /** When `theme` is omitted, both bags reset; otherwise only the specified bag. */
  resetColors: (theme?: ThemeName) => Promise<void>
  setThemeMode: (mode: ThemeMode) => Promise<void>
  setDefaultStatusId: (id: number | null) => Promise<void>
  setCompletedRetentionDays: (days: number | null) => Promise<void>
  setWeekStartsOn: (day: WeekStart) => Promise<void>
  setFollowupDefaultInterval: (interval: FollowupInterval) => Promise<void>
  setUrgentDueWithinDays: (range: UrgentDueWithinDays) => Promise<void>
  /** Saves the rule normalized (empty lines dropped, duplicates collapsed); ignores a rule with no marker. */
  setHotRule: (rule: HotRule) => Promise<void>
  setCheckinOpenMethod: (method: CheckinOpenMethod) => Promise<void>
  setCheckinTaskScope: (scope: CheckinTaskScope) => Promise<void>
  /**
   * Gives `id` new keys. Resolves the reason when they are refused (a
   * reserved key, or another binding's — nothing is written), else null.
   */
  setShortcut: (id: ShortcutId, chord: ShortcutChord) => Promise<string | null>
  /** Puts `id` back on its default keys. */
  resetShortcut: (id: ShortcutId) => Promise<void>
  /** Puts every binding back on its default keys. */
  resetAllShortcuts: () => Promise<void>
  /**
   * Saves the Eisenhower panes at once (normalised; `{}` / `undefined` =
   * the defaults) as one undo step named `description`. Writes passing the
   * same `mergeKey` one after another (e.g. a pane name typed letter by
   * letter) stay one undo step.
   */
  setEisenhowerPanes: (panes: EisenhowerPanes | undefined, description: string, mergeKey?: string) => Promise<void>
  /** Saves the Eisenhower source at once (`null` = all tasks) as one undo step, with the undo snackbar. */
  setEisenhowerListId: (listDefinitionId: number | null, description: string) => Promise<void>
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

interface CustomizedColorKeys {
  dark: Set<string>
  light: Set<string>
}

/**
 * Apply only user-customized color overrides for the resolved theme as inline
 * styles. Non-customized colors fall through to the CSS theme (dark/light).
 * The `light` and `dark` overrides are stored separately and only the bag for
 * the resolved theme is written to the document — switching themes flips
 * which bag wins (see setThemeMode + setupMediaQueryListener).
 */
function applyThemeOverrides(
  customizedKeys: CustomizedColorKeys,
  themed: ThemedColors,
  resolvedTheme: ThemeName,
) {
  const root = document.documentElement
  const colors = themed[resolvedTheme]
  const bag = customizedKeys[resolvedTheme]
  for (const [key, varName] of Object.entries(THEME_COLOR_VARS)) {
    if (bag.has(key)) {
      root.style.setProperty(varName, colors[key as keyof ThemeColors])
    } else {
      root.style.removeProperty(varName)
    }
  }
  if (bag.has('accent')) {
    root.style.setProperty('--color-accent-dim', dimColor(colors.accent))
  } else {
    root.style.removeProperty('--color-accent-dim')
  }
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
    const handler = () => {
      applyThemeMode('system')
      // OS theme flipped under mode='system' — flip the override bag too.
      const state = useSettingsStore.getState()
      applyThemeOverrides(customizedColorKeys, state.colors, resolveTheme(state.themeMode))
    }
    mq.addEventListener('change', handler)
    mediaQueryCleanup = () => mq.removeEventListener('change', handler)
  }
}

/**
 * Stops following the OS theme and forgets the customised colour keys, for
 * tests that share one module instance (the store's state is reset
 * separately).
 */
export function resetSettingsModuleState(): void {
  mediaQueryCleanup?.()
  mediaQueryCleanup = null
  customizedColorKeys = { dark: new Set(), light: new Set() }
}
registerModuleReset(resetSettingsModuleState)

function isValidThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system'
}

function isValidRetentionDays(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 3650
}

function isValidWeekStart(n: unknown): n is WeekStart {
  return n === 0 || n === 1
}

/** Track which color keys have user-customized values in IndexedDB. Keyed by
 * theme so a "set in dark" override does not leak into light (and vice
 * versa); the bag for the resolved theme drives which inline styles are
 * written. */
let customizedColorKeys: CustomizedColorKeys = { dark: new Set(), light: new Set() }

/** The default panes (no pane customized). */
const NO_PANES: EisenhowerPanes = {}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  colors: {
    dark: { ...DEFAULT_THEMED_COLORS.dark },
    light: { ...DEFAULT_THEMED_COLORS.light },
  },
  themeMode: 'dark' as ThemeMode,
  defaultStatusId: null,
  quickStatusId: null,
  seededAssignedStatusId: null,
  completedRetentionDays: null,
  weekStartsOn: 1 as WeekStart,
  followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL,
  urgentDueWithinDays: DEFAULT_URGENT_DUE_WITHIN_DAYS,
  hotRule: DEFAULT_HOT_RULE,
  checkinOpenMethod: DEFAULT_CHECKIN_OPEN_METHOD,
  checkinTaskScope: DEFAULT_CHECKIN_TASK_SCOPE,
  shortcutOverrides: {},
  eisenhowerPanes: NO_PANES,
  eisenhowerListId: null,

  async load() {
    try {
      const rows = await readFresh(() => settingsRepository.getAll())
      const colors: ThemedColors = {
        dark: { ...DEFAULT_THEMED_COLORS.dark },
        light: { ...DEFAULT_THEMED_COLORS.light },
      }
      const customKeys: CustomizedColorKeys = { dark: new Set(), light: new Set() }
      let defaultStatusId: number | null = null
      let quickStatusId: number | null = null
      let seededAssignedStatusId: number | null = null
      let completedRetentionDays: number | null = null
      let themeMode: ThemeMode = 'dark'
      let weekStartsOn: WeekStart = 1
      let followupDefaultInterval: FollowupInterval = DEFAULT_FOLLOWUP_INTERVAL
      let urgentDueWithinDays: UrgentDueWithinDays = DEFAULT_URGENT_DUE_WITHIN_DAYS
      let hotRule: HotRule = DEFAULT_HOT_RULE
      let checkinOpenMethod: CheckinOpenMethod = DEFAULT_CHECKIN_OPEN_METHOD
      let checkinTaskScope: CheckinTaskScope = DEFAULT_CHECKIN_TASK_SCOPE
      let shortcutOverrides: ShortcutOverrides = {}
      let eisenhowerPanes: EisenhowerPanes = NO_PANES
      let eisenhowerListId: number | null = null
      for (const row of rows) {
        if (row.key.startsWith('color.')) {
          const color = parseColorSettingKey(row.key)
          if (color && isValidCssColor(row.value)) {
            colors[color.theme][color.name] = row.value
            customKeys[color.theme].add(color.name)
          }
        } else if (row.key === SETTING_KEYS.defaultStatusId) {
          defaultStatusId = row.value ? Number(row.value) : null
        } else if (row.key === SETTING_KEYS.quickStatusId) {
          quickStatusId = row.value ? Number(row.value) : null
        } else if (row.key === SETTING_KEYS.seededAssignedStatusId) {
          seededAssignedStatusId = row.value ? Number(row.value) : null
        } else if (row.key === SETTING_KEYS.completedRetentionDays) {
          const parsed = row.value ? Number(row.value) : null
          completedRetentionDays = parsed != null && isValidRetentionDays(parsed) ? parsed : null
        } else if (row.key === SETTING_KEYS.themeMode) {
          if (isValidThemeMode(row.value)) themeMode = row.value
        } else if (row.key === SETTING_KEYS.weekStartsOn) {
          const parsed = Number(row.value)
          if (isValidWeekStart(parsed)) weekStartsOn = parsed
        } else if (row.key === SETTING_KEYS.followupDefaultInterval) {
          followupDefaultInterval = parseFollowupInterval(row.value) ?? DEFAULT_FOLLOWUP_INTERVAL
        } else if (row.key === SETTING_KEYS.urgentDueWithinDays) {
          const parsed = parseUrgentDueWithinDays(row.value)
          urgentDueWithinDays = parsed === undefined ? DEFAULT_URGENT_DUE_WITHIN_DAYS : parsed
        } else if (row.key === SETTING_KEYS.hotRule) {
          hotRule = parseHotRule(row.value) ?? DEFAULT_HOT_RULE
        } else if (row.key === SETTING_KEYS.checkinOpenMethod) {
          if (isCheckinOpenMethod(row.value)) checkinOpenMethod = row.value
        } else if (row.key === SETTING_KEYS.checkinTaskScope) {
          checkinTaskScope = parseCheckinTaskScope(row.value) ?? DEFAULT_CHECKIN_TASK_SCOPE
        } else if (row.key === SETTING_KEYS.keyboardShortcuts) {
          shortcutOverrides = readShortcutOverrides(row.value).overrides
        } else if (row.key === SETTING_KEYS.eisenhowerPanes) {
          eisenhowerPanes = readPanesSetting(row.value).panes
        } else if (row.key === SETTING_KEYS.eisenhowerSource) {
          eisenhowerListId = parseEisenhowerSource(row.value) ?? null
        }
      }
      customizedColorKeys = customKeys
      set({ colors, defaultStatusId, quickStatusId, seededAssignedStatusId, completedRetentionDays, themeMode, weekStartsOn, followupDefaultInterval, urgentDueWithinDays, hotRule, checkinOpenMethod, checkinTaskScope, shortcutOverrides, eisenhowerPanes, eisenhowerListId })
      applyThemeMode(themeMode)
      setupMediaQueryListener(themeMode)
      applyThemeOverrides(customizedColorKeys, colors, resolveTheme(themeMode))
    } catch (e) {
      console.error('Failed to load settings:', e)
      // The page still gets a theme: the current (default) mode.
      applyThemeMode(get().themeMode)
    }
  },

  setColor(theme: ThemeName, key: keyof ThemeColors, value: string) {
    return trackWrite(async () => {
      if (!isValidCssColor(value)) return
      await settingsRepository.put(`color.${theme}.${key}`, value)
      customizedColorKeys[theme].add(key)
      const current = get().colors
      const colors: ThemedColors = {
        ...current,
        [theme]: { ...current[theme], [key]: value },
      }
      set({ colors })
      if (theme === resolveTheme(get().themeMode)) {
        applyThemeOverrides(customizedColorKeys, colors, theme)
      }
    })
  },

  resetColors(theme?: ThemeName) {
    return trackWrite(async () => {
      const targets: ReadonlyArray<ThemeName> = theme == null ? ['dark', 'light'] : [theme]
      for (const t of targets) {
        const keys = Object.keys(DEFAULT_THEMED_COLORS[t]).map((k) => `color.${t}.${k}`)
        await settingsRepository.bulkDelete(keys)
        customizedColorKeys[t] = new Set()
      }
      const current = get().colors
      const colors: ThemedColors = { ...current }
      for (const t of targets) colors[t] = { ...DEFAULT_THEMED_COLORS[t] }
      set({ colors })
      applyThemeOverrides(customizedColorKeys, colors, resolveTheme(get().themeMode))
    })
  },

  setThemeMode(mode: ThemeMode) {
    return trackWrite(async () => {
      await settingsRepository.put(SETTING_KEYS.themeMode, mode)
      set({ themeMode: mode })
      applyThemeMode(mode)
      setupMediaQueryListener(mode)
      // Switching mode flips which `colors[theme]` bag drives the inline
      // overrides — re-apply against the newly-resolved theme.
      applyThemeOverrides(customizedColorKeys, get().colors, resolveTheme(mode))
    })
  },

  setDefaultStatusId(id: number | null) {
    return trackWrite(async () => {
      if (id == null) {
        await settingsRepository.delete(SETTING_KEYS.defaultStatusId)
      } else {
        await settingsRepository.put(SETTING_KEYS.defaultStatusId, String(id))
      }
      set({ defaultStatusId: id })
    })
  },

  setWeekStartsOn(day: WeekStart) {
    return trackWrite(async () => {
      if (!isValidWeekStart(day)) return
      await settingsRepository.put(SETTING_KEYS.weekStartsOn, String(day))
      set({ weekStartsOn: day })
    })
  },

  setCompletedRetentionDays(days: number | null) {
    return trackWrite(async () => {
      if (days == null) {
        await settingsRepository.delete(SETTING_KEYS.completedRetentionDays)
      } else if (!isValidRetentionDays(days)) {
        return
      } else {
        await settingsRepository.put(SETTING_KEYS.completedRetentionDays, String(days))
      }
      set({ completedRetentionDays: days })
    })
  },

  setFollowupDefaultInterval(interval: FollowupInterval) {
    return trackWrite(async () => {
      const value = formatFollowupInterval(interval)
      if (!parseFollowupInterval(value)) return
      await settingsRepository.put(SETTING_KEYS.followupDefaultInterval, value)
      set({ followupDefaultInterval: { ...interval } })
    })
  },

  setUrgentDueWithinDays(range: UrgentDueWithinDays) {
    return trackWrite(async () => {
      const value = formatUrgentDueWithinDays(range)
      if (parseUrgentDueWithinDays(value) === undefined) return
      await settingsRepository.put(SETTING_KEYS.urgentDueWithinDays, value)
      set({ urgentDueWithinDays: range })
    })
  },

  setHotRule(rule: HotRule) {
    return trackWrite(async () => {
      const next = normalizeHotRule(rule)
      if (next.length === 0) return
      await settingsRepository.put(SETTING_KEYS.hotRule, formatHotRule(next))
      set({ hotRule: next })
    })
  },

  // The check-in choices are radios: the state is set before the write so a
  // controlled radio doesn't snap back while it is saved.
  setCheckinOpenMethod(method: CheckinOpenMethod) {
    return trackWrite(async () => {
      if (!isCheckinOpenMethod(method)) return
      const prev = get().checkinOpenMethod
      set({ checkinOpenMethod: method })
      try {
        await settingsRepository.put(SETTING_KEYS.checkinOpenMethod, method)
      } catch (e) {
        console.error('Failed to save the check-in open method:', e)
        set({ checkinOpenMethod: prev })
      }
    })
  },

  setCheckinTaskScope(scope: CheckinTaskScope) {
    return trackWrite(async () => {
      const value = formatCheckinTaskScope(scope)
      const parsed = parseCheckinTaskScope(value)
      if (!parsed) return
      const prev = get().checkinTaskScope
      set({ checkinTaskScope: parsed })
      try {
        await settingsRepository.put(SETTING_KEYS.checkinTaskScope, value)
      } catch (e) {
        console.error('Failed to save the check-in task scope:', e)
        set({ checkinTaskScope: prev })
      }
    })
  },

  async setShortcut(id: ShortcutId, chord: ShortcutChord) {
    const refusal = shortcutRefusal(id, chord, get().shortcutOverrides)
    if (refusal) return refusal
    await writeShortcuts(withShortcut(get().shortcutOverrides, id, chord))
    return null
  },

  resetShortcut(id: ShortcutId) {
    return writeShortcuts(withShortcut(get().shortcutOverrides, id, null))
  },

  resetAllShortcuts() {
    return writeShortcuts({})
  },

  setEisenhowerPanes(panes: EisenhowerPanes | undefined, description: string, mergeKey?: string) {
    const prev = get().eisenhowerPanes
    const next = pickPanes(panes ?? {}).panes
    if (formatPanesSetting(prev) === formatPanesSetting(next)) return Promise.resolve()
    recordPanesUndo(prev, next, description, mergeKey)
    return writeEisenhowerPanes(next)
  },

  setEisenhowerListId(listDefinitionId: number | null, description: string) {
    const prev = get().eisenhowerListId
    if (prev === listDefinitionId) return Promise.resolve()
    lastPanesUndo = null
    if (!useUndoStore.getState().isPerformingUndoRedo) {
      useUndoStore.getState().push({
        description,
        undo: () => writeEisenhowerListId(prev),
        redo: () => writeEisenhowerListId(listDefinitionId),
      }, true)
    }
    return writeEisenhowerListId(listDefinitionId)
  },
}))

/**
 * The newest pane write's undo entry and its merge key, so the next write
 * with the same key updates that entry instead of adding one (while the
 * entry is still the newest on the stack).
 */
let lastPanesUndo: { mergeKey: string; entry: UndoEntry; setNext: (panes: EisenhowerPanes) => void } | null = null
registerModuleReset(() => { lastPanesUndo = null })

/** Registers a pane write (`prev` -> `next`) as an undo step, merged into the last one with the same `mergeKey`. */
function recordPanesUndo(prev: EisenhowerPanes, next: EisenhowerPanes, description: string, mergeKey: string | undefined): void {
  const undo = useUndoStore.getState()
  if (undo.isPerformingUndoRedo) return
  const last = lastPanesUndo
  if (mergeKey !== undefined && last?.mergeKey === mergeKey && undo.undoStack.at(-1) === last.entry && undo.groupStartIndex == null) {
    last.setNext(next)
    return
  }
  let target = next
  const entry: UndoEntry = {
    description,
    undo: () => writeEisenhowerPanes(prev),
    redo: () => writeEisenhowerPanes(target),
  }
  undo.push(entry)
  lastPanesUndo = mergeKey === undefined ? null : { mergeKey, entry, setNext: (p) => { target = p } }
}

/**
 * Shows `panes` at once, then saves them (the row goes when every pane is
 * its default); a failed save puts the panes shown before back.
 */
function writeEisenhowerPanes(panes: EisenhowerPanes): Promise<void> {
  return trackWrite(async () => {
    const prev = useSettingsStore.getState().eisenhowerPanes
    useSettingsStore.setState({ eisenhowerPanes: panes })
    try {
      if (Object.keys(panes).length === 0) await settingsRepository.delete(SETTING_KEYS.eisenhowerPanes)
      else await settingsRepository.put(SETTING_KEYS.eisenhowerPanes, formatPanesSetting(panes))
    } catch (e) {
      console.error('Failed to save the Eisenhower panes:', e)
      useSettingsStore.setState({ eisenhowerPanes: prev })
    }
  })
}

/** Shows the Eisenhower source at once, then saves it (all tasks = no row); a failed save puts the one shown before back. */
function writeEisenhowerListId(listDefinitionId: number | null): Promise<void> {
  return trackWrite(async () => {
    const prev = useSettingsStore.getState().eisenhowerListId
    useSettingsStore.setState({ eisenhowerListId: listDefinitionId })
    try {
      if (listDefinitionId == null) await settingsRepository.delete(SETTING_KEYS.eisenhowerSource)
      else await settingsRepository.put(SETTING_KEYS.eisenhowerSource, formatEisenhowerSource(listDefinitionId))
    } catch (e) {
      console.error('Failed to save the Eisenhower source:', e)
      useSettingsStore.setState({ eisenhowerListId: prev })
    }
  })
}

/** Saves the keyboard shortcut overrides (the row goes when none are left), then shows them. */
function writeShortcuts(overrides: ShortcutOverrides): Promise<void> {
  return trackWrite(async () => {
    if (Object.keys(overrides).length === 0) {
      await settingsRepository.delete(SETTING_KEYS.keyboardShortcuts)
    } else {
      await settingsRepository.put(SETTING_KEYS.keyboardShortcuts, formatShortcutOverrides(overrides))
    }
    useSettingsStore.setState({ shortcutOverrides: overrides })
  })
}

/**
 * The settings filters are evaluated with (urgent range, Hot rule, week
 * start), as they are now. A memoized caller uses `useFilterSettings`
 * instead, so a settings change re-runs it.
 */
export function currentFilterSettings(): FilterSettings {
  const { urgentDueWithinDays, hotRule, weekStartsOn } = useSettingsStore.getState()
  return { urgentRange: urgentDueWithinDays, hotRule, weekStartsOn }
}

/**
 * The next follow-up a task gets when it is created (or followed up) at
 * `now`: the day `now` falls on + the Settings default interval.
 */
export function defaultNextFollowup(now: Date): Date {
  return addFollowupInterval(now, useSettingsStore.getState().followupDefaultInterval)
}
