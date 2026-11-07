import { create } from 'zustand'
import type { TabBadgeRanges } from '../models/list-definition'
import { DEFAULT_PRIORITY_CUES, parsePriorityCues, type PriorityCues } from '../utils/priority-cues'
import { DEFAULT_TAB_BADGES, formatTabBadgeRange, parseTabBadgeRange } from '../utils/tab-badges'
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
  describeFollowupInterval,
  formatFollowupInterval,
  parseFollowupInterval,
  type FollowupInterval,
} from '../utils/followup'
import {
  DEFAULT_URGENT_DUE_WITHIN_DAYS,
  formatUrgentDueWithinDays,
  parseUrgentDueWithinDays,
  urgentRangeLabel,
  type UrgentDueWithinDays,
} from '../utils/urgency'
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
import { DEFAULT_STALE_AFTER_DAYS, isStaleAfterDays, parseStaleAfterDays } from '../utils/stale'
import { DEFAULT_LIST_ZOOM, LIST_ZOOM_LABELS, parseListZoomSetting } from '../utils/list-zoom'
import { isListZoom, type ListZoom } from '../models/workspace-layout'
import { DEFAULT_ROW_DATES, isRowDates, type RowDates } from '../utils/row-dates'
import { DEFAULT_AMBIENCE, SKY_STRENGTH_LABELS, type AmbienceSettings } from '../models/ambience'
import {
  formatAmbienceSettings,
  isAmbienceMotion,
  isAmbiencePlace,
  isDefaultAmbience,
  isSkyStrength,
  parseAmbienceSettings,
  roundCoordinate,
} from '../utils/ambience-settings'
import type { Lens } from '../utils/lens'
import { formatLensesSetting, isLensId, readLensesSetting } from '../data/lens-shape'
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
import { readFresh, reportLoadFailure } from './store-helpers'
import {
  settingWriter,
  type SettingRows,
  type SettingSpec,
  type SettingStore,
  type SettingWriteOptions,
  type SettingWriter,
  type StoredRows,
  type StoredSetting,
} from './setting-writes'
import { registerModuleReset } from '../utils/module-reset'

export type ThemeMode = 'light' | 'dark' | 'system'

export type { ListZoom } from '../models/workspace-layout'
export type { RowDates } from '../utils/row-dates'

export type { ThemeColors, ThemedColors, ThemeName } from '../models/theme-colors'
export { DEFAULT_THEMED_COLORS } from '../models/theme-colors'

/** The colours the user set per theme (their `color.<theme>.<key>` rows exist); the rest fall through to `tokens.css`. */
export type CustomizedColors = Readonly<Record<ThemeName, readonly (keyof ThemeColors)[]>>

/** The settings as the store holds them — each one entry of {@link SETTINGS}. */
interface SettingsData {
  colors: ThemedColors
  /** Which of `colors` are overrides (kept with them: a rollback or reset restores both). */
  customizedColors: CustomizedColors
  themeMode: ThemeMode
  defaultStatusId: number | null
  seededAssignedStatusId: number | null
  completedRetentionDays: number | null // null = keep forever
  weekStartsOn: WeekStart
  /** Next follow-up for new tasks and after "Mark followed up" = today + this (while `autoFollowup` is on). */
  followupDefaultInterval: FollowupInterval
  /**
   * "Set a next follow-up automatically": new tasks and "Mark followed up"
   * set it to today + `followupDefaultInterval`; off, new tasks get none and
   * Mark followed up clears it ({@link autoNextFollowup}) — Mark followed up
   * only on a task whose next follow-up isn't after today (one after today is
   * kept, `utils/followup.nextAfterFollowup`). Stored under
   * `SETTING_KEYS.newTaskFollowup`.
   */
  autoFollowup: boolean
  /** "Remove note lines after converting": a converted line leaves the note instead of becoming `✓ <title>`. Off by default. */
  removeConvertedLines: boolean
  /** "Due date makes a task urgent": days ahead (0 = today), null = off. */
  urgentDueWithinDays: UrgentDueWithinDays
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
  /** "Fade tasks untouched for": days without a change after which an open task's row is drawn faded; 0 = off. */
  staleAfterDays: number
  /** What a list tab's badges count, unless the list has its own (`utils/tab-badges`). */
  tabBadges: TabBadgeRanges
  /** What each priority adds to a task's row (`utils/priority-cues`). */
  priorityCues: PriorityCues
  /** The zoom of a list tab that hasn't picked one (Settings › Appearance › Default list zoom; `utils/list-zoom`). */
  listZoom: ListZoom
  /** How the task rows show their due and follow-up dates (`utils/row-dates`). */
  rowDates: RowDates
  /** Ambience: the time of day and the season in the chrome (Settings › Appearance › Ambience; `models/ambience`). */
  ambience: AmbienceSettings
  /** The lenses (named screen filters, picked in the top bar — `utils/lens`), in Settings' order. */
  lenses: readonly Lens[]
  /** The preset lenses were seeded once (`seedLensPresets`); nothing seeds them again. */
  lensPresetsSeeded: boolean
  /**
   * The lens picked in the top bar, for every layout (a lens's id); `null` =
   * No lens. An id no lens has (a lens deleted since) reads as No lens.
   */
  activeLensId: string | null
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
}

// Every setter below shows its value at once and saves it through the
// setting's writer (`stores/setting-writes`): a failed save puts back the
// value saved before and says so; the ones with an undo step say so.
interface SettingsState extends SettingsData {
  load: () => Promise<void>
  /** No undo step (a colour picker writes on every move). */
  setColor: (theme: ThemeName, key: keyof ThemeColors, value: string) => Promise<void>
  /** When `theme` is omitted, both bags reset; otherwise only the specified bag. */
  resetColors: (theme?: ThemeName) => Promise<void>
  /** No undo step. */
  setThemeMode: (mode: ThemeMode) => Promise<void>
  /** `options.record: false` — no undo step (a status delete records its own). */
  setDefaultStatusId: (id: number | null, options?: Pick<SettingWriteOptions, 'record'>) => Promise<void>
  setCompletedRetentionDays: (days: number | null) => Promise<void>
  setWeekStartsOn: (day: WeekStart) => Promise<void>
  setFollowupDefaultInterval: (interval: FollowupInterval) => Promise<void>
  /** "Set a next follow-up automatically". */
  setAutoFollowup: (on: boolean) => Promise<void>
  setRemoveConvertedLines: (on: boolean) => Promise<void>
  setUrgentDueWithinDays: (range: UrgentDueWithinDays) => Promise<void>
  /** No undo step (also picked in the check-in dialog). */
  setCheckinOpenMethod: (method: CheckinOpenMethod) => Promise<void>
  /**
   * Remembers the check-in filter (kept without people; no filter = the row
   * removed); no undo step (the check-in dialog's filter line writes on
   * every edit). The same filter again writes nothing.
   */
  setCheckinTaskFilter: (filter: CheckinTaskFilter) => Promise<void>
  /**
   * What new blank lists sort by, and which way (`desc` is kept only for a
   * sort with a direction); stored only when not the default (Manual, `asc`).
   */
  setNewListSort: (sort: TodoSortBy, direction?: TodoSortDirection) => Promise<void>
  /** What new blank lists group by; stored only when not the default (none). */
  setNewListGroup: (group: TodoGroupBy) => Promise<void>
  /** The fewest days between two purge prompts (1–365; anything else is ignored); stored only when not 7. */
  setPurgePromptIntervalDays: (days: number) => Promise<void>
  /** Records that the purge prompt showed at `at` (an internal stamp: no undo step, no notice — a failure is only logged). */
  setPurgePromptLastAt: (at: Date) => Promise<void>
  /** Fade tasks untouched for `days` (0–365 whole days, 0 = off; anything else is ignored); stored only when not 30. */
  setStaleAfterDays: (days: number) => Promise<void>
  setTabBadges: (ranges: TabBadgeRanges) => Promise<void>
  setPriorityCues: (cues: PriorityCues) => Promise<void>
  /** The default list zoom (an unknown value is ignored); stored only when not `rows`. */
  setListZoom: (zoom: ListZoom) => Promise<void>
  /** How the task rows show dates (an unknown value is ignored); stored only when not `relative`. */
  setRowDates: (dates: RowDates) => Promise<void>
  /**
   * Changes ambience settings (a field out of range is ignored; a place is
   * kept to two decimals, `null` = guessed from the time zone); stored only
   * when not all defaults. Each change is an undo step named for it; writes
   * passing the same `mergeKey` (the Header motion slider as it moves) stay one.
   */
  setAmbience: (changes: Partial<AmbienceSettings>, options?: Pick<SettingWriteOptions, 'mergeKey'>) => Promise<void>
  // The lens edits and the top bar's pick are `stores/lens-actions`' (cr31 A5).
  /**
   * Gives `id` new keys (no undo step). Resolves the reason when they are
   * refused (a reserved key, or another binding's — nothing is written),
   * else null.
   */
  setShortcut: (id: ShortcutId, chord: ShortcutChord) => Promise<string | null>
  /** Puts `id` back on its default keys. */
  resetShortcut: (id: ShortcutId) => Promise<void>
  /** Puts every binding back on its default keys. */
  resetAllShortcuts: () => Promise<void>
  /**
   * Shows the Eisenhower panes at once (normalised; `{}` / `undefined` =
   * the defaults) and saves them as one undo step named `description`.
   * Writes passing the same `mergeKey` one after another (e.g. a pane name
   * typed letter by letter) stay one undo step, without the snackbar.
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

/**
 * Apply only user-customized color overrides for the resolved theme as inline
 * styles. Non-customized colors fall through to the CSS theme (dark/light).
 * The `light` and `dark` overrides are stored separately and only the bag for
 * the resolved theme is written to the document — switching themes flips
 * which bag wins (the theme mode's writer + setupMediaQueryListener).
 */
function applyColorOverrides(): void {
  const { colors: themed, customizedColors, themeMode } = useSettingsStore.getState()
  const resolvedTheme = resolveTheme(themeMode)
  const root = document.documentElement
  const colors = themed[resolvedTheme]
  const bag = customizedColors[resolvedTheme]
  for (const [key, varName] of Object.entries(THEME_COLOR_VARS) as [keyof ThemeColors, string][]) {
    if (bag.includes(key)) {
      root.style.setProperty(varName, colors[key])
    } else {
      root.style.removeProperty(varName)
    }
  }
  if (bag.includes('accent')) {
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
      applyColorOverrides()
    }
    mq.addEventListener('change', handler)
    mediaQueryCleanup = () => mq.removeEventListener('change', handler)
  }
}

/** The page shows the store's theme: `data-theme`, following the OS under System, and the resolved theme's colour overrides. */
function applyTheme(): void {
  const mode = useSettingsStore.getState().themeMode
  applyThemeMode(mode)
  setupMediaQueryListener(mode)
  applyColorOverrides()
}

/**
 * Stops following the OS theme, for tests that share one module instance
 * (the store's state — the colours customised among it — is reset
 * separately).
 */
export function resetSettingsModuleState(): void {
  mediaQueryCleanup?.()
  mediaQueryCleanup = null
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

/** The default panes (no pane customized). */
const NO_PANES: EisenhowerPanes = {}

const THEMES: readonly ThemeName[] = ['dark', 'light']

// The writers reach the store only when they write (the table is built before it).
const store: SettingStore<SettingsState> = {
  getState: () => useSettingsStore.getState(),
  setState: (partial) => useSettingsStore.setState(partial),
}

/** A setting this store writes: its spec and its writer. */
function setting<K extends keyof SettingsData>(
  fields: readonly K[],
  def: Omit<SettingSpec<SettingsState, K>, 'fields'>,
): SettingSpec<SettingsState, K> & SettingWriter<SettingsState, K> {
  const spec = { fields, ...def }
  return { ...spec, ...settingWriter(store, spec) }
}

/** A setting only read here (written elsewhere: the status seed, the Eisenhower list, the lens seed). */
function stored<K extends keyof SettingsData>(fields: readonly K[], read: (rows: StoredRows) => Pick<SettingsState, K>): StoredSetting<SettingsState, K> {
  return { fields, read }
}

/** One row's value as stored, or what an absent row reads as. */
function rowOr<T>(rows: StoredRows, key: string, absent: T, parse: (value: string) => T): T {
  const value = rows.get(key)
  return value === undefined ? absent : parse(value)
}

/** A setting stored as one row that goes at its default (absent = the default). */
function rowUnlessDefault(key: string, value: string, isDefault: boolean): SettingRows {
  return { [key]: isDefault ? null : value }
}

const K = SETTING_KEYS

/**
 * Every setting, one entry each: the store fields it shows, how they are
 * read from the `settings` rows (`read`; an absent or unreadable row reads
 * as the default) and written (`rows`), its undo step's name (`undo`;
 * omitted: none) and its failure notice (`failure`). A new setting is a new
 * entry (plus its key in `data/setting-keys` and its import validation).
 */
export const SETTINGS = {
  colors: setting(['colors', 'customizedColors'], {
    read(rows) {
      const colors: ThemedColors = { dark: { ...DEFAULT_THEMED_COLORS.dark }, light: { ...DEFAULT_THEMED_COLORS.light } }
      const customized: Record<ThemeName, (keyof ThemeColors)[]> = { dark: [], light: [] }
      for (const [key, value] of rows) {
        const color = key.startsWith('color.') ? parseColorSettingKey(key) : null
        if (!color || !isValidCssColor(value)) continue
        colors[color.theme][color.name] = value
        if (!customized[color.theme].includes(color.name)) customized[color.theme].push(color.name)
      }
      return { colors, customizedColors: customized }
    },
    // Every colour's row: an override's value, or none.
    rows: ({ colors, customizedColors }) => Object.fromEntries(THEMES.flatMap((theme) =>
      (Object.keys(DEFAULT_THEMED_COLORS[theme]) as (keyof ThemeColors)[]).map((key) =>
        [`color.${theme}.${key}`, customizedColors[theme].includes(key) ? colors[theme][key] : null]))),
    label: 'the theme colors',
    failure: 'Couldn’t save the theme colors.',
    shown: applyColorOverrides,
  }),
  themeMode: setting(['themeMode'], {
    read: (rows) => ({ themeMode: rowOr<ThemeMode>(rows, K.themeMode, 'dark', (v) => (isValidThemeMode(v) ? v : 'dark')) }),
    rows: ({ themeMode }) => ({ [K.themeMode]: themeMode }),
    label: 'the theme',
    failure: 'Couldn’t save the theme.',
    shown: applyTheme,
  }),
  defaultStatusId: setting(['defaultStatusId'], {
    read: (rows) => ({ defaultStatusId: rowOr(rows, K.defaultStatusId, null, (v) => (v ? Number(v) : null)) }),
    rows: ({ defaultStatusId: id }) => ({ [K.defaultStatusId]: id == null ? null : String(id) }),
    label: 'the default status',
    failure: 'Couldn’t save the default status.',
    undo: ({ defaultStatusId: id }) => (id == null ? 'No default status' : 'Changed the default status'),
  }),
  seededAssignedStatusId: stored(['seededAssignedStatusId'], (rows) => ({
    seededAssignedStatusId: rowOr(rows, K.seededAssignedStatusId, null, (v) => (v ? Number(v) : null)),
  })),
  completedRetentionDays: setting(['completedRetentionDays'], {
    read: (rows) => ({
      completedRetentionDays: rowOr(rows, K.completedRetentionDays, null, (v) => {
        const parsed = v ? Number(v) : null
        return parsed != null && isValidRetentionDays(parsed) ? parsed : null
      }),
    }),
    rows: ({ completedRetentionDays: days }) => ({ [K.completedRetentionDays]: days == null ? null : String(days) }),
    label: 'the completed-task retention',
    failure: 'Couldn’t save when to offer to delete completed tasks.',
    undo: ({ completedRetentionDays: days }) =>
      (days == null ? 'Don’t offer to delete completed tasks' : `Offer to delete completed tasks after ${days === 1 ? 'a day' : `${days} days`}`),
  }),
  weekStartsOn: setting(['weekStartsOn'], {
    read: (rows) => {
      const parsed = Number(rows.get(K.weekStartsOn))
      return { weekStartsOn: isValidWeekStart(parsed) ? parsed : 1 }
    },
    rows: ({ weekStartsOn }) => ({ [K.weekStartsOn]: String(weekStartsOn) }),
    label: 'the first day of the week',
    failure: 'Couldn’t save the first day of the week.',
    undo: ({ weekStartsOn }) => `Weeks start on ${weekStartsOn === 0 ? 'Sunday' : 'Monday'}`,
  }),
  followupDefaultInterval: setting(['followupDefaultInterval'], {
    read: (rows) => ({
      followupDefaultInterval: rowOr(rows, K.followupDefaultInterval, DEFAULT_FOLLOWUP_INTERVAL, (v) => parseFollowupInterval(v) ?? DEFAULT_FOLLOWUP_INTERVAL),
    }),
    rows: ({ followupDefaultInterval: i }) => ({ [K.followupDefaultInterval]: formatFollowupInterval(i) }),
    label: 'the follow-up interval',
    failure: 'Couldn’t save the follow-up interval.',
    undo: ({ followupDefaultInterval: i }) => `Follow-up interval ${describeFollowupInterval(i)}`,
  }),
  autoFollowup: setting(['autoFollowup'], {
    read: (rows) => ({ autoFollowup: rows.get(K.newTaskFollowup) !== 'false' }),
    // Stored only when off: absent = on.
    rows: ({ autoFollowup: on }) => rowUnlessDefault(K.newTaskFollowup, 'false', on),
    label: 'whether a next follow-up is set automatically',
    failure: 'Couldn’t save whether a next follow-up is set automatically.',
    undo: ({ autoFollowup: on }) => (on ? 'Set a next follow-up automatically' : 'Don’t set a next follow-up automatically'),
  }),
  removeConvertedLines: setting(['removeConvertedLines'], {
    read: (rows) => ({ removeConvertedLines: rows.get(K.removeConvertedLines) === 'true' }),
    // Stored only when on: absent = off.
    rows: ({ removeConvertedLines: on }) => rowUnlessDefault(K.removeConvertedLines, 'true', !on),
    label: 'whether converted lines are removed from the note',
    failure: 'Couldn’t save what converted note lines become.',
    undo: ({ removeConvertedLines: on }) => (on ? 'Remove note lines after converting' : 'Keep converted note lines'),
  }),
  urgentDueWithinDays: setting(['urgentDueWithinDays'], {
    read: (rows) => ({
      urgentDueWithinDays: rowOr(rows, K.urgentDueWithinDays, DEFAULT_URGENT_DUE_WITHIN_DAYS, (v) => {
        const parsed = parseUrgentDueWithinDays(v)
        return parsed === undefined ? DEFAULT_URGENT_DUE_WITHIN_DAYS : parsed
      }),
    }),
    rows: ({ urgentDueWithinDays: range }) => ({ [K.urgentDueWithinDays]: formatUrgentDueWithinDays(range) }),
    label: 'the urgent range',
    failure: 'Couldn’t save when a due date makes a task urgent.',
    undo: ({ urgentDueWithinDays: range }) => (range == null
      ? 'Due dates don’t make tasks urgent'
      : range === 0 ? 'Due today makes a task urgent' : `Due within ${urgentRangeLabel(range)} makes a task urgent`),
  }),
  checkinOpenMethod: setting(['checkinOpenMethod'], {
    read: (rows) => ({ checkinOpenMethod: rowOr(rows, K.checkinOpenMethod, DEFAULT_CHECKIN_OPEN_METHOD, (v) => (isCheckinOpenMethod(v) ? v : DEFAULT_CHECKIN_OPEN_METHOD)) }),
    rows: ({ checkinOpenMethod }) => ({ [K.checkinOpenMethod]: checkinOpenMethod }),
    label: 'the check-in open method',
    failure: 'Couldn’t save how check-ins open.',
  }),
  checkinTaskFilter: setting(['checkinTaskFilter'], {
    read: (rows) => ({ checkinTaskFilter: rowOr(rows, K.checkinTaskFilter, emptyPredicate(), (v) => readCheckinFilterSetting(v).filter) }),
    // Stored only when it narrows: absent = all open tasks.
    rows: ({ checkinTaskFilter: f }) => ({ [K.checkinTaskFilter]: isNoCheckinFilter(f) ? null : formatCheckinFilterSetting(f) }),
    label: 'the check-in filter',
    failure: 'Couldn’t save the check-in filter.',
  }),
  newListSort: setting(['newListSort', 'newListSortDirection'], {
    read(rows) {
      const newListSort = rowOr<TodoSortBy>(rows, K.newListSort, 'manual', (v) => (isTodoSortBy(v) ? v : 'manual'))
      // A direction only for a sort that has one.
      const desc = rows.get(K.newListSortDirection) === 'desc' && sortHasDirection(newListSort)
      return { newListSort, newListSortDirection: desc ? 'desc' : 'asc' }
    },
    // Both rows in one transaction; they go at the defaults (Manual, `asc`).
    rows: ({ newListSort: sort, newListSortDirection: dir }) => ({
      [K.newListSort]: sort === 'manual' ? null : sort,
      [K.newListSortDirection]: dir === 'asc' ? null : dir,
    }),
    label: 'the new-list sort',
    failure: 'Couldn’t save how new lists sort.',
    undo: ({ newListSort: sort, newListSortDirection: dir }) => `New lists sort by ${sortSummary(sort, dir)}`,
  }),
  newListGroup: setting(['newListGroup'], {
    read: (rows) => ({ newListGroup: rowOr<TodoGroupBy>(rows, K.newListGroup, 'none', (v) => (isTodoGroupBy(v) ? v : 'none')) }),
    rows: ({ newListGroup: group }) => rowUnlessDefault(K.newListGroup, group, group === 'none'),
    label: 'the new-list grouping',
    failure: 'Couldn’t save how new lists group.',
    undo: ({ newListGroup: group }) => (group === 'none' ? 'New lists aren’t grouped' : `New lists group by ${GROUP_LABEL[group]}`),
  }),
  purgePromptIntervalDays: setting(['purgePromptIntervalDays'], {
    read: (rows) => ({
      purgePromptIntervalDays: rowOr(rows, K.purgePromptIntervalDays, DEFAULT_PURGE_PROMPT_INTERVAL_DAYS, (v) => parsePurgePromptIntervalDays(v) ?? DEFAULT_PURGE_PROMPT_INTERVAL_DAYS),
    }),
    rows: ({ purgePromptIntervalDays: days }) => rowUnlessDefault(K.purgePromptIntervalDays, String(days), days === DEFAULT_PURGE_PROMPT_INTERVAL_DAYS),
    label: 'the purge prompt interval',
    failure: 'Couldn’t save how often to ask about old completed tasks.',
    undo: ({ purgePromptIntervalDays: days }) => `Ask about old completed tasks at most every ${days === 1 ? 'day' : `${days} days`}`,
  }),
  // An internal stamp: no undo step, no notice (the next launch may ask again sooner).
  purgePromptLastAt: setting(['purgePromptLastAt'], {
    read: (rows) => ({
      purgePromptLastAt: rowOr(rows, K.purgePromptLastAt, null, (v) => {
        const at = new Date(v)
        return Number.isNaN(at.getTime()) ? null : at
      }),
    }),
    rows: ({ purgePromptLastAt: at }) => ({ [K.purgePromptLastAt]: at ? at.toISOString() : null }),
    label: 'when the purge prompt showed',
  }),
  staleAfterDays: setting(['staleAfterDays'], {
    read: (rows) => ({ staleAfterDays: rowOr(rows, K.staleAfterDays, DEFAULT_STALE_AFTER_DAYS, (v) => parseStaleAfterDays(v) ?? DEFAULT_STALE_AFTER_DAYS) }),
    rows: ({ staleAfterDays: days }) => rowUnlessDefault(K.staleAfterDays, String(days), days === DEFAULT_STALE_AFTER_DAYS),
    label: 'the stale threshold',
    failure: 'Couldn’t save when to fade untouched tasks.',
    undo: ({ staleAfterDays: days }) => (days === 0 ? 'Don’t fade untouched tasks' : `Fade tasks untouched for ${days === 1 ? 'a day' : `${days} days`}`),
  }),
  tabBadges: setting(['tabBadges'], {
    read: (rows) => {
      const due = rows.get(K.tabBadgeDue)
      const followup = rows.get(K.tabBadgeFollowup)
      if (due === undefined && followup === undefined) return { tabBadges: DEFAULT_TAB_BADGES }
      return {
        tabBadges: {
          due: (due === undefined ? undefined : parseTabBadgeRange(due)) ?? DEFAULT_TAB_BADGES.due,
          followup: (followup === undefined ? undefined : parseTabBadgeRange(followup)) ?? DEFAULT_TAB_BADGES.followup,
        },
      }
    },
    // Both rows in one transaction (cr31 A5: a failure never leaves one range saved).
    rows: ({ tabBadges: { due, followup } }) => ({ [K.tabBadgeDue]: formatTabBadgeRange(due), [K.tabBadgeFollowup]: formatTabBadgeRange(followup) }),
    label: 'the tab badge ranges',
    failure: 'Couldn’t save the tab badges.',
    undo: () => 'Changed the tab badges',
  }),
  priorityCues: setting(['priorityCues'], {
    read: (rows) => ({ priorityCues: rowOr(rows, K.priorityCues, DEFAULT_PRIORITY_CUES, (v) => parsePriorityCues(v) ?? DEFAULT_PRIORITY_CUES) }),
    rows: ({ priorityCues }) => ({ [K.priorityCues]: JSON.stringify(priorityCues) }),
    label: 'the priority cues',
    failure: 'Couldn’t save the priority cues.',
    undo: () => 'Changed the priority cues',
  }),
  // In the `rowDensity` row, which held the densities before the zoom levels (read as levels: `utils/list-zoom`).
  listZoom: setting(['listZoom'], {
    read: (rows) => ({ listZoom: rowOr(rows, K.rowDensity, DEFAULT_LIST_ZOOM, (v) => parseListZoomSetting(v) ?? DEFAULT_LIST_ZOOM) }),
    rows: ({ listZoom }) => rowUnlessDefault(K.rowDensity, listZoom, listZoom === DEFAULT_LIST_ZOOM),
    label: 'the default list zoom',
    failure: 'Couldn’t save the default list zoom.',
    undo: ({ listZoom }) => `Default list zoom: ${LIST_ZOOM_LABELS[listZoom]}`,
  }),
  rowDates: setting(['rowDates'], {
    read: (rows) => ({ rowDates: rowOr(rows, K.rowDates, DEFAULT_ROW_DATES, (v) => (isRowDates(v) ? v : DEFAULT_ROW_DATES)) }),
    rows: ({ rowDates }) => rowUnlessDefault(K.rowDates, rowDates, rowDates === DEFAULT_ROW_DATES),
    label: 'the row dates',
    failure: 'Couldn’t save how rows show dates.',
    undo: ({ rowDates }) => (rowDates === 'relative' ? 'Relative dates on rows' : 'MM/DD dates on rows'),
  }),
  ambience: setting(['ambience'], {
    read: (rows) => ({ ambience: rowOr(rows, K.ambience, DEFAULT_AMBIENCE, (v) => parseAmbienceSettings(v) ?? DEFAULT_AMBIENCE) }),
    rows: ({ ambience }) => rowUnlessDefault(K.ambience, formatAmbienceSettings(ambience), isDefaultAmbience(ambience)),
    label: 'the ambience',
    failure: 'Couldn’t save the ambience settings.',
    undo: ({ ambience: a }) => (!a.enabled ? 'Ambience off' : `Ambience: ${SKY_STRENGTH_LABELS[a.sky]}, ${a.seasons ? 'with' : 'without'} seasons`),
  }),
  // The lenses and the pick are written by `stores/lens-actions` (its undo names are the edit's).
  lenses: setting(['lenses'], {
    read: (rows) => ({ lenses: rowOr<readonly Lens[]>(rows, K.lenses, [], (v) => readLensesSetting(v).lenses) }),
    rows: ({ lenses }) => ({ [K.lenses]: lenses.length === 0 ? null : formatLensesSetting(lenses) }),
    label: 'the lenses',
    failure: 'Couldn’t save the lenses.',
  }),
  lensPresetsSeeded: stored(['lensPresetsSeeded'], (rows) => ({ lensPresetsSeeded: rows.get(K.lensPresetsSeeded) === 'true' })),
  activeLensId: setting(['activeLensId'], {
    read: (rows) => ({ activeLensId: rowOr(rows, K.activeLensId, null, (v) => (isLensId(v) ? v : null)) }),
    rows: ({ activeLensId: id }) => ({ [K.activeLensId]: id }),
    label: 'the lens pick',
    failure: 'Couldn’t save the lens pick.',
  }),
  shortcutOverrides: setting(['shortcutOverrides'], {
    read: (rows) => ({ shortcutOverrides: rowOr<ShortcutOverrides>(rows, K.keyboardShortcuts, {}, (v) => readShortcutOverrides(v).overrides) }),
    // The row goes when no override is left.
    rows: ({ shortcutOverrides: o }) => ({ [K.keyboardShortcuts]: Object.keys(o).length === 0 ? null : formatShortcutOverrides(o) }),
    label: 'the keyboard shortcuts',
    failure: 'Couldn’t save the keyboard shortcuts.',
  }),
  // Its undo names are the edit's (`setEisenhowerPanes`' description).
  eisenhowerPanes: setting(['eisenhowerPanes'], {
    read: (rows) => ({ eisenhowerPanes: rowOr(rows, K.eisenhowerPanes, NO_PANES, (v) => readPanesSetting(v).panes) }),
    // The row goes when every pane is its default.
    rows: ({ eisenhowerPanes: p }) => ({ [K.eisenhowerPanes]: Object.keys(p).length === 0 ? null : formatPanesSetting(p) }),
    label: 'the Eisenhower panes',
    failure: 'Couldn’t save the Eisenhower panes.',
  }),
  eisenhowerListId: stored(['eisenhowerListId'], (rows) => ({
    eisenhowerListId: rowOr(rows, K.eisenhowerSource, null, (v) => parseEisenhowerSource(v) ?? null),
  })),
}

/** Every setting's value from the stored rows (no rows: the defaults). */
function readSettings(rows: StoredRows): SettingsData {
  return Object.assign({}, ...Object.values(SETTINGS).map((s) => s.read(rows))) as SettingsData
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...readSettings(new Map()),

  async load() {
    try {
      const rows = await readFresh(() => settingsRepository.getAll())
      set(readSettings(new Map(rows.map((r) => [r.key, r.value]))))
      applyTheme()
    } catch (e) {
      // The app runs on the defaults: say so, as every store's failed load does.
      reportLoadFailure('settings', e)
      // The page still gets a theme: the current (default) mode.
      applyThemeMode(get().themeMode)
    }
  },

  async setColor(theme, key, value) {
    if (!isValidCssColor(value)) return
    const { colors, customizedColors: custom } = get()
    await SETTINGS.colors.write({
      colors: { ...colors, [theme]: { ...colors[theme], [key]: value } },
      customizedColors: { ...custom, [theme]: custom[theme].includes(key) ? custom[theme] : [...custom[theme], key] },
    })
  },

  async resetColors(theme) {
    const targets = theme == null ? THEMES : [theme]
    const colors = { ...get().colors }
    const customizedColors = { ...get().customizedColors }
    for (const t of targets) {
      colors[t] = { ...DEFAULT_THEMED_COLORS[t] }
      customizedColors[t] = []
    }
    await SETTINGS.colors.write({ colors, customizedColors })
  },

  async setThemeMode(mode) {
    if (isValidThemeMode(mode)) await SETTINGS.themeMode.write({ themeMode: mode })
  },

  async setDefaultStatusId(id, options) {
    await SETTINGS.defaultStatusId.write({ defaultStatusId: id }, options)
  },

  async setWeekStartsOn(day) {
    if (isValidWeekStart(day)) await SETTINGS.weekStartsOn.write({ weekStartsOn: day })
  },

  async setCompletedRetentionDays(days) {
    if (days == null || isValidRetentionDays(days)) await SETTINGS.completedRetentionDays.write({ completedRetentionDays: days })
  },

  async setFollowupDefaultInterval(interval) {
    if (!parseFollowupInterval(formatFollowupInterval(interval))) return
    await SETTINGS.followupDefaultInterval.write({ followupDefaultInterval: { ...interval } })
  },

  async setAutoFollowup(on) {
    await SETTINGS.autoFollowup.write({ autoFollowup: on })
  },

  async setRemoveConvertedLines(on) {
    await SETTINGS.removeConvertedLines.write({ removeConvertedLines: on })
  },

  async setUrgentDueWithinDays(range) {
    if (parseUrgentDueWithinDays(formatUrgentDueWithinDays(range)) === undefined) return
    await SETTINGS.urgentDueWithinDays.write({ urgentDueWithinDays: range })
  },

  async setCheckinOpenMethod(method) {
    if (isCheckinOpenMethod(method)) await SETTINGS.checkinOpenMethod.write({ checkinOpenMethod: method })
  },

  async setCheckinTaskFilter(filter) {
    const next = checkinFilterOf(filter)
    if (checkinFiltersEqual(next, get().checkinTaskFilter)) return
    await SETTINGS.checkinTaskFilter.write({ checkinTaskFilter: next })
  },

  async setNewListSort(sort, direction = 'asc') {
    if (!isTodoSortBy(sort)) return
    await SETTINGS.newListSort.write({ newListSort: sort, newListSortDirection: effectiveSortDirection(sort, direction) })
  },

  async setNewListGroup(group) {
    if (isTodoGroupBy(group)) await SETTINGS.newListGroup.write({ newListGroup: group })
  },

  async setPurgePromptIntervalDays(days) {
    if (isPurgePromptIntervalDays(days)) await SETTINGS.purgePromptIntervalDays.write({ purgePromptIntervalDays: days })
  },

  async setPurgePromptLastAt(at) {
    if (!Number.isNaN(at.getTime())) await SETTINGS.purgePromptLastAt.write({ purgePromptLastAt: new Date(at.getTime()) })
  },

  async setStaleAfterDays(days) {
    if (isStaleAfterDays(days)) await SETTINGS.staleAfterDays.write({ staleAfterDays: days })
  },

  async setTabBadges(ranges) {
    await SETTINGS.tabBadges.write({ tabBadges: ranges })
  },

  async setPriorityCues(cues) {
    await SETTINGS.priorityCues.write({ priorityCues: cues })
  },

  async setListZoom(zoom) {
    if (isListZoom(zoom)) await SETTINGS.listZoom.write({ listZoom: zoom })
  },

  async setRowDates(dates) {
    if (isRowDates(dates)) await SETTINGS.rowDates.write({ rowDates: dates })
  },

  async setAmbience(changes, options) {
    const current = get().ambience
    const next: AmbienceSettings = {
      enabled: typeof changes.enabled === 'boolean' ? changes.enabled : current.enabled,
      place: changes.place === undefined ? current.place
        : changes.place === null ? null
          : isAmbiencePlace(changes.place) ? { lat: roundCoordinate(changes.place.lat), lon: roundCoordinate(changes.place.lon) } : current.place,
      sky: isSkyStrength(changes.sky) ? changes.sky : current.sky,
      motion: isAmbienceMotion(changes.motion) ? changes.motion : current.motion,
      seasons: typeof changes.seasons === 'boolean' ? changes.seasons : current.seasons,
    }
    if (formatAmbienceSettings(next) === formatAmbienceSettings(current)) return
    // The undo step names what changed.
    let description: string | undefined
    if (next.enabled !== current.enabled) description = next.enabled ? 'Ambience on' : 'Ambience off'
    else if (next.seasons !== current.seasons) description = next.seasons ? 'Seasonal ambience on' : 'Seasonal ambience off'
    else if (next.sky !== current.sky) description = `Ambience sky: ${SKY_STRENGTH_LABELS[next.sky]}`
    else if (next.place !== current.place) description = next.place ? `Ambience place ${next.place.lat}, ${next.place.lon}` : 'Ambience place from the time zone'
    else description = `Header motion ${next.motion}%`
    await SETTINGS.ambience.write({ ambience: next }, { ...options, description })
  },

  async setShortcut(id, chord) {
    const refusal = shortcutRefusal(id, chord, get().shortcutOverrides)
    if (refusal) return refusal
    await SETTINGS.shortcutOverrides.write({ shortcutOverrides: withShortcut(get().shortcutOverrides, id, chord) })
    return null
  },

  async resetShortcut(id) {
    await SETTINGS.shortcutOverrides.write({ shortcutOverrides: withShortcut(get().shortcutOverrides, id, null) })
  },

  async resetAllShortcuts() {
    await SETTINGS.shortcutOverrides.write({ shortcutOverrides: {} })
  },

  async setEisenhowerPanes(panes, description, mergeKey) {
    const next = pickPanes(panes ?? {}).panes
    await SETTINGS.eisenhowerPanes.write({ eisenhowerPanes: next }, { description, mergeKey })
  },
}))

/**
 * The settings filters are evaluated with (urgent range, week
 * start), as they are now. A memoized caller uses `useFilterSettings`
 * instead, so a settings change re-runs it.
 */
export function currentFilterSettings(): FilterSettings {
  const { urgentDueWithinDays, weekStartsOn } = useSettingsStore.getState()
  return { urgentRange: urgentDueWithinDays, weekStartsOn }
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
 * (`null` — Mark followed up then clears the next follow-up). Mark followed
 * up applies it only where the task's next follow-up isn't after today
 * (`utils/followup.nextAfterFollowup`). `s` defaults
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
