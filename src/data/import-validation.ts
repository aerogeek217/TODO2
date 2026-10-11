import type { TodoItem, Project, ProjectGroupBy, Canvas, Person, TodoPerson, ListInset, RecurrenceRule, TaskboardEntry, Taskboard, Status, Note, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingStatus, Tag, TodoTag, TodoEvent, TodoEventType, ListOrder } from '../models'
import { isTodoSortBy, isTodoGroupBy, DATE_FIELD_VALUES } from '../models'

export type ImportTag = Tag
export type ImportTodoTag = TodoTag

import type { ListDefinition, ListMembership, ListSort, ListGrouping, RuntimeFilterField, RuntimeFilterSpec } from '../models/list-definition'
import { toDate, toOptDate } from './date-revive'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { STATUS_ICON_KEYS, type StatusIconKey } from '../models/status'
import { SLOT_KINDS } from '../models/canvas-rails'
import { ALL_SETTING_KEYS, SETTING_KEYS } from './setting-keys'
import { MAX_CANVAS_RAILS_SETTING_BYTES } from '../constants'
import { parseFollowupInterval } from '../utils/followup'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { LAYOUT_NAME_MAX } from '../models/workspace-layout'
import { checkLayoutColumns, pickLayoutColumns } from './layout-shape'

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

function checkCanvas(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['createdAt', isDateLike(v.createdAt)],
  ])
}

function isOptColor(v: unknown): boolean {
  return v === undefined || v === null || isValidCssColor(v)
}

// `ProjectGroupBy = TodoGroupBy` (ui-consistency-2026-04-25 P4). The
// validator accepts every flat `TodoGroupBy` literal (including `'none'`);
// `Project.groupBy` itself still uses `null` as the canonical "no grouping"
// sentinel, but rows that round-tripped via a surface that wrote `'none'`
// must validate too.
function isOptProjectGroupBy(v: unknown): boolean {
  if (v === undefined || v === null) return true
  return isTodoGroupBy(v)
}

function isOptStringArray(v: unknown, maxLen = 200): boolean {
  if (v === undefined || v === null) return true
  if (!Array.isArray(v)) return false
  return v.every((s) => typeof s === 'string' && s.length <= maxLen)
}

function checkProject(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['canvasId', isFiniteNum(v.canvasId)],
    ['positionX', isFiniteNum(v.positionX)],
    ['positionY', isFiniteNum(v.positionY)],
    ['isCollapsed', isBool(v.isCollapsed)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['createdAt', isDateLike(v.createdAt)],
    ['color', isOptColor(v.color)],
    ['width', isOptNum(v.width)],
    ['groupBy', isOptProjectGroupBy(v.groupBy)],
    ['groupOrder', isOptStringArray(v.groupOrder)],
  ])
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
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['projectId', isOptNum(v.projectId)],
    ['canvasId', isOptNum(v.canvasId)],
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

const VALID_RUNTIME_FILTER_FIELDS: readonly RuntimeFilterField[] = ['person', 'project', 'status', 'tag']

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
  ])
}

function checkTag(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['color', isValidCssColor(v.color)],
  ])
}

function isOptIntArray(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!Array.isArray(v)) return false
  return v.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function checkListInset(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['listDefinitionId', isFiniteNum(v.listDefinitionId)],
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['isCollapsed', isBool(v.isCollapsed)],
    ['runtimeFilterValue', isOptIntArray(v.runtimeFilterValue)],
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

/**
 * Shared `canvasId / x / y / width / height` fields carried by every floating
 * widget row. Returned as the prefix of the `checkFields` array so per-kind
 * validators can append their own optional fields after.
 */
function checkFloatPlacementFields(v: Record<string, unknown>): Array<[string, boolean]> {
  return [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
  ]
}

function checkFloatingNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, checkFloatPlacementFields(v))
}

function isOptCalendarOrientation(v: unknown): boolean {
  return v === undefined || v === null || v === 'vertical' || v === 'horizontal'
}

function checkFloatingCalendar(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ...checkFloatPlacementFields(v),
    ['orientation', isOptCalendarOrientation(v.orientation)],
    ['weekOffset', isOptNum(v.weekOffset)],
  ])
}

function checkFloatingStatus(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ...checkFloatPlacementFields(v),
    ['collapsed', v.collapsed === undefined || isBool(v.collapsed)],
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

function checkTaskboardEntry(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

function checkTaskboard(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const basic = checkFields(v, [
    ['entries', Array.isArray(v.entries)],
    ['createdAt', isDateLike(v.createdAt)],
    ['updatedAt', isDateLike(v.updatedAt)],
  ])
  if (basic !== true) return basic
  for (const entry of v.entries as unknown[]) {
    const res = checkTaskboardEntry(entry)
    if (res !== true) return `entries: ${res}`
  }
  return true
}

function checkFloatingTaskboard(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, checkFloatPlacementFields(v))
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

// `defaultProjectGroupBy` shares the unified `TodoGroupBy` literal set; the
// canonical "no grouping" sentinel is `null` (carried as the empty string in
// the settings row), but `'none'` is also accepted.
const VALID_DEFAULT_PROJECT_GROUP_BY = ['', 'none', 'status', 'people', 'tag', 'deadline', 'followup'] as const

const SETTING_VALUE_MAX_LEN_DEFAULT = 200
const SETTING_VALUE_MAX_LEN_BY_KEY: Record<string, number> = {
  [SETTING_KEYS.canvasRails]: MAX_CANVAS_RAILS_SETTING_BYTES,
  [SETTING_KEYS.canvasViewport]: 200,
}

const SLOT_KINDS_SET = new Set<string>(SLOT_KINDS as readonly string[])
const MAX_SLOTS_PER_RAIL = 16
const RAIL_SIDES = ['left', 'right', 'top', 'bottom'] as const

function validateRailsShape(parsed: unknown): true | string {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'must be an object'
  const r = parsed as Record<string, unknown>
  for (const side of RAIL_SIDES) {
    const rail = r[side]
    if (rail === null || rail === undefined) continue
    if (typeof rail !== 'object' || Array.isArray(rail)) return `${side}: not an object`
    const railObj = rail as Record<string, unknown>
    if (railObj.orientation !== 'vertical' && railObj.orientation !== 'horizontal') {
      return `${side}.orientation`
    }
    if (!Array.isArray(railObj.slots)) return `${side}.slots must be an array`
    if ((railObj.slots as unknown[]).length > MAX_SLOTS_PER_RAIL) {
      return `${side}.slots exceeds ${MAX_SLOTS_PER_RAIL}`
    }
    for (const slot of railObj.slots as unknown[]) {
      if (!slot || typeof slot !== 'object') return `${side}.slot: not an object`
      const s = slot as Record<string, unknown>
      if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 100) return `${side}.slot.id`
      if (!Array.isArray(s.tabs)) return `${side}.slot.tabs must be an array`
      if (s.tabs.length === 0) return `${side}.slot.tabs empty`
      if (typeof s.activeTabId !== 'string' || s.activeTabId.length === 0) return `${side}.slot.activeTabId`
      for (const raw of s.tabs) {
        if (!raw || typeof raw !== 'object') return `${side}.slot.tab: not an object`
        const t = raw as Record<string, unknown>
        if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > 100) return `${side}.slot.tab.id`
        if (typeof t.type !== 'string' || !SLOT_KINDS_SET.has(t.type)) return `${side}.slot.tab.type`
        if (t.listDefinitionId !== undefined && !Number.isFinite(t.listDefinitionId)) return `${side}.slot.tab.listDefinitionId`
        if (t.taskboardId !== undefined && !Number.isFinite(t.taskboardId)) return `${side}.slot.tab.taskboardId`
      }
      if (s.flex !== undefined && !Number.isFinite(s.flex)) return `${side}.slot.flex`
      if (s.orientation !== undefined && s.orientation !== 'vertical' && s.orientation !== 'horizontal') {
        return `${side}.slot.orientation`
      }
      if (s.weekOffset !== undefined && !Number.isFinite(s.weekOffset)) return `${side}.slot.weekOffset`
    }
  }
  for (const bag of ['widths', 'heights'] as const) {
    const v = r[bag]
    if (v === undefined || v === null) continue
    if (typeof v !== 'object' || Array.isArray(v)) return `${bag}: not an object`
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (n !== undefined && !Number.isFinite(n)) return `${bag}.${k}`
    }
  }
  return true
}

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
  const maxLen = SETTING_VALUE_MAX_LEN_BY_KEY[v.key as string] ?? SETTING_VALUE_MAX_LEN_DEFAULT
  if ((v.value as string).length > maxLen) return 'value'
  if (typeof v.key === 'string' && v.key.startsWith('color.')) {
    return isValidCssColor(v.value) ? true : 'value (invalid color)'
  }
  if (v.key === SETTING_KEYS.defaultProjectId) {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : `value (${v.key} must be numeric)`
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
  if (v.key === SETTING_KEYS.canvasRails) {
    let parsed: unknown
    try {
      parsed = JSON.parse(v.value as string)
    } catch {
      return 'value (canvasRails must be valid JSON)'
    }
    const res = validateRailsShape(parsed)
    return res === true ? true : `value (canvasRails: ${res})`
  }
  if (v.key === SETTING_KEYS.canvasViewport) {
    try {
      const parsed = JSON.parse(v.value as string) as unknown
      if (!parsed || typeof parsed !== 'object') return 'value (canvasViewport must be an object)'
      const o = parsed as Record<string, unknown>
      if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.zoom)) {
        return 'value (canvasViewport x/y/zoom must be finite numbers)'
      }
      return true
    } catch {
      return 'value (canvasViewport must be valid JSON)'
    }
  }
  if (v.key === SETTING_KEYS.defaultProjectGroupBy) {
    return (VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).includes(v.value as string)
      ? true
      : `value (defaultProjectGroupBy must be one of: ${(VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).filter(Boolean).join(', ')} or empty)`
  }
  if (v.key === SETTING_KEYS.followupDefaultInterval) {
    return parseFollowupInterval(v.value as string)
      ? true
      : 'value (followupDefaultInterval must look like 3d, 2w, 1m or 1y)'
  }
  if (v.key === SETTING_KEYS.canvasMaxExtent) {
    const n = Number(v.value)
    return Number.isFinite(n) && n >= 1000 && n <= 100000
      ? true
      : 'value (canvasMaxExtent must be a finite number in [1000, 100000])'
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
 * `compactRow`; `null` is kept where the model allows it (`Project.groupBy`).
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
const optBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

function pickCanvas(v: Raw): AllFields<Canvas> {
  return {
    id: optNum(v.id), name: v.name as string, sortOrder: v.sortOrder as number,
    createdAt: toDate(v.createdAt),
  } satisfies AllFields<Canvas>
}

function pickProject(v: Raw): AllFields<Project> {
  return {
    id: optNum(v.id), name: v.name as string, canvasId: v.canvasId as number,
    positionX: v.positionX as number, positionY: v.positionY as number, isCollapsed: v.isCollapsed as boolean,
    sortOrder: v.sortOrder as number, createdAt: toDate(v.createdAt),
    color: optStr(v.color),
    width: optNum(v.width),
    // `null` is the canonical "no grouping" sentinel — keep it.
    groupBy: v.groupBy !== undefined ? v.groupBy as ProjectGroupBy | null : undefined,
    groupOrder: Array.isArray(v.groupOrder) ? v.groupOrder as string[] : undefined,
  } satisfies AllFields<Project>
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
    recurrenceRule: v.recurrenceRule != null ? v.recurrenceRule as RecurrenceRule : undefined,
    projectId: optNum(v.projectId),
    canvasId: optNum(v.canvasId),
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
  } satisfies AllFields<Person>
}

function pickTag(v: Raw): AllFields<Tag> {
  return { id: optNum(v.id), name: v.name as string, color: v.color as string } satisfies AllFields<Tag>
}

function pickListInset(v: Raw): AllFields<ListInset> {
  return {
    id: optNum(v.id),
    listDefinitionId: v.listDefinitionId as number,
    canvasId: v.canvasId as number, x: v.x as number, y: v.y as number,
    width: v.width as number, height: v.height as number, isCollapsed: v.isCollapsed as boolean,
    runtimeFilterValue: Array.isArray(v.runtimeFilterValue) && v.runtimeFilterValue.length > 0
      ? v.runtimeFilterValue as number[]
      : undefined,
  } satisfies AllFields<ListInset>
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

function pickTaskboardEntry(v: Raw): TaskboardEntry {
  return { todoId: v.todoId as number, sortOrder: v.sortOrder as number } satisfies AllFields<TaskboardEntry>
}

function pickTaskboard(v: Raw): AllFields<Taskboard> {
  return {
    id: optNum(v.id),
    entries: ((v.entries ?? []) as Raw[]).map(pickTaskboardEntry),
    createdAt: toDate(v.createdAt),
    updatedAt: toDate(v.updatedAt),
  } satisfies AllFields<Taskboard>
}

/** `id / canvasId / x / y / width / height` — shared by every floating widget row. */
function pickFloatPlacement(v: Raw) {
  return {
    id: optNum(v.id),
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
  }
}

function pickFloatingTaskboard(v: Raw): AllFields<FloatingTaskboard> {
  return { ...pickFloatPlacement(v), collapsed: optBool(v.collapsed) } satisfies AllFields<FloatingTaskboard>
}

function pickSetting(v: Raw): AllFields<SettingRow> {
  return { key: v.key as string, value: v.value as string } satisfies AllFields<SettingRow>
}

function pickNote(v: Raw): AllFields<Note> {
  return {
    id: optNum(v.id),
    content: v.content as string,
    createdAt: toDate(v.createdAt),
    modifiedAt: toDate(v.modifiedAt),
  } satisfies AllFields<Note>
}

function pickFloatingNote(v: Raw): AllFields<FloatingNote> {
  return { ...pickFloatPlacement(v) } satisfies AllFields<FloatingNote>
}

function pickFloatingCalendar(v: Raw): AllFields<FloatingCalendar> {
  return {
    ...pickFloatPlacement(v),
    orientation: v.orientation === 'vertical' || v.orientation === 'horizontal'
      ? v.orientation as FloatingCalendar['orientation']
      : undefined,
    weekOffset: typeof v.weekOffset === 'number' && Number.isFinite(v.weekOffset)
      ? v.weekOffset
      : undefined,
  } satisfies AllFields<FloatingCalendar>
}

function pickFloatingStatus(v: Raw): AllFields<FloatingStatus> {
  return { ...pickFloatPlacement(v), collapsed: optBool(v.collapsed) } satisfies AllFields<FloatingStatus>
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
  canvases: pickCanvas,
  projects: pickProject,
  todos: pickTodo,
  people: pickPerson,
  tags: pickTag,
  listInsets: pickListInset,
  todoTags: pickTodoTag,
  todoPeople: pickTodoPerson,
  settings: pickSetting,
  taskboards: pickTaskboard,
  floatingTaskboards: pickFloatingTaskboard,
  statuses: pickStatus,
  listDefinitions: pickListDefinition,
  notes: pickNote,
  floatingCalendars: pickFloatingCalendar,
  floatingNotes: pickFloatingNote,
  floatingStatus: pickFloatingStatus,
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

type TableValidator = { key: keyof ImportData; check: (v: unknown) => CheckResult; required?: boolean }

const TABLE_VALIDATORS: TableValidator[] = [
  { key: 'canvases', check: checkCanvas, required: true },
  { key: 'projects', check: checkProject },
  { key: 'todos', check: checkTodo },
  { key: 'people', check: checkPerson },
  { key: 'tags', check: checkTag },
  { key: 'listInsets', check: checkListInset },
  { key: 'todoTags', check: checkTodoTag },
  { key: 'todoPeople', check: checkTodoPerson },
  { key: 'settings', check: checkSetting },
  { key: 'taskboards', check: checkTaskboard },
  { key: 'floatingTaskboards', check: checkFloatingTaskboard },
  { key: 'statuses', check: checkStatus },
  { key: 'listDefinitions', check: checkListDefinition },
  { key: 'notes', check: checkNote },
  { key: 'floatingCalendars', check: checkFloatingCalendar },
  { key: 'floatingNotes', check: checkFloatingNote },
  { key: 'floatingStatus', check: checkFloatingStatus },
  { key: 'todoEvents', check: checkTodoEvent },
  { key: 'layouts', check: checkLayout },
  { key: 'listOrders', check: checkListOrder },
]

const TABLE_VALIDATOR_BY_KEY: ReadonlyMap<keyof ImportData, (v: unknown) => CheckResult> =
  new Map(TABLE_VALIDATORS.map((t) => [t.key, t.check]))

export interface ImportData {
  canvases: Canvas[]
  projects: Project[]
  todos: TodoItem[]
  people: Person[]
  tags?: ImportTag[]
  listInsets: ListInset[]
  todoTags?: ImportTodoTag[]
  todoPeople: TodoPerson[]
  settings: SettingRow[]
  taskboards: Taskboard[]
  floatingTaskboards: FloatingTaskboard[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Note[]
  floatingCalendars: FloatingCalendar[]
  floatingNotes: FloatingNote[]
  floatingStatus: FloatingStatus[]
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
   * Require a non-empty `canvases` table (default true) — the "is this a
   * whole TODO2 database" check for restores. Appending tasks (task
   * archives) passes false: an archive carries only task tables.
   */
  requireCanvases?: boolean
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

  if ((options.requireCanvases ?? true) && (!Array.isArray(raw.canvases) || raw.canvases.length === 0)) {
    return { ok: false, error: 'File is not a valid TODO2 database (missing canvases)' }
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
      canvases: pickRows('canvases', raw.canvases),
      projects: pickRows('projects', raw.projects),
      todos: pickRows('todos', raw.todos),
      people: pickRows('people', raw.people),
      ...(Array.isArray(raw.tags) && raw.tags.length > 0 ? { tags: pickRows('tags', raw.tags) } : {}),
      listInsets: pickRows('listInsets', raw.listInsets),
      ...(Array.isArray(raw.todoTags) && raw.todoTags.length > 0 ? { todoTags: pickRows('todoTags', raw.todoTags) } : {}),
      todoPeople: pickRows('todoPeople', raw.todoPeople),
      settings: pickRows('settings', settingRows),
      taskboards: pickRows('taskboards', raw.taskboards),
      floatingTaskboards: pickRows('floatingTaskboards', raw.floatingTaskboards),
      statuses: pickRows('statuses', raw.statuses),
      listDefinitions: pickRows('listDefinitions', raw.listDefinitions),
      notes: pickRows('notes', raw.notes),
      floatingCalendars: pickRows('floatingCalendars', raw.floatingCalendars),
      floatingNotes: pickRows('floatingNotes', raw.floatingNotes),
      floatingStatus: pickRows('floatingStatus', raw.floatingStatus),
      todoEvents: pickRows('todoEvents', raw.todoEvents),
      layouts: pickRows('layouts', raw.layouts),
      listOrders: pickRows('listOrders', raw.listOrders),
    },
  }
}
