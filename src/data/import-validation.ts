import type { TodoItem, Person, TodoPerson, RecurrenceRule, RecurrenceType, Status, Note, Tag, TodoTag, TodoEvent, TodoEventType, ListOrder } from '../models'
import { isTodoSortBy, isTodoGroupBy, isTodoSortDirection } from '../models'
import type { ListDefinition, ListOwner, ListSort, ListGrouping, RuntimeFilterField, RuntimeFilterSpec } from '../models/list-definition'
import { checkPredicateShape, pickPredicate } from './predicate-shape'
import { toDate, toOptDate } from './date-revive'
import { STATUS_ICON_KEYS, type StatusIconKey } from '../models/status'
import { ALL_SETTING_KEYS, SETTING_KEYS } from './setting-keys'
import { parseFollowupInterval } from '../utils/followup'
import { parseUrgentDueWithinDays } from '../utils/urgency'
import { formatHotRule, parseHotRule } from '../utils/hot'
import { formatShortcutOverrides, readShortcutOverrides } from '../utils/shortcut-bindings'
import { isCheckinOpenMethod } from '../utils/checkin-settings'
import { parseStaleAfterDays } from '../utils/stale'
import { isRowDensity } from '../utils/row-density'
import { parsePurgePromptIntervalDays } from '../utils/completed-at'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { isHueName, LAYOUT_NAME_MAX } from '../models/workspace-layout'
import { checkLayoutBody, isId, pickLayoutBody } from './layout-shape'
import { formatPanesSetting, parseEisenhowerSource, readPanesSetting } from './eisenhower-shape'
import { formatCheckinFilterSetting, readCheckinFilterSetting } from './checkin-filter-shape'
import { formatLensesSetting, readLensesSetting } from './lens-shape'
import { LENS_ID_MAX } from '../utils/lens'
import { isValidEmail, normalizeEmail } from '../utils/person'

const VALID_RECURRENCE_TYPES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']

function isOptRecurrenceRule(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!isRecord(v)) return false
  if (typeof v.type !== 'string' || !VALID_RECURRENCE_TYPES.includes(v.type)) return false
  if ('originalDayOfMonth' in v && v.originalDayOfMonth !== undefined) {
    if (typeof v.originalDayOfMonth !== 'number' || v.originalDayOfMonth < 1 || v.originalDayOfMonth > 31) return false
  }
  return true
}
import type { SettingRow } from './database'
import { DATA_TABLE_NAMES, type DataTableArrays, type DataTableName, type DataTableRows } from './tables'
import { isValidCssColor } from '../utils/css'
import { parseColorSettingKey } from '../models/theme-colors'
import { isRecord } from '../utils/is-record'

// --- Field helpers ---

function isStr(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen
}

/**
 * The length limit for notes (a task's and the workspace note): none beyond
 * the file-size cap. Nothing limits them where they are written (the notes
 * editor takes any paste; a check-in reply can replace a task's notes), and a
 * lower limit here made every export, backup and sync file holding a longer
 * note fail to import.
 */
const NOTES_MAX_CHARS = Number.POSITIVE_INFINITY

/**
 * The length limit for person / tag / status / list names: none beyond the
 * file-size cap. The editors take any length and `@name` / `#tag` create
 * names from Quick Add and notes, so a lower limit here made every export,
 * backup and sync file holding a longer name fail to import. A name must
 * still be a non-empty string.
 */
const NAME_MAX_CHARS = Number.POSITIVE_INFINITY

/**
 * The length limit for task titles: none beyond the file-size cap. Most
 * title inputs stop at 500 characters, but converting a note line can make
 * a longer title (a line whose tokens fill the parser's 500-character window
 * keeps the whole line), and a lower limit here made every export, backup
 * and sync file holding one fail to import. A title must still be a
 * non-empty string.
 */
const TITLE_MAX_CHARS = Number.POSITIVE_INFINITY

function isOptStr(v: unknown, maxLen: number): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= maxLen)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isOptNum(v: unknown): boolean {
  return v === undefined || v === null || isFiniteNum(v)
}

/**
 * A row's primary key: absent (the database numbers it), or a whole number
 * from 1 — what the database gives. A string or fractional id would be
 * stored as a key no join matches.
 */
function isOptId(v: unknown): boolean {
  return v === undefined || v === null || (Number.isSafeInteger(v) && (v as number) >= 1)
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

function isDateLike(v: unknown): boolean {
  if (v instanceof Date) return !isNaN(v.getTime())
  if (typeof v === 'string') return !isNaN(Date.parse(v))
  return false
}

function isOptDateLike(v: unknown): boolean {
  return v === undefined || v === null || isDateLike(v)
}

// --- Per-model validators ---

type CheckResult = true | string

function checkFields(v: unknown, checks: Array<[string, boolean]>): CheckResult {
  if (!isRecord(v)) return 'not an object'
  for (const [field, ok] of checks) {
    if (!ok) return field
  }
  return true
}

function isOptColor(v: unknown): boolean {
  return v === undefined || v === null || isValidCssColor(v)
}

function checkTodo(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['uid', isStr(v.uid, 200)],
    ['title', isStr(v.title, TITLE_MAX_CHARS)],
    ['notes', isOptStr(v.notes, NOTES_MAX_CHARS)],
    ['progress', isOptStr(v.progress, 500)],
    ['isCompleted', isBool(v.isCompleted)],
    ['completedAt', isOptDateLike(v.completedAt)],
    ['dueDate', isOptDateLike(v.dueDate)],
    ['lastFollowupAt', isOptDateLike(v.lastFollowupAt)],
    ['nextFollowupAt', isOptDateLike(v.nextFollowupAt)],
    ['recurrenceRule', isOptRecurrenceRule(v.recurrenceRule)],
    ['focus', isOptTriBool(v.focus)],
    ['urgent', isOptTriBool(v.urgent)],
    ['important', isOptTriBool(v.important)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['statusId', isOptNum(v.statusId)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

const VALID_LIST_MEMBERSHIP_KINDS = ['custom']

function isOptTriBool(v: unknown): boolean {
  return v === undefined || v === null || isBool(v)
}

function isValidMembership(m: unknown): boolean {
  if (!isRecord(m) || typeof m.kind !== 'string') return false
  if (!VALID_LIST_MEMBERSHIP_KINDS.includes(m.kind)) return false
  if (m.kind === 'custom') {
    return checkPredicateShape(m.predicate) === true
  }
  return false
}

function isValidSort(s: unknown): boolean {
  return typeof s === 'string' && isTodoSortBy(s)
}

function isValidGrouping(g: unknown): boolean {
  return typeof g === 'string' && isTodoGroupBy(g)
}

const VALID_RUNTIME_FILTER_FIELDS: readonly RuntimeFilterField[] = ['person', 'status', 'tag']

function isOptRuntimeFilter(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!isRecord(v)) return false
  if (typeof v.field !== 'string' || !(VALID_RUNTIME_FILTER_FIELDS as readonly string[]).includes(v.field)) return false
  if (!isOptStr(v.label, 100)) return false
  return true
}

function checkListDefinition(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['name', isStr(v.name, NAME_MAX_CHARS)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['membership', isValidMembership(v.membership)],
    ['sort', isValidSort(v.sort)],
    ['grouping', isValidGrouping(v.grouping)],
    ['runtimeFilter', isOptRuntimeFilter(v.runtimeFilter)],
  ])
}

function isOptStatusIcon(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && (STATUS_ICON_KEYS as readonly string[]).includes(v))
}

function checkStatus(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['name', isStr(v.name, NAME_MAX_CHARS)],
    ['color', isValidCssColor(v.color)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['icon', isOptStatusIcon(v.icon)],
  ])
}

function checkPerson(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['name', isStr(v.name, NAME_MAX_CHARS)],
    ['initials', isStr(v.initials, 4)],
    ['color', isOptColor(v.color)],
    // `email` is not checked: one that isn't a single valid address is
    // dropped by `pickPerson` (see `personEmail`), with a warning.
  ])
}

function checkTag(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['name', isStr(v.name, NAME_MAX_CHARS)],
    ['color', isValidCssColor(v.color)],
  ])
}

function checkTodoTag(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['todoId', isFiniteNum(v.todoId)],
    ['tagId', isFiniteNum(v.tagId)],
  ])
}

function checkListOrder(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['listDefinitionId', isFiniteNum(v.listDefinitionId)],
    ['todoId', isFiniteNum(v.todoId)],
    ['rank', isFiniteNum(v.rank)],
  ])
}

function checkTodoPerson(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['todoId', isFiniteNum(v.todoId)],
    ['personId', isFiniteNum(v.personId)],
  ])
}

function checkNote(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['content', typeof v.content === 'string' && (v.content as string).length <= NOTES_MAX_CHARS],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
  ])
}

const VALID_TODO_EVENT_TYPES: readonly TodoEventType[] = [
  'created', 'scheduled', 'deadline', 'status', 'completed', 'reopened',
]

function isOptScalarValue(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
}

function checkTodoEvent(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptId(v.id)],
    ['todoId', isFiniteNum(v.todoId)],
    ['type', typeof v.type === 'string' && (VALID_TODO_EVENT_TYPES as readonly string[]).includes(v.type)],
    ['fromValue', isOptScalarValue(v.fromValue)],
    ['toValue', isOptScalarValue(v.toValue)],
    ['timestamp', typeof v.timestamp === 'string' && !isNaN(Date.parse(v.timestamp))],
  ])
}

function checkLayout(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  const fields = checkFields(v, [
    ['id', isOptId(v.id)],
    ['name', isStr(v.name, LAYOUT_NAME_MAX) && (v.name as string).trim().length > 0],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['lastUsedAt', isOptDateLike(v.lastUsedAt)],
    ['lensId', v.lensId === undefined || isLensId(v.lensId)],
    ['activeColumnId', v.activeColumnId === undefined || isId(v.activeColumnId)],
    ['hue', v.hue === undefined || isHueName(v.hue)],
  ])
  if (fields !== true) return fields
  return checkLayoutBody(v)
}

/**
 * A layout's lens pick as stored: a lens id's shape (whether a lens has it
 * is read where the pick is used — an id no lens has is No lens).
 */
/** A layout's lens pick as stored: a lens id (a short string); `data/draft-storage` reads one too. */
export function isLensId(v: unknown): v is string {
  return isStr(v, LENS_ID_MAX)
}

const VALID_SETTING_KEYS: readonly string[] = ALL_SETTING_KEYS

const SETTING_VALUE_MAX_LEN = 200

/**
 * Whether `key` is a recognized settings row key. Theme color rows are
 * `color.dark.<name>` / `color.light.<name>` with `<name>` one of the theme
 * colours (`parseColorSettingKey`); any other `color.*` key is unrecognized,
 * like an unknown key (dropped on import with a warning).
 *
 * Used by the audit pass (`src/data/audit.ts`) to detect unrecognized
 * settings rows on a forced cross-floor load.
 */
export function isKnownSettingKey(key: string): boolean {
  return VALID_SETTING_KEYS.includes(key) || parseColorSettingKey(key) !== null
}

/** `checkSetting` result for a well-formed row whose key this build doesn't know. */
const UNRECOGNIZED_SETTING_KEY = 'key (unrecognized)'

function checkSetting(v: unknown): CheckResult {
  if (!isRecord(v)) return 'not an object'
  if (!isStr(v.key, 100)) return 'key'
  if (typeof v.value !== 'string') return 'value'
  // Checked before the length cap so an unrecognized key is always reported
  // as such — `validateImportData` drops those rows instead of failing.
  if (!isKnownSettingKey(v.key as string)) return UNRECOGNIZED_SETTING_KEY
  // Keyboard shortcuts: any text — the picker keeps only the bindings it can
  // read and resets an over-long text unread (`settingFixes` names what it
  // drops, a few at most), so what is stored is short.
  if (v.key === SETTING_KEYS.keyboardShortcuts) return true
  // The Eisenhower panes: any text, as the panes were layout data the
  // layout repair fixed rather than failed — the picker keeps the panes it
  // can read and resets the rest (an unreadable or over-long value reads as
  // the defaults); `settingFixes` names what it drops. Names and filters
  // have no length limit (the whole value has one: `PANES_SETTING_MAX_LEN`).
  if (v.key === SETTING_KEYS.eisenhowerPanes) return true
  // The check-in filter: any text, read leniently as a list's filter is
  // (`readCheckinFilterSetting`; `settingFixes` names what it drops). Its id
  // lists have no limit of their own (the whole value has one).
  if (v.key === SETTING_KEYS.checkinTaskFilter) return true
  // The lenses: any text, read leniently as the Eisenhower panes are
  // (`readLensesSetting`; `settingFixes` names what it drops). Their
  // filters' id lists have no limit of their own (the whole value has one).
  if (v.key === SETTING_KEYS.lenses) return true
  if ((v.value as string).length > SETTING_VALUE_MAX_LEN) return 'value'
  if (typeof v.key === 'string' && v.key.startsWith('color.')) {
    return isValidCssColor(v.value) ? true : 'value (invalid color)'
  }
  if (
    v.key === SETTING_KEYS.defaultStatusId ||
    v.key === SETTING_KEYS.quickStatusId ||
    v.key === SETTING_KEYS.seededAssignedStatusId ||
    v.key === SETTING_KEYS.activeLayoutId
  ) {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : `value (${v.key} must be numeric)`
  }
  if (v.key === SETTING_KEYS.completedRetentionDays) {
    const n = Number(v.value)
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? true : 'value (retention days out of range)'
  }
  if (v.key === SETTING_KEYS.weekStartsOn) {
    const n = Number(v.value)
    return n === 0 || n === 1 ? true : 'value (weekStartsOn must be 0 or 1)'
  }
  if (v.key === SETTING_KEYS.followupDefaultInterval) {
    return parseFollowupInterval(v.value as string)
      ? true
      : 'value (followupDefaultInterval must look like 3d, 2w, 1m or 1y)'
  }
  if (v.key === SETTING_KEYS.urgentDueWithinDays) {
    return parseUrgentDueWithinDays(v.value as string) !== undefined
      ? true
      : 'value (urgentDueWithinDays must be off or a day count 0–365)'
  }
  if (v.key === SETTING_KEYS.hotRule) {
    return parseHotRule(v.value as string) !== undefined
      ? true
      : 'value (hotRule must be a list of lines, each with at least one of urgent / important / focus)'
  }
  if (v.key === SETTING_KEYS.checkinOpenMethod) {
    return isCheckinOpenMethod(v.value) ? true : 'value (checkinOpenMethod must be mailto or eml)'
  }
  if (v.key === SETTING_KEYS.newListSort) {
    return isTodoSortBy(v.value) ? true : 'value (newListSort must be a list sort)'
  }
  if (v.key === SETTING_KEYS.newListSortDirection) {
    return isTodoSortDirection(v.value) ? true : 'value (newListSortDirection must be asc or desc)'
  }
  if (v.key === SETTING_KEYS.newListGroup) {
    return isTodoGroupBy(v.value) ? true : 'value (newListGroup must be a list grouping)'
  }
  if (v.key === SETTING_KEYS.purgePromptIntervalDays) {
    return parsePurgePromptIntervalDays(v.value as string) !== undefined
      ? true
      : 'value (purgePromptIntervalDays must be a day count 1–365)'
  }
  if (v.key === SETTING_KEYS.purgePromptLastAt) {
    return isDateLike(v.value) ? true : 'value (purgePromptLastAt must be a date)'
  }
  if (v.key === SETTING_KEYS.rowDensity) {
    return isRowDensity(v.value) ? true : 'value (rowDensity must be comfortable or compact)'
  }
  if (v.key === SETTING_KEYS.staleAfterDays) {
    return parseStaleAfterDays(v.value as string) !== undefined
      ? true
      : 'value (staleAfterDays must be a day count 0–365)'
  }
  if (v.key === SETTING_KEYS.lensPresetsSeeded) {
    return v.value === 'true' ? true : 'value (lensPresetsSeeded must be true)'
  }
  if (v.key === SETTING_KEYS.newTaskFollowup) {
    return v.value === 'true' || v.value === 'false' ? true : 'value (newTaskFollowup must be true or false)'
  }
  if (v.key === SETTING_KEYS.eisenhowerSource) {
    return parseEisenhowerSource(v.value as string) !== undefined
      ? true
      : 'value (eisenhowerSource must be all or list:<id>)'
  }
  return true
}

// --- Record reconstruction (strip unknown keys from parsed JSON) ---

/**
 * Every key of `T`, optional ones included. Each `pick*` builds its row as an
 * object literal that `satisfies AllFields<Model>`, so adding a field to a
 * model without carrying it through restore is a **compile error** (and an
 * unknown key is one too) — the field-coverage guard. Optional
 * fields the source row lacks are set to `undefined` and dropped by
 * `compactRow`.
 */
type AllFields<T> = { [K in keyof Required<T>]: T[K] }

/** Drops `undefined`-valued keys, so absent optional fields stay absent. */
function compactRow<T>(row: AllFields<T>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

type Raw = Record<string, unknown>

const optNum = (v: unknown): number | undefined => (v != null ? v as number : undefined)
const optStr = (v: unknown): string | undefined => (v != null ? v as string : undefined)

/**
 * A task's repeat rule rebuilt from its known keys (`checkTodo` vetted the
 * type and day of month); stray keys go, as at the row level.
 */
function pickRecurrenceRule(v: unknown): RecurrenceRule | undefined {
  if (!isRecord(v)) return undefined
  return compactRow<RecurrenceRule>({
    type: v.type as RecurrenceType,
    originalDayOfMonth: typeof v.originalDayOfMonth === 'number' ? v.originalDayOfMonth : undefined,
  } satisfies AllFields<RecurrenceRule>)
}

function pickTodo(v: Raw): AllFields<TodoItem> {
  return {
    id: optNum(v.id), uid: v.uid as string, title: v.title as string,
    isCompleted: v.isCompleted as boolean,
    completedAt: toOptDate(v.completedAt),
    createdAt: toDate(v.createdAt), modifiedAt: toDate(v.modifiedAt), sortOrder: v.sortOrder as number,
    notes: optStr(v.notes),
    progress: optStr(v.progress),
    dueDate: toOptDate(v.dueDate),
    lastFollowupAt: toOptDate(v.lastFollowupAt),
    nextFollowupAt: toOptDate(v.nextFollowupAt),
    recurrenceRule: pickRecurrenceRule(v.recurrenceRule),
    // Only `true` is stored; `false` / absent both mean "not in focus".
    focus: v.focus === true ? true : undefined,
    urgent: v.urgent === true ? true : undefined,
    important: v.important === true ? true : undefined,
    statusId: optNum(v.statusId),
  } satisfies AllFields<TodoItem>
}

function pickStatus(v: Raw): AllFields<Status> {
  // `icon` already validated by `checkStatus` -> `isOptStatusIcon`; the cast
  // narrows the validated string to the StatusIconKey union.
  return {
    id: optNum(v.id), name: v.name as string, color: v.color as string, sortOrder: v.sortOrder as number,
    icon: v.icon != null ? v.icon as StatusIconKey : undefined,
  } satisfies AllFields<Status>
}

/**
 * A person row's email as stored: trimmed, absent when empty, and dropped
 * when it isn't one valid address (`isValidEmail`) — a `,` or `;` in it
 * would add recipients to a check-in email. `dropped` when there was one.
 */
function personEmail(v: unknown): { email: string | undefined; dropped: boolean } {
  if (v === undefined || v === null) return { email: undefined, dropped: false }
  const email = typeof v === 'string' ? normalizeEmail(v) : undefined
  if (email === undefined) return { email: undefined, dropped: typeof v !== 'string' }
  return isValidEmail(email) ? { email, dropped: false } : { email: undefined, dropped: true }
}

function pickPerson(v: Raw): AllFields<Person> {
  return {
    id: optNum(v.id), name: v.name as string, initials: v.initials as string,
    color: optStr(v.color),
    email: personEmail(v.email).email,
  } satisfies AllFields<Person>
}

function pickTag(v: Raw): AllFields<Tag> {
  return { id: optNum(v.id), name: v.name as string, color: v.color as string } satisfies AllFields<Tag>
}

function pickTodoTag(v: Raw): AllFields<TodoTag> {
  return { id: optNum(v.id), todoId: v.todoId as number, tagId: v.tagId as number } satisfies AllFields<TodoTag>
}

function pickListOrder(v: Raw): AllFields<ListOrder> {
  return {
    id: optNum(v.id),
    listDefinitionId: v.listDefinitionId as number,
    todoId: v.todoId as number,
    rank: v.rank as number,
  } satisfies AllFields<ListOrder>
}

function pickTodoPerson(v: Raw): AllFields<TodoPerson> {
  return { id: optNum(v.id), todoId: v.todoId as number, personId: v.personId as number } satisfies AllFields<TodoPerson>
}

function pickSetting(v: Raw): AllFields<SettingRow> {
  const key = v.key as string
  const value = v.value as string
  if (key === SETTING_KEYS.keyboardShortcuts) {
    // Only the bindings that read, pass the rules and don't clash.
    return { key, value: formatShortcutOverrides(readShortcutOverrides(value).overrides) } satisfies AllFields<SettingRow>
  }
  if (key === SETTING_KEYS.eisenhowerPanes) {
    // Stored normalised: known panes and keys only, what equals the default left out.
    return { key, value: formatPanesSetting(readPanesSetting(value).panes) } satisfies AllFields<SettingRow>
  }
  if (key === SETTING_KEYS.checkinTaskFilter) {
    // Stored rebuilt: known filter parts only, no people, completed tasks off.
    return { key, value: formatCheckinFilterSetting(readCheckinFilterSetting(value).filter) } satisfies AllFields<SettingRow>
  }
  if (key === SETTING_KEYS.lenses) {
    // Stored rebuilt: the readable lenses, their known filter parts, completed tasks off.
    return { key, value: formatLensesSetting(readLensesSetting(value).lenses) } satisfies AllFields<SettingRow>
  }
  // The Hot rule is stored normalized (duplicate lines collapsed).
  const hotRule = key === SETTING_KEYS.hotRule ? parseHotRule(value) : undefined
  return { key, value: hotRule ? formatHotRule(hotRule) : value } satisfies AllFields<SettingRow>
}

/** What `pickSetting` drops from a valid settings row, in words. */
function settingFixes(row: Raw): string[] {
  if (typeof row.value !== 'string') return []
  if (row.key === SETTING_KEYS.keyboardShortcuts) return readShortcutOverrides(row.value).dropped
  if (row.key === SETTING_KEYS.eisenhowerPanes) return readPanesSetting(row.value).fixes
  if (row.key === SETTING_KEYS.checkinTaskFilter) return readCheckinFilterSetting(row.value).fixes
  if (row.key === SETTING_KEYS.lenses) return readLensesSetting(row.value).fixes
  return []
}

/** How an import warning names a settings row `pickSetting` fixed. */
function settingLabel(row: Raw): string {
  if (row.key === SETTING_KEYS.eisenhowerPanes) return 'Eisenhower panes'
  if (row.key === SETTING_KEYS.checkinTaskFilter) return 'check-in filter'
  if (row.key === SETTING_KEYS.lenses) return 'lenses'
  return 'keyboard shortcuts'
}

function pickNote(v: Raw): AllFields<Note> {
  return {
    id: optNum(v.id),
    content: v.content as string,
    createdAt: toDate(v.createdAt),
    modifiedAt: toDate(v.modifiedAt),
  } satisfies AllFields<Note>
}

/**
 * A layout's name as stored: trimmed, at most `LAYOUT_NAME_MAX` long; a
 * missing or blank one becomes `Layout`. `fix` names what changed, for a name
 * `checkLayout` rejects (only the audit picks such a row).
 */
function layoutName(v: unknown): { name: string; fix?: string } {
  if (isStr(v, LAYOUT_NAME_MAX) && v.trim().length > 0) return { name: v }
  const trimmed = typeof v === 'string' ? v.trim() : ''
  if (trimmed.length === 0) return { name: 'Layout', fix: 'name reset' }
  return { name: trimmed.slice(0, LAYOUT_NAME_MAX), fix: 'name shortened' }
}

/**
 * What `pickLayout` drops or resets in a `layouts` row, in words; empty for a
 * row that passes `checkLayout` (but for parts past `LAYOUT_PART_LIMIT`,
 * which import drops with a warning). Import rejects such rows; the audit
 * repairs a stored one with `pickLayout` instead of deleting it.
 */
function layoutFixes(v: Raw): string[] {
  const fixes: string[] = []
  const name = layoutName(v.name).fix
  if (name) fixes.push(name)
  if (!isFiniteNum(v.sortOrder)) fixes.push('order reset')
  if (!isDateLike(v.createdAt) || !isDateLike(v.modifiedAt) || !isOptDateLike(v.lastUsedAt)) fixes.push('dates reset')
  if (v.lensId !== undefined && !isLensId(v.lensId)) fixes.push('lens reset')
  if (v.activeColumnId !== undefined && !isId(v.activeColumnId)) fixes.push('phone column reset')
  if (v.hue !== undefined && !isHueName(v.hue)) fixes.push('hue reset')
  return [...fixes, ...pickLayoutBody(v).fixes]
}

/**
 * The order a layout without a readable one gets when repaired: after every
 * other layout (the picker orders such layouts by creation).
 */
const LAYOUT_ORDER_RESET = Number.MAX_SAFE_INTEGER

function pickLayout(v: Raw): AllFields<WorkspaceLayout> {
  // Lenient past `checkLayout` (bad dates → now, a bad last use → none, a bad
  // order → last), so the audit can repair a stored row with it; see `layoutFixes`.
  const now = new Date()
  const body = pickLayoutBody(v)
  return {
    id: optNum(v.id),
    name: layoutName(v.name).name,
    sortOrder: isFiniteNum(v.sortOrder) ? v.sortOrder : LAYOUT_ORDER_RESET,
    columns: body.columns,
    top: body.top,
    bottom: body.bottom,
    createdAt: isDateLike(v.createdAt) ? toDate(v.createdAt) : now,
    modifiedAt: isDateLike(v.modifiedAt) ? toDate(v.modifiedAt) : now,
    lastUsedAt: isDateLike(v.lastUsedAt) ? toDate(v.lastUsedAt) : undefined,
    lensId: isLensId(v.lensId) ? v.lensId : undefined,
    activeColumnId: isId(v.activeColumnId) ? v.activeColumnId : undefined,
    hue: isHueName(v.hue) ? v.hue : undefined,
  } satisfies AllFields<WorkspaceLayout>
}

function pickTodoEvent(v: Raw): AllFields<TodoEvent> {
  return {
    id: optNum(v.id),
    todoId: v.todoId as number,
    type: v.type as TodoEventType,
    fromValue: (v.fromValue ?? null) as string | number | null,
    toValue: (v.toValue ?? null) as string | number | null,
    timestamp: v.timestamp as string,
  } satisfies AllFields<TodoEvent>
}

function pickRuntimeFilter(v: unknown): RuntimeFilterSpec | undefined {
  if (!isRecord(v)) return undefined
  const field = v.field
  if (typeof field !== 'string' || !(VALID_RUNTIME_FILTER_FIELDS as readonly string[]).includes(field)) return undefined
  return compactRow<RuntimeFilterSpec>({
    field: field as RuntimeFilterField,
    label: typeof v.label === 'string' ? v.label : undefined,
  } satisfies AllFields<RuntimeFilterSpec>)
}

/**
 * A list's owner rebuilt from its known keys: one layout (`layoutId`, a
 * positive whole number) or the Eisenhower (`eisenhower: true`), each its
 * only key; anything else is none (a list that belongs to no layout, which
 * the audit reports).
 */
function pickListOwner(v: unknown): ListOwner | undefined {
  if (!isRecord(v) || Object.keys(v).length !== 1) return undefined
  if (typeof v.layoutId === 'number' && Number.isSafeInteger(v.layoutId) && v.layoutId > 0) return { layoutId: v.layoutId }
  if (v.eisenhower === true) return { eisenhower: true }
  return undefined
}

/**
 * What import drops from a valid list row, in words. A sort direction, an
 * owner or a filter-line switch this build doesn't know is dropped (the list
 * sorts in its natural order / belongs to no layout / shows its filter line)
 * rather than failing the file; `null` reads as none.
 */
function listDefinitionFixes(row: Raw): string[] {
  const fixes = pickPredicate(isRecord(row.membership) ? row.membership.predicate : undefined).fixes
  const dir = row.sortDirection
  if (dir !== undefined && dir !== null && !isTodoSortDirection(dir)) fixes.push('unknown sort direction dropped')
  if (row.owner !== undefined && row.owner !== null && pickListOwner(row.owner) === undefined) fixes.push('unknown owner dropped')
  const line = row.showFilterLine
  if (line !== undefined && line !== null && typeof line !== 'boolean') fixes.push('unknown filter line setting dropped')
  return fixes
}

function pickListDefinition(v: Raw): AllFields<ListDefinition> {
  return {
    id: optNum(v.id),
    name: v.name as string,
    sortOrder: v.sortOrder as number,
    // Rebuilt from known keys; malformed filters / an unknown sort direction dropped (see `rowFixes`).
    membership: { kind: 'custom', predicate: pickPredicate((v.membership as Raw).predicate).predicate },
    sort: v.sort as ListSort,
    sortDirection: isTodoSortDirection(v.sortDirection) ? v.sortDirection : undefined,
    grouping: v.grouping as ListGrouping,
    runtimeFilter: pickRuntimeFilter(v.runtimeFilter),
    owner: pickListOwner(v.owner),
    // Only `false` is stored: shown is the default.
    showFilterLine: v.showFilterLine === false ? false : undefined,
  } satisfies AllFields<ListDefinition>
}

type ImportRow<K extends DataTableName> = DataTableRows[K]

/** Picks + compacts every row of `rows` for table `key`. */
function pickRows<K extends DataTableName>(key: K, rows: unknown): Array<ImportRow<K>> {
  const pick = IMPORT_TABLES[key].pick
  return ((rows ?? []) as Raw[]).map((r) => compactRow<ImportRow<K>>(pick(r)))
}

// --- Main validation ---

export const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
export const MAX_RECORDS_PER_TABLE = 100_000

/** Validated, current-shape rows of every data table — what import restores. */
export type ImportData = DataTableArrays

/** Import's rules for one data table. */
interface ImportTableRules<K extends DataTableName> {
  /** `true` for a row import accepts, else the bad field. */
  check: (v: unknown) => CheckResult
  /**
   * Rebuilds the row from the model's keys. Returns **every** model field as
   * a key (absent optional fields as `undefined`, compacted away by
   * `validateImportData`), so `Object.keys(pick(row))` is the model's full
   * field list — the round-trip test uses it to prove its seed populates
   * every field.
   */
  pick: (v: Raw) => AllFields<ImportRow<K>>
  /** For tables whose valid rows can still carry a part import drops or changes. */
  fixer?: RowFixer
}

interface RowFixer {
  /** What the picker drops / changes in a valid row, in words; empty when nothing. */
  fixes: (row: Raw) => string[]
  /** The import warning's lead for `n` fixed rows. */
  lead: (n: number) => string
  /** How the warning names a row; default its title or name. Empty = the fixes alone. */
  label?: (row: Raw) => string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Per-table import rules, for every table of the registry (`tables.ts`).
 * A `fixer` marks a table whose valid rows can still carry a malformed part
 * that import drops (or shortens) instead of failing the file — data the app
 * may have stored before it checked these parts.
 */
export const IMPORT_TABLES: { readonly [K in DataTableName]: ImportTableRules<K> } = {
  todos: { check: checkTodo, pick: pickTodo },
  people: {
    check: checkPerson,
    pick: pickPerson,
    fixer: {
      fixes: (row) => (personEmail(row.email).dropped ? ['invalid email dropped'] : []),
      lead: (n) => `Fixed ${plural(n, 'person', 'people')}`,
    },
  },
  settings: {
    check: checkSetting,
    pick: pickSetting,
    fixer: { fixes: settingFixes, lead: () => 'Fixed settings', label: settingLabel },
  },
  todoPeople: { check: checkTodoPerson, pick: pickTodoPerson },
  statuses: { check: checkStatus, pick: pickStatus },
  listDefinitions: {
    check: checkListDefinition,
    pick: pickListDefinition,
    fixer: {
      fixes: listDefinitionFixes,
      lead: (n) => `Fixed ${plural(n, 'list', 'lists')}`,
    },
  },
  notes: { check: checkNote, pick: pickNote },
  tags: { check: checkTag, pick: pickTag },
  todoTags: { check: checkTodoTag, pick: pickTodoTag },
  todoEvents: { check: checkTodoEvent, pick: pickTodoEvent },
  layouts: {
    check: checkLayout,
    pick: pickLayout,
    fixer: { fixes: layoutFixes, lead: (n) => `Fixed ${plural(n, 'layout', 'layouts')}` },
  },
  listOrders: { check: checkListOrder, pick: pickListOrder },
}

/**
 * Every IDB object store this build knows: the data tables plus the
 * Dexie-only `backups`, which does not round-trip through import / export.
 * The audit pass's `unknown-table` check uses this to decide whether an
 * existing IDB object store is recognized at all.
 */
export const KNOWN_DB_TABLES: ReadonlySet<string> =
  new Set<string>([...DATA_TABLE_NAMES, 'backups'])

/**
 * Single dispatcher around the per-table `check*` helpers, so the audit pass
 * (`unknown-row` detection) can validate every existing row without
 * duplicating the table registry. Returns `true` on a valid row, or a short
 * error string naming the bad field.
 */
export function validateRow(table: DataTableName, row: unknown): true | string {
  return IMPORT_TABLES[table].check(row)
}

/** Max individual row errors spelled out in a validation failure message. */
export const MAX_REPORTED_ROW_ERRORS = 10

/**
 * What import would drop or change in a row that passes `validateRow`, in
 * words (e.g. `people filter dropped`); empty when nothing. The audit uses
 * it to report rows already stored with such parts.
 */
export function rowFixes(table: DataTableName, row: unknown): string[] {
  const fixer = IMPORT_TABLES[table].fixer
  return fixer && isRecord(row) ? fixer.fixes(row) : []
}

/**
 * `row` as import stores it: rebuilt by the table's picker, so the parts
 * `rowFixes` names are dropped. For a row that passes `validateRow`, or any
 * `layouts` row (its picker repairs what `checkLayout` rejects).
 */
export function sanitizeRow<K extends DataTableName>(table: K, row: unknown): ImportRow<K> {
  return compactRow<ImportRow<K>>(IMPORT_TABLES[table].pick(row as Raw))
}

/** Longest title / name a message quotes; longer ones end in `…`. */
const LABEL_MAX = 60

/** Row label for messages: its title or name, quoted (shortened); empty when it has neither. */
function rowLabel(row: unknown): string {
  const text = isRecord(row) && 'title' in row ? String(row.title) :
               isRecord(row) && 'name' in row ? String(row.name) : undefined
  if (text === undefined) return ''
  return `"${text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX)}…` : text}"`
}

export type ValidateImportResult =
  | { ok: true; data: ImportData; warnings: string[] }
  | { ok: false; error: string }

export interface ValidateImportOptions {
  /**
   * Require a whole database (default true) — the "is this a TODO2
   * database" check for restores: `todos` and `settings` are present
   * (every full export carries both, possibly empty). Appending tasks (task
   * archives) passes false: an archive carries only task tables.
   */
  requireFullDatabase?: boolean
}

/**
 * Validates a whole current-shape dataset (run *after* the schema-upgrade
 * pipeline — see `data/import-pipeline.ts` `prepareImport`) and reconstructs
 * typed rows via the `pick*` whitelist.
 *
 * Strict, with one leniency: a well-formed `settings` row whose key this
 * build doesn't recognize is dropped and reported in `warnings` instead of
 * failing the import. Every other bad row fails it; the error message lists
 * all failing rows (the first `MAX_REPORTED_ROW_ERRORS`, then a count).
 */
export function validateImportData(data: unknown, options: ValidateImportOptions = {}): ValidateImportResult {
  if (!isRecord(data)) {
    return { ok: false, error: 'Import data is not an object' }
  }

  const raw = data as Record<string, unknown>

  if ((options.requireFullDatabase ?? true) && (!Array.isArray(raw.todos) || !Array.isArray(raw.settings))) {
    return { ok: false, error: 'File is not a valid TODO2 database (missing tasks or settings)' }
  }

  const rowErrors: string[] = []
  const droppedSettingKeys: string[] = []
  const droppedSettingIdx = new Set<number>()

  for (const key of DATA_TABLE_NAMES) {
    const { check } = IMPORT_TABLES[key]
    const arr = raw[key]
    if (arr === undefined || arr === null) continue
    if (!Array.isArray(arr)) {
      return { ok: false, error: `"${key}" is not an array` }
    }
    if (arr.length > MAX_RECORDS_PER_TABLE) {
      return { ok: false, error: `"${key}" has too many records (${arr.length}). Maximum is ${MAX_RECORDS_PER_TABLE}.` }
    }
    for (let i = 0; i < arr.length; i++) {
      const row: unknown = arr[i]
      const result = check(row)
      if (result === true) continue
      if (key === 'settings' && result === UNRECOGNIZED_SETTING_KEY && isRecord(row)) {
        droppedSettingIdx.add(i)
        droppedSettingKeys.push(String(row.key))
        continue
      }
      const label = rowLabel(row) === '' ? '' : ` (${rowLabel(row)})`
      rowErrors.push(`Invalid "${key}" record at index ${i}${label}: bad field "${result}"`)
    }
  }

  // Cross-row: primary keys are unique within a table (`bulkAdd` would
  // abort the restore transaction on a repeated one); rows without an id are
  // numbered by the database. Settings rows are keyed by `key` (the rows
  // dropped above as unrecognized aside).
  for (const key of DATA_TABLE_NAMES) {
    const arr = raw[key]
    if (!Array.isArray(arr)) continue
    const firstIndexById = new Map<unknown, number>()
    arr.forEach((row: unknown, i) => {
      if (!isRecord(row)) return
      const id = key === 'settings' ? (droppedSettingIdx.has(i) ? undefined : row.key) : row.id
      if (id === undefined || id === null) return
      const first = firstIndexById.get(id)
      if (first === undefined) {
        firstIndexById.set(id, i)
        return
      }
      const label = rowLabel(row) === '' ? '' : ` (${rowLabel(row)})`
      const what = key === 'settings' ? `duplicate key "${String(id)}"` : `duplicate id ${String(id)}`
      rowErrors.push(`Invalid "${key}" record at index ${i}${label}: ${what} (same as index ${first})`)
    })
  }

  // Cross-row: todo uids are unique (Dexie index `&uid` — a duplicate would
  // abort the restore transaction instead of failing validation cleanly).
  if (Array.isArray(raw.todos)) {
    const firstIndexByUid = new Map<string, number>()
    raw.todos.forEach((row: unknown, i) => {
      if (!isRecord(row) || typeof row.uid !== 'string') return
      const first = firstIndexByUid.get(row.uid)
      if (first === undefined) {
        firstIndexByUid.set(row.uid, i)
        return
      }
      rowErrors.push(`Invalid "todos" record at index ${i} ("${String(row.title)}"): duplicate uid (same as index ${first})`)
    })
  }

  // Cross-row: one rank per (list, task) pair (Dexie index
  // `&[listDefinitionId+todoId]` — a duplicate would abort the restore).
  if (Array.isArray(raw.listOrders)) {
    const firstIndexByPair = new Map<string, number>()
    raw.listOrders.forEach((row: unknown, i) => {
      if (!isRecord(row)) return
      const pair = `${String(row.listDefinitionId)}:${String(row.todoId)}`
      const first = firstIndexByPair.get(pair)
      if (first === undefined) {
        firstIndexByPair.set(pair, i)
        return
      }
      rowErrors.push(`Invalid "listOrders" record at index ${i}: duplicate list + task pair (same as index ${first})`)
    })
  }

  const [firstError] = rowErrors
  if (firstError !== undefined) {
    if (rowErrors.length === 1) return { ok: false, error: firstError }
    const shown = rowErrors.slice(0, MAX_REPORTED_ROW_ERRORS)
    const more = rowErrors.length - shown.length
    return {
      ok: false,
      error: `${rowErrors.length} invalid records: ${shown.join('; ')}${more > 0 ? `; …and ${more} more` : ''}`,
    }
  }

  const warnings: string[] = []
  for (const key of DATA_TABLE_NAMES) {
    const { fixer } = IMPORT_TABLES[key]
    const rows = raw[key]
    if (!fixer || !Array.isArray(rows)) continue
    const fixed: string[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const fixes = fixer.fixes(row)
      if (fixes.length === 0) continue
      const label = fixer.label ? fixer.label(row) : rowLabel(row) || 'unnamed'
      fixed.push(label ? `${label} (${fixes.join(', ')})` : fixes.join(', '))
    }
    if (fixed.length === 0) continue
    const shown = fixed.slice(0, MAX_REPORTED_ROW_ERRORS)
    const more = fixed.length - shown.length
    warnings.push(`${fixer.lead(fixed.length)}: ${shown.join('; ')}${more > 0 ? `; …and ${more} more` : ''}`)
  }
  if (droppedSettingKeys.length > 0) {
    const n = droppedSettingKeys.length
    warnings.push(`Ignored ${n} unrecognized setting${n === 1 ? '' : 's'}: ${droppedSettingKeys.join(', ')}`)
  }
  const settingRows = ((raw.settings ?? []) as Record<string, unknown>[])
    .filter((_, i) => !droppedSettingIdx.has(i))

  const rows = Object.fromEntries(DATA_TABLE_NAMES.map((key) =>
    [key, pickRows(key, key === 'settings' ? settingRows : raw[key])],
  )) as ImportData
  return { ok: true, warnings, data: rows }
}
