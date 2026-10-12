import type { TodoItem, Person, TodoPerson, RecurrenceRule, Status, Note, Tag, TodoTag, TodoEvent, TodoEventType, ListOrder } from '../models'
import { isTodoSortBy, isTodoGroupBy, DATE_FIELD_VALUES } from '../models'

export type ImportTag = Tag
export type ImportTodoTag = TodoTag

import type { ListDefinition, ListMembership, ListSort, ListGrouping, RuntimeFilterField, RuntimeFilterSpec } from '../models/list-definition'
import { toDate, toOptDate } from './date-revive'
import { HOT_MARKERS, MARKER_KEYS, RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { STATUS_ICON_KEYS, type StatusIconKey } from '../models/status'
import { ALL_SETTING_KEYS, SETTING_KEYS } from './setting-keys'
import { parseFollowupInterval } from '../utils/followup'
import { parseUrgentDueWithinDays } from '../utils/urgency'
import { formatHotRule, parseHotRule } from '../utils/hot'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { LAYOUT_NAME_MAX } from '../models/workspace-layout'
import { checkLayoutColumns, pickLayoutColumns } from './layout-shape'
import { normalizeEmail, PERSON_EMAIL_MAX } from '../utils/person'

const VALID_RECURRENCE_TYPES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']

function isOptRecurrenceRule(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!isObj(v)) return false
  if (typeof v.type !== 'string' || !VALID_RECURRENCE_TYPES.includes(v.type)) return false
  if ('originalDayOfMonth' in v && v.originalDayOfMonth !== undefined) {
    if (typeof v.originalDayOfMonth !== 'number' || v.originalDayOfMonth < 1 || v.originalDayOfMonth > 31) return false
  }
  return true
}
import type { SettingRow } from './database'

export { isValidCssColor } from '../utils/css'
import { isValidCssColor } from '../utils/css'

// --- Field helpers ---

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isStr(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen
}

function isOptStr(v: unknown, maxLen: number): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= maxLen)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isOptNum(v: unknown): boolean {
  return v === undefined || v === null || isFiniteNum(v)
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
  if (!isObj(v)) return 'not an object'
  for (const [field, ok] of checks) {
    if (!ok) return field
  }
  return true
}

function isOptColor(v: unknown): boolean {
  return v === undefined || v === null || isValidCssColor(v)
}

function checkTodo(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['uid', isStr(v.uid, 200)],
    ['title', isStr(v.title, 500)],
    ['notes', isOptStr(v.notes, 50000)],
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

function isOptDateAnchor(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!isObj(v)) return false
  if (v.kind === 'fixed') return typeof v.iso === 'string' && isDateLike(v.iso)
  if (v.kind === 'relative') return typeof v.token === 'string' && (RELATIVE_DATE_TOKENS as readonly string[]).includes(v.token)
  if (v.kind === 'offset') return typeof v.days === 'number' && Number.isFinite(v.days)
  return false
}

function isOptTriBool(v: unknown): boolean {
  return v === undefined || v === null || isBool(v)
}

/** A Markers filter: absent / null, `'hot'`, or an object of known markers set to `true`. */
function isOptMarkers(v: unknown): boolean {
  if (v === undefined || v === null || v === HOT_MARKERS) return true
  if (!isObj(v)) return false
  return Object.entries(v).every(([k, val]) => (MARKER_KEYS as readonly string[]).includes(k) && val === true)
}

function isTodoPredicateShape(v: unknown): boolean {
  if (!isObj(v)) return false
  if (typeof v.showCompleted !== 'boolean'
    || typeof v.searchText !== 'string'
    || typeof v.dateRangeIncludeNoDate !== 'boolean') return false
  if (!isOptDateAnchor(v.dateRangeStart)) return false
  if (!isOptDateAnchor(v.dateRangeEnd)) return false
  if (v.dateField !== undefined && !(DATE_FIELD_VALUES as readonly unknown[]).includes(v.dateField)) return false
  if (!isOptTriBool(v.hasDeadline)) return false
  if (!isOptTriBool(v.hasFollowup)) return false
  if (!isOptMarkers(v.markers)) return false
  return true
}

function isValidMembership(m: unknown): boolean {
  if (!isObj(m) || typeof m.kind !== 'string') return false
  if (!VALID_LIST_MEMBERSHIP_KINDS.includes(m.kind)) return false
  if (m.kind === 'custom') {
    return isTodoPredicateShape(m.predicate)
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
  if (!isObj(v)) return false
  if (typeof v.field !== 'string' || !(VALID_RUNTIME_FILTER_FIELDS as readonly string[]).includes(v.field)) return false
  if (!isOptStr(v.label, 100)) return false
  return true
}

function checkListDefinition(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['membership', isValidMembership(v.membership)],
    ['sort', isValidSort(v.sort)],
    ['grouping', isValidGrouping(v.grouping)],
    ['pinnedToDashboard', v.pinnedToDashboard === undefined || isBool(v.pinnedToDashboard)],
    ['maxTasks', v.maxTasks === undefined || (isFiniteNum(v.maxTasks) && (v.maxTasks as number) >= 1 && (v.maxTasks as number) <= 10000)],
    ['limitMode', v.limitMode === undefined || v.limitMode === 'hard' || v.limitMode === 'scroll'],
    ['runtimeFilter', isOptRuntimeFilter(v.runtimeFilter)],
  ])
}

function isOptStatusIcon(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && (STATUS_ICON_KEYS as readonly string[]).includes(v))
}

function checkStatus(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['color', isValidCssColor(v.color)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['icon', isOptStatusIcon(v.icon)],
  ])
}

function checkPerson(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['initials', isStr(v.initials, 4)],
    ['color', isOptColor(v.color)],
    // Any string within the cap: the email shape is the person editor's check.
    ['email', isOptStr(v.email, PERSON_EMAIL_MAX)],
  ])
}

function checkTag(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['color', isValidCssColor(v.color)],
  ])
}

function checkTodoTag(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['tagId', isFiniteNum(v.tagId)],
  ])
}

function checkListOrder(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['id', isOptNum(v.id)],
    ['listDefinitionId', isFiniteNum(v.listDefinitionId)],
    ['todoId', isFiniteNum(v.todoId)],
    ['rank', isFiniteNum(v.rank)],
  ])
}

function checkTodoPerson(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['personId', isFiniteNum(v.personId)],
  ])
}

function checkNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['content', typeof v.content === 'string' && (v.content as string).length <= 500000],
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
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['type', typeof v.type === 'string' && (VALID_TODO_EVENT_TYPES as readonly string[]).includes(v.type)],
    ['fromValue', isOptScalarValue(v.fromValue)],
    ['toValue', isOptScalarValue(v.toValue)],
    ['timestamp', typeof v.timestamp === 'string' && !isNaN(Date.parse(v.timestamp))],
  ])
}

function checkLayout(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const fields = checkFields(v, [
    ['id', isOptNum(v.id)],
    ['name', isStr(v.name, LAYOUT_NAME_MAX) && (v.name as string).trim().length > 0],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['lastUsedAt', isOptDateLike(v.lastUsedAt)],
  ])
  if (fields !== true) return fields
  return checkLayoutColumns(v.columns)
}

const VALID_SETTING_KEYS: readonly string[] = ALL_SETTING_KEYS

const SETTING_VALUE_MAX_LEN = 200

/**
 * Whether `key` is a recognized settings row key. Theme color rows use the
 * `color.dark.<name>` / `color.light.<name>` prefix; the prefix branch
 * accepts any well-formed color row regardless of the `<name>` segment.
 *
 * Used by the audit pass (`src/data/audit.ts`) to detect unrecognized
 * settings rows on a forced cross-floor load.
 */
export function isKnownSettingKey(key: string): boolean {
  return VALID_SETTING_KEYS.includes(key) || key.startsWith('color.')
}

/** `checkSetting` result for a well-formed row whose key this build doesn't know. */
const UNRECOGNIZED_SETTING_KEY = 'key (unrecognized)'

function checkSetting(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  if (!isStr(v.key, 100)) return 'key'
  if (typeof v.value !== 'string') return 'value'
  // Checked before the length cap so an unrecognized key is always reported
  // as such — `validateImportData` drops those rows instead of failing.
  if (!isKnownSettingKey(v.key as string)) return UNRECOGNIZED_SETTING_KEY
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
    recurrenceRule: v.recurrenceRule != null ? v.recurrenceRule as RecurrenceRule : undefined,
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

function pickPerson(v: Raw): AllFields<Person> {
  return {
    id: optNum(v.id), name: v.name as string, initials: v.initials as string,
    color: optStr(v.color),
    email: normalizeEmail(optStr(v.email)),
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
  // The Hot rule is stored normalized (duplicate lines collapsed).
  const hotRule = key === SETTING_KEYS.hotRule ? parseHotRule(value) : undefined
  return { key, value: hotRule ? formatHotRule(hotRule) : value } satisfies AllFields<SettingRow>
}

function pickNote(v: Raw): AllFields<Note> {
  return {
    id: optNum(v.id),
    content: v.content as string,
    createdAt: toDate(v.createdAt),
    modifiedAt: toDate(v.modifiedAt),
  } satisfies AllFields<Note>
}

function pickLayout(v: Raw): AllFields<WorkspaceLayout> {
  return {
    id: optNum(v.id),
    name: v.name as string,
    columns: pickLayoutColumns(v.columns),
    createdAt: toDate(v.createdAt),
    modifiedAt: toDate(v.modifiedAt),
    lastUsedAt: toOptDate(v.lastUsedAt),
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
  if (!isObj(v)) return undefined
  const field = v.field
  if (typeof field !== 'string' || !(VALID_RUNTIME_FILTER_FIELDS as readonly string[]).includes(field)) return undefined
  return compactRow<RuntimeFilterSpec>({
    field: field as RuntimeFilterField,
    label: typeof v.label === 'string' ? v.label : undefined,
  } satisfies AllFields<RuntimeFilterSpec>)
}

function pickListDefinition(v: Raw): AllFields<ListDefinition> {
  return {
    id: optNum(v.id),
    name: v.name as string,
    sortOrder: v.sortOrder as number,
    membership: v.membership as ListMembership,
    sort: v.sort as ListSort,
    grouping: v.grouping as ListGrouping,
    pinnedToDashboard: typeof v.pinnedToDashboard === 'boolean' ? v.pinnedToDashboard : true,
    maxTasks: typeof v.maxTasks === 'number' ? v.maxTasks : undefined,
    limitMode: v.limitMode === 'hard' || v.limitMode === 'scroll' ? v.limitMode : undefined,
    runtimeFilter: pickRuntimeFilter(v.runtimeFilter),
  } satisfies AllFields<ListDefinition>
}

type ImportRow<K extends keyof ImportData> = NonNullable<ImportData[K]>[number]

/**
 * Table → row picker. Each returns the row with **every** model field as a
 * key (absent optional fields as `undefined`, compacted away by
 * `validateImportData`), so `Object.keys(IMPORT_ROW_PICKERS[t](row))` is the
 * model's full field list — the round-trip test uses it to prove its seed
 * populates every field.
 */
export const IMPORT_ROW_PICKERS: { readonly [K in keyof ImportData]-?: (v: Raw) => AllFields<ImportRow<K>> } = {
  todos: pickTodo,
  people: pickPerson,
  tags: pickTag,
  todoTags: pickTodoTag,
  todoPeople: pickTodoPerson,
  settings: pickSetting,
  statuses: pickStatus,
  listDefinitions: pickListDefinition,
  notes: pickNote,
  todoEvents: pickTodoEvent,
  layouts: pickLayout,
  listOrders: pickListOrder,
}

/** Picks + compacts every row of `rows` for table `key`. */
function pickRows<K extends keyof ImportData>(key: K, rows: unknown): Array<ImportRow<K>> {
  const pick = IMPORT_ROW_PICKERS[key] as (v: Raw) => AllFields<ImportRow<K>>
  return ((rows ?? []) as Raw[]).map((r) => compactRow<ImportRow<K>>(pick(r)))
}

// --- Main validation ---

export const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_RECORDS_PER_TABLE = 100_000

type TableValidator = { key: keyof ImportData; check: (v: unknown) => CheckResult }

const TABLE_VALIDATORS: TableValidator[] = [
  { key: 'todos', check: checkTodo },
  { key: 'people', check: checkPerson },
  { key: 'tags', check: checkTag },
  { key: 'todoTags', check: checkTodoTag },
  { key: 'todoPeople', check: checkTodoPerson },
  { key: 'settings', check: checkSetting },
  { key: 'statuses', check: checkStatus },
  { key: 'listDefinitions', check: checkListDefinition },
  { key: 'notes', check: checkNote },
  { key: 'todoEvents', check: checkTodoEvent },
  { key: 'layouts', check: checkLayout },
  { key: 'listOrders', check: checkListOrder },
]

const TABLE_VALIDATOR_BY_KEY: ReadonlyMap<keyof ImportData, (v: unknown) => CheckResult> =
  new Map(TABLE_VALIDATORS.map((t) => [t.key, t.check]))

export interface ImportData {
  todos: TodoItem[]
  people: Person[]
  tags?: ImportTag[]
  todoTags?: ImportTodoTag[]
  todoPeople: TodoPerson[]
  settings: SettingRow[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Note[]
  todoEvents: TodoEvent[]
  layouts: WorkspaceLayout[]
  listOrders: ListOrder[]
}

/**
 * Canonical list of importable table keys. Drives the audit pass's per-table
 * row-validation walk (`unknown-row` issues) and is the inner set used to
 * derive `KNOWN_DB_TABLES`.
 */
export const KNOWN_TABLE_KEYS: ReadonlyArray<keyof ImportData> =
  TABLE_VALIDATORS.map((t) => t.key)

/**
 * Superset of `KNOWN_TABLE_KEYS` that also includes Dexie-only tables which
 * do not round-trip through import/export (`backups`). The audit pass's
 * `unknown-table` check uses this to decide whether an existing IDB object
 * store is recognized at all.
 */
export const KNOWN_DB_TABLES: ReadonlySet<string> =
  new Set<string>([...KNOWN_TABLE_KEYS, 'backups'])

/**
 * Single dispatcher around the per-table `check*` helpers, so the audit pass
 * (`unknown-row` detection) can validate every existing row without
 * duplicating the table registry. Returns `true` on a valid row, or a short
 * error string naming the bad field.
 */
export function validateRow(table: keyof ImportData, row: unknown): true | string {
  const check = TABLE_VALIDATOR_BY_KEY.get(table)
  if (!check) return `unknown table: ${table}`
  return check(row)
}

/** Max individual row errors spelled out in a validation failure message. */
export const MAX_REPORTED_ROW_ERRORS = 10

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
  if (!isObj(data)) {
    return { ok: false, error: 'Import data is not an object' }
  }

  const raw = data as Record<string, unknown>

  if ((options.requireFullDatabase ?? true) && (!Array.isArray(raw.todos) || !Array.isArray(raw.settings))) {
    return { ok: false, error: 'File is not a valid TODO2 database (missing tasks or settings)' }
  }

  const rowErrors: string[] = []
  const droppedSettingKeys: string[] = []
  const droppedSettingIdx = new Set<number>()

  for (const { key, check } of TABLE_VALIDATORS) {
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
      if (key === 'settings' && result === UNRECOGNIZED_SETTING_KEY && isObj(row)) {
        droppedSettingIdx.add(i)
        droppedSettingKeys.push(String(row.key))
        continue
      }
      const label = isObj(row) && 'title' in row ? ` ("${String(row.title)}")` :
                    isObj(row) && 'name' in row ? ` ("${String(row.name)}")` : ''
      rowErrors.push(`Invalid "${key}" record at index ${i}${label}: bad field "${result}"`)
    }
  }

  // Cross-row: todo uids are unique (Dexie index `&uid` — a duplicate would
  // abort the restore transaction instead of failing validation cleanly).
  if (Array.isArray(raw.todos)) {
    const firstIndexByUid = new Map<string, number>()
    raw.todos.forEach((row: unknown, i) => {
      if (!isObj(row) || typeof row.uid !== 'string') return
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
      if (!isObj(row)) return
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
  if (droppedSettingKeys.length > 0) {
    const n = droppedSettingKeys.length
    warnings.push(`Ignored ${n} unrecognized setting${n === 1 ? '' : 's'}: ${droppedSettingKeys.join(', ')}`)
  }
  const settingRows = ((raw.settings ?? []) as Record<string, unknown>[])
    .filter((_, i) => !droppedSettingIdx.has(i))

  return {
    ok: true,
    warnings,
    data: {
      todos: pickRows('todos', raw.todos),
      people: pickRows('people', raw.people),
      ...(Array.isArray(raw.tags) && raw.tags.length > 0 ? { tags: pickRows('tags', raw.tags) } : {}),
      ...(Array.isArray(raw.todoTags) && raw.todoTags.length > 0 ? { todoTags: pickRows('todoTags', raw.todoTags) } : {}),
      todoPeople: pickRows('todoPeople', raw.todoPeople),
      settings: pickRows('settings', settingRows),
      statuses: pickRows('statuses', raw.statuses),
      listDefinitions: pickRows('listDefinitions', raw.listDefinitions),
      notes: pickRows('notes', raw.notes),
      todoEvents: pickRows('todoEvents', raw.todoEvents),
      layouts: pickRows('layouts', raw.layouts),
      listOrders: pickRows('listOrders', raw.listOrders),
    },
  }
}
