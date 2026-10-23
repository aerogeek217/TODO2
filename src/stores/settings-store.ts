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
  checkinFilterOf,
  checkinFiltersEqual,
  isCheckinOpenMethod,
  isNoCheckinFilter,
  type CheckinOpenMethod,
  type CheckinTaskFilter,
} from '../utils/checkin-settings'
import { emptyPredicate } from '../models/filter-predicate'
import { GROUP_LABEL, sortSummary } from '../utils/list-options'
import {
  effectiveSortDirection,
  isTodoGroupBy,
  isTodoSortBy,
  sortHasDirection,
  type TodoGroupBy,
  type TodoSortBy,
  type TodoSortDirection,
} from '../models/todo-sort-group'
import {
  DEFAULT_PURGE_PROMPT_INTERVAL_DAYS,
  isPurgePromptIntervalDays,
  parsePurgePromptIntervalDays,
} from '../utils/completed-at'
import { formatCheckinFilterSetting, readCheckinFilterSetting } from '../data/checkin-filter-shape'
import type { ShortcutChord, ShortcutId, ShortcutOverrides } from '../models/keyboard-shortcut'
import {
  formatShortcutOverrides,
  readShortcutOverrides,
  shortcutRefusal,
  withShortcut,
} from '../utils/shortcut-bindings'
import type { EisenhowerPanes } from '../models/eisenhower-settings'
import {
  formatPanesSetting,
  parseEisenhowerSource,
  pickPanes,
  readPanesSetting,
} from '../data/eisenhower-shape'
import { readFresh, reportLoadFailure, trackWrite } from './store-helpers'
import { useUndoStore, type UndoEntry } from './undo-store'
import { undoable } from './undoable'
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
  /** Next follow-up for new tasks and after "Mark followed up" = today + this (while `autoFollowup` is on). */
  followupDefaultInterval: FollowupInterval
  /**
   * "Set a next follow-up automatically": new tasks and "Mark followed up"
   * set it to today + `followupDefaultInterval`; off, new tasks get none and
   * Mark followed up clears it ({@link autoNextFollowup}). Stored under
   * `SETTING_KEYS.newTaskFollowup`.
   */
  autoFollowup: boolean
  /** "Due date makes a task urgent": days ahead (0 = today), null = off. */
  urgentDueWithinDays: UrgentDueWithinDays
  /** Hot rule: OR of lines, each an AND of markers (`utils/hot.ts`). */
  hotRule: HotRule
  /** How a check-in email opens in the mail app. */
  checkinOpenMethod: CheckinOpenMethod
  /**
   * Which of a person's open tasks a check-in covers: a list filter without
   * people (`checkinFilterOf`); `emptyPredicate()` = all of them.
   */
  checkinTaskFilter: CheckinTaskFilter
  /** What a new blank list sorts by. */
  newListSort: TodoSortBy
  /** Which way a new blank list sorts (`asc` for a sort without a direction). */
  newListSortDirection: TodoSortDirection
  /** What a new blank list groups by. */
  newListGroup: TodoGroupBy
  /** The fewest days between two launch prompts about deleting old completed tasks. */
  purgePromptIntervalDays: number
  /** When that launch prompt last showed; `null` = never. */
  purgePromptLastAt: Date | null
  /** The user's keyboard shortcut changes by binding id (the rest keep their defaults). */
  shortcutOverrides: ShortcutOverrides
  /**
   * The Eisenhower panes that differ from their defaults (every Eisenhower
   * tab and the dashboard section), in their stored form; `{}` = the four
   * default quadrants.
   */
  eisenhowerPanes: EisenhowerPanes
  /**
   * The Eisenhower's own list (a hidden list, `owner: { eisenhower: true }`)
   * whose tasks every Eisenhower tab and the dashboard section consider —
   * the `eisenhowerSource` setting, kept naming it by
   * `useListDefinitionStore.ensureEisenhowerList` (app startup, a data
   * replace). Until then it is what the stored setting names — `null`
   * (none): the Eisenhower reads all tasks, as the new, empty list would.
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
  /** "Set a next follow-up automatically"; shown at once, put back when the save fails. */
  setAutoFollowup: (on: boolean) => Promise<void>
  setUrgentDueWithinDays: (range: UrgentDueWithinDays) => Promise<void>
  /** Saves the rule normalized (empty lines dropped, duplicates collapsed); ignores a rule with no marker. */
  setHotRule: (rule: HotRule) => Promise<void>
  setCheckinOpenMethod: (method: CheckinOpenMethod) => Promise<void>
  /**
   * Remembers the check-in filter (kept without people; no filter = the row
   * removed); shown at once, put back when the save fails (the snackbar says
   * so). The same filter again writes nothing.
   */
  setCheckinTaskFilter: (filter: CheckinTaskFilter) => Promise<void>
  /**
   * What new blank lists sort by, and which way (`desc` is kept only for a
   * sort with a direction); stored only when not the default (Manual, `asc`).
   * Shown at once; one undo step with the snackbar (a failed save adds none,
   * puts the value back and says so) — as the two setters below.
   */
  setNewListSort: (sort: TodoSortBy, direction?: TodoSortDirection) => Promise<void>
  /** What new blank lists group by; stored only when not the default (none). */
  setNewListGroup: (group: TodoGroupBy) => Promise<void>
  /** The fewest days between two purge prompts (1–365; anything else is ignored); stored only when not 7. */
  setPurgePromptIntervalDays: (days: number) => Promise<void>
  /** Records that the purge prompt showed at `at` (an internal stamp: no undo step, no notice). */
  setPurgePromptLastAt: (at: Date) => Promise<void>
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
   * Shows the Eisenhower panes at once (normalised; `{}` / `undefined` =
   * the defaults) and saves them — after the Eisenhower writes before it —
   * as one undo step named `description`, with the undo snackbar. Writes
   * passing the same `mergeKey` one after another (e.g. a pane name typed
   * letter by letter) stay one undo step, without the snackbar. A failed
   * save adds no step and says so (the snackbar's notice); the panes saved
   * last show again.
   */
  setEisenhowerPanes: (panes: EisenhowerPanes | undefined, description: string, mergeKey?: string) => Promise<void>
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
  autoFollowup: true,
  urgentDueWithinDays: DEFAULT_URGENT_DUE_WITHIN_DAYS,
  hotRule: DEFAULT_HOT_RULE,
  checkinOpenMethod: DEFAULT_CHECKIN_OPEN_METHOD,
  checkinTaskFilter: emptyPredicate(),
  newListSort: 'manual' as TodoSortBy,
  newListSortDirection: 'asc' as TodoSortDirection,
  newListGroup: 'none' as TodoGroupBy,
  purgePromptIntervalDays: DEFAULT_PURGE_PROMPT_INTERVAL_DAYS,
  purgePromptLastAt: null,
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
      let autoFollowup = true
      let urgentDueWithinDays: UrgentDueWithinDays = DEFAULT_URGENT_DUE_WITHIN_DAYS
      let hotRule: HotRule = DEFAULT_HOT_RULE
      let checkinOpenMethod: CheckinOpenMethod = DEFAULT_CHECKIN_OPEN_METHOD
      let checkinTaskFilter: CheckinTaskFilter = emptyPredicate()
      let newListSort: TodoSortBy = 'manual'
      let newListSortDirection: TodoSortDirection = 'asc'
      let newListGroup: TodoGroupBy = 'none'
      let purgePromptIntervalDays = DEFAULT_PURGE_PROMPT_INTERVAL_DAYS
      let purgePromptLastAt: Date | null = null
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
        } else if (row.key === SETTING_KEYS.newTaskFollowup) {
          autoFollowup = row.value !== 'false'
        } else if (row.key === SETTING_KEYS.urgentDueWithinDays) {
          const parsed = parseUrgentDueWithinDays(row.value)
          urgentDueWithinDays = parsed === undefined ? DEFAULT_URGENT_DUE_WITHIN_DAYS : parsed
        } else if (row.key === SETTING_KEYS.hotRule) {
          hotRule = parseHotRule(row.value) ?? DEFAULT_HOT_RULE
        } else if (row.key === SETTING_KEYS.checkinOpenMethod) {
          if (isCheckinOpenMethod(row.value)) checkinOpenMethod = row.value
        } else if (row.key === SETTING_KEYS.checkinTaskFilter) {
          checkinTaskFilter = readCheckinFilterSetting(row.value).filter
        } else if (row.key === SETTING_KEYS.newListSort) {
          if (isTodoSortBy(row.value)) newListSort = row.value
        } else if (row.key === SETTING_KEYS.newListSortDirection) {
          if (row.value === 'desc') newListSortDirection = 'desc'
        } else if (row.key === SETTING_KEYS.newListGroup) {
          if (isTodoGroupBy(row.value)) newListGroup = row.value
        } else if (row.key === SETTING_KEYS.purgePromptIntervalDays) {
          purgePromptIntervalDays = parsePurgePromptIntervalDays(row.value) ?? DEFAULT_PURGE_PROMPT_INTERVAL_DAYS
        } else if (row.key === SETTING_KEYS.purgePromptLastAt) {
          const at = new Date(row.value)
          purgePromptLastAt = Number.isNaN(at.getTime()) ? null : at
        } else if (row.key === SETTING_KEYS.keyboardShortcuts) {
          shortcutOverrides = readShortcutOverrides(row.value).overrides
        } else if (row.key === SETTING_KEYS.eisenhowerPanes) {
          eisenhowerPanes = readPanesSetting(row.value).panes
        } else if (row.key === SETTING_KEYS.eisenhowerSource) {
          eisenhowerListId = parseEisenhowerSource(row.value) ?? null
        }
      }
      customizedColorKeys = customKeys
      // A direction only for a sort that has one.
      if (!sortHasDirection(newListSort)) newListSortDirection = 'asc'
      set({
        colors, defaultStatusId, quickStatusId, seededAssignedStatusId, completedRetentionDays, themeMode, weekStartsOn,
        followupDefaultInterval, autoFollowup, urgentDueWithinDays, hotRule, checkinOpenMethod, checkinTaskFilter,
        newListSort, newListSortDirection, newListGroup, purgePromptIntervalDays, purgePromptLastAt,
        shortcutOverrides, eisenhowerPanes, eisenhowerListId,
      })
      applyThemeMode(themeMode)
      setupMediaQueryListener(themeMode)
      applyThemeOverrides(customizedColorKeys, colors, resolveTheme(themeMode))
    } catch (e) {
      // The app runs on the defaults: say so, as every store's failed load does.
      reportLoadFailure('settings', e)
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

  setAutoFollowup(on: boolean) {
    return trackWrite(async () => {
      const prev = get().autoFollowup
      set({ autoFollowup: on })
      try {
        // Stored only when off: absent = on.
        if (on) await settingsRepository.delete(SETTING_KEYS.newTaskFollowup)
        else await settingsRepository.put(SETTING_KEYS.newTaskFollowup, 'false')
      } catch (e) {
        console.error('Failed to save whether a next follow-up is set automatically:', e)
        set({ autoFollowup: prev })
      }
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

  setCheckinTaskFilter(filter: CheckinTaskFilter) {
    return trackWrite(async () => {
      const next = checkinFilterOf(filter)
      const prev = get().checkinTaskFilter
      if (checkinFiltersEqual(next, prev)) return
      set({ checkinTaskFilter: next })
      try {
        // Stored only when it narrows: absent = all open tasks.
        if (isNoCheckinFilter(next)) await settingsRepository.delete(SETTING_KEYS.checkinTaskFilter)
        else await settingsRepository.put(SETTING_KEYS.checkinTaskFilter, formatCheckinFilterSetting(next))
      } catch (e) {
        console.error('Failed to save the check-in filter:', e)
        set({ checkinTaskFilter: prev })
        useUndoStore.getState().notify('Couldn’t save the check-in filter.')
      }
    })
  },

  async setNewListSort(sort: TodoSortBy, direction: TodoSortDirection = 'asc') {
    if (!isTodoSortBy(sort)) return
    const dir = effectiveSortDirection(sort, direction)
    const before = { sort: get().newListSort, dir: get().newListSortDirection }
    if (before.sort === sort && before.dir === dir) return
    await recordSettingWrite(
      `New lists sort by ${sortSummary(sort, dir)}`,
      () => writeNewListSort(sort, dir),
      () => writeNewListSort(before.sort, before.dir),
      'Couldn’t save how new lists sort.',
    )
  },

  async setNewListGroup(group: TodoGroupBy) {
    if (!isTodoGroupBy(group)) return
    const before = get().newListGroup
    if (before === group) return
    await recordSettingWrite(
      group === 'none' ? 'New lists aren’t grouped' : `New lists group by ${GROUP_LABEL[group]}`,
      () => writeNewListGroup(group),
      () => writeNewListGroup(before),
      'Couldn’t save how new lists group.',
    )
  },

  async setPurgePromptIntervalDays(days: number) {
    if (!isPurgePromptIntervalDays(days)) return
    const before = get().purgePromptIntervalDays
    if (before === days) return
    await recordSettingWrite(
      `Ask about old completed tasks at most every ${days === 1 ? 'day' : `${days} days`}`,
      () => writePurgePromptInterval(days),
      () => writePurgePromptInterval(before),
      'Couldn’t save how often to ask about old completed tasks.',
    )
  },

  setPurgePromptLastAt(at: Date) {
    return trackWrite(async () => {
      if (Number.isNaN(at.getTime())) return
      set({ purgePromptLastAt: new Date(at.getTime()) })
      try {
        await settingsRepository.put(SETTING_KEYS.purgePromptLastAt, at.toISOString())
      } catch (e) {
        // Only the stamp: the next launch may ask again sooner.
        console.error('Failed to record when the purge prompt showed:', e)
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

  async setEisenhowerPanes(panes: EisenhowerPanes | undefined, description: string, mergeKey?: string) {
    const next = pickPanes(panes ?? {}).panes
    if (formatPanesSetting(get().eisenhowerPanes) === formatPanesSetting(next)) return
    const saved = await writeEisenhowerPanes(next)
    if (saved.stale) return
    if (!saved.ok) {
      useUndoStore.getState().notify('Couldn’t save the Eisenhower panes.')
      return
    }
    recordPanesUndo(saved.before, next, description, mergeKey)
  },

}))

/**
 * The newest pane write's undo entry and its merge key, so the next write
 * with the same key updates that entry instead of adding one (while the
 * entry is still the newest on the stack).
 */
let lastPanesUndo: { mergeKey: string; entry: UndoEntry; prev: EisenhowerPanes; setNext: (panes: EisenhowerPanes) => void } | null = null
registerModuleReset(() => { lastPanesUndo = null })

/**
 * Registers a saved pane write (`prev` -> `next`) as an undo step, merged
 * into the last one with the same `mergeKey`. A step without a merge key
 * (a filter change, Reset pane, Reset all panes) shows the undo snackbar —
 * Settings, where the panes are edited, takes no Ctrl+Z; a name typed in
 * one go stays one silent step (the field's own undo covers typing).
 */
function recordPanesUndo(prev: EisenhowerPanes, next: EisenhowerPanes, description: string, mergeKey: string | undefined): void {
  const undo = useUndoStore.getState()
  if (undo.isPerformingUndoRedo) return
  const last = lastPanesUndo
  if (mergeKey !== undefined && last?.mergeKey === mergeKey && undo.undoStack.at(-1) === last.entry && undo.groupStartIndex == null) {
    if (formatPanesSetting(last.prev) === formatPanesSetting(next)) {
      // Typed back to where it started (a letter typed, then erased): no step left to undo.
      useUndoStore.setState({ undoStack: undo.undoStack.slice(0, -1) })
      lastPanesUndo = null
      return
    }
    last.setNext(next)
    return
  }
  let target = next
  const entry: UndoEntry = {
    description,
    undo: () => mustSave(writeEisenhowerPanes(prev)),
    redo: () => mustSave(writeEisenhowerPanes(target)),
  }
  undo.push(entry, mergeKey === undefined)
  lastPanesUndo = mergeKey === undefined ? null : { mergeKey, entry, prev, setNext: (p) => { target = p } }
}

/** A setting write's outcome: whether it was saved, and the value saved before it (what its undo puts back). */
interface SettingSave<T> {
  ok: boolean
  before: T
  /** The store was put back to its initial state meanwhile (tests): nothing more to record. */
  stale?: true
}

/** For an undo / redo: rejects when the write wasn't saved, so the undo store keeps the entry and says so. */
async function mustSave<T>(write: Promise<SettingSave<T>>): Promise<void> {
  if (!(await write).ok) throw new Error('The setting could not be saved')
}

/**
 * Writes for one settings field, one after another: each shows its value
 * at once, then saves it once the writes before it have settled. A failed
 * save logs and resolves `ok: false`; once no write is left the field shows
 * the value last saved — so a write that fails after a later one was shown
 * never leaves the screen and the database apart. `before` is the value
 * saved before the write (the database's, not the one shown).
 */
function serialSettingWriter<K extends 'eisenhowerPanes'>(
  field: K,
  persist: (value: SettingsState[K]) => Promise<void>,
  label: string,
): (value: SettingsState[K]) => Promise<SettingSave<SettingsState[K]>> {
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0
  let saved: SettingsState[K] = useSettingsStore.getState()[field]
  // A write left in flight by the reset settles without touching the new state.
  let generation = 0
  registerModuleReset(() => {
    queue = Promise.resolve()
    pending = 0
    generation++
  })
  return (value) => trackWrite(() => {
    // Nothing in flight: what is shown is what is saved.
    if (pending === 0) saved = useSettingsStore.getState()[field]
    pending++
    const gen = generation
    useSettingsStore.setState({ [field]: value } as Pick<SettingsState, K>)
    const run = queue.then(async (): Promise<SettingSave<SettingsState[K]>> => {
      const before = saved
      let ok = true
      try {
        await persist(value)
        if (gen === generation) saved = value
      } catch (e) {
        ok = false
        console.error(`Failed to save ${label}:`, e)
      }
      if (gen !== generation) return { ok, before, stale: true }
      pending--
      if (pending === 0 && useSettingsStore.getState()[field] !== saved) {
        useSettingsStore.setState({ [field]: saved } as Pick<SettingsState, K>)
      }
      return { ok, before }
    })
    queue = run
    return run
  })
}

/** Shows the Eisenhower panes at once, then saves them (the row goes when every pane is its default). */
const writeEisenhowerPanes = serialSettingWriter(
  'eisenhowerPanes',
  async (panes) => {
    if (Object.keys(panes).length === 0) await settingsRepository.delete(SETTING_KEYS.eisenhowerPanes)
    else await settingsRepository.put(SETTING_KEYS.eisenhowerPanes, formatPanesSetting(panes))
  },
  'the Eisenhower panes',
)

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
 * A settings change as one undo step with the undo snackbar (Settings, where
 * these are changed, takes no Ctrl+Z): `write` shows and saves it, `revert`
 * puts the value before it back. A failed save adds no step and says so
 * (the snackbar's notice); its undo / redo rejects when its write fails, so
 * the undo store keeps the entry and says so.
 */
async function recordSettingWrite(
  description: string,
  write: () => Promise<boolean>,
  revert: () => Promise<boolean>,
  failure: string,
): Promise<void> {
  if (!(await write())) {
    useUndoStore.getState().notify(failure)
    return
  }
  const must = async (run: () => Promise<boolean>) => {
    if (!(await run())) throw new Error('The setting could not be saved')
  }
  undoable(description, () => must(write), () => must(revert), true)
}

/**
 * Shows one setting's new value at once, then saves it with `persist`; a
 * failed save puts the value before it back and resolves false.
 */
function writeSetting<K extends keyof SettingsState>(
  patch: Pick<SettingsState, K>,
  persist: () => Promise<void>,
  label: string,
): Promise<boolean> {
  return trackWrite(async () => {
    const state = useSettingsStore.getState()
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, state[k as K]])) as Pick<SettingsState, K>
    useSettingsStore.setState(patch)
    try {
      await persist()
      return true
    } catch (e) {
      console.error(`Failed to save ${label}:`, e)
      useSettingsStore.setState(prev)
      return false
    }
  })
}

/** What new blank lists sort by and which way; the rows go at the defaults (Manual, `asc`). */
function writeNewListSort(sort: TodoSortBy, dir: TodoSortDirection): Promise<boolean> {
  return writeSetting({ newListSort: sort, newListSortDirection: dir }, async () => {
    if (sort === 'manual') await settingsRepository.delete(SETTING_KEYS.newListSort)
    else await settingsRepository.put(SETTING_KEYS.newListSort, sort)
    if (dir === 'asc') await settingsRepository.delete(SETTING_KEYS.newListSortDirection)
    else await settingsRepository.put(SETTING_KEYS.newListSortDirection, dir)
  }, 'the new-list sort')
}

/** What new blank lists group by; the row goes at the default (none). */
function writeNewListGroup(group: TodoGroupBy): Promise<boolean> {
  return writeSetting({ newListGroup: group }, async () => {
    if (group === 'none') await settingsRepository.delete(SETTING_KEYS.newListGroup)
    else await settingsRepository.put(SETTING_KEYS.newListGroup, group)
  }, 'the new-list grouping')
}

/** The purge prompt's interval; the row goes at the default (7 days). */
function writePurgePromptInterval(days: number): Promise<boolean> {
  return writeSetting({ purgePromptIntervalDays: days }, async () => {
    if (days === DEFAULT_PURGE_PROMPT_INTERVAL_DAYS) await settingsRepository.delete(SETTING_KEYS.purgePromptIntervalDays)
    else await settingsRepository.put(SETTING_KEYS.purgePromptIntervalDays, String(days))
  }, 'the purge prompt interval')
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

/** The two settings the automatic next follow-up is read from. */
export type AutoFollowupSettings = Pick<SettingsState, 'autoFollowup' | 'followupDefaultInterval'>

/**
 * The interval the automatic next follow-up is set by, or `null` while it is
 * off (a selector: `useSettingsStore(autoFollowupInterval)`).
 */
export function autoFollowupInterval(s: AutoFollowupSettings): FollowupInterval | null {
  return s.autoFollowup ? s.followupDefaultInterval : null
}

/**
 * The one rule for the next follow-up set automatically at `now` — by "Mark
 * followed up" (every path to it: the task menu, the bulk bar, the follow-up
 * popover's proposal, the editor, a check-in sent or its reply applied) and
 * for a new task that names none: the day `now` falls on + the Settings
 * interval while "Set a next follow-up automatically" is on, else none
 * (`null` — Mark followed up then clears the next follow-up). `s` defaults
 * to the store's current settings; a component passes the ones it subscribes to.
 */
export function autoNextFollowup(now: Date, s: AutoFollowupSettings = useSettingsStore.getState()): Date | null {
  const interval = autoFollowupInterval(s)
  return interval ? addFollowupInterval(now, interval) : null
}

/**
 * The next follow-up a new task gets when it says nothing about one
 * ({@link autoNextFollowup}, as `undefined` when none).
 */
export function newTaskDefaultFollowup(now: Date): Date | undefined {
  return autoNextFollowup(now) ?? undefined
}
