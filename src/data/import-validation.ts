import type { TodoItem, Project, ProjectGroupBy, Canvas, Person, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, RecurrenceRule, TaskboardEntry, Status, Note, FloatingCalendar, FloatingNote, FloatingHorizons, FloatingStatus, FloatingScoreboard, FloatingSnoozeGraveyard, TodoEvent, TodoEventType } from '../models'
import { isTodoSortBy, isTodoGroupBy } from '../models'

export interface ImportTag {
  id?: number
  name: string
  color: string
}
export interface ImportTodoTag {
  id?: number
  todoId: number
  tagId: number
}

import type { ListDefinition, ListMembership, ListSort, ListGrouping, RuntimeFilterField, RuntimeFilterSpec } from '../models/list-definition'
import { FUZZY_TOKENS } from '../models/scheduled-value'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { STATUS_ICON_KEYS, type StatusIconKey } from '../models/status'
import { SLOT_KINDS } from '../models/canvas-rails'
import { ALL_SETTING_KEYS, SETTING_KEYS } from './setting-keys'
import { MAX_CANVAS_RAILS_SETTING_BYTES } from '../constants'

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

function isOptScheduledValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!isObj(v)) return false
  if (v.kind === 'date') return isDateLike(v.value)
  if (v.kind === 'fuzzy') {
    if (typeof v.token !== 'string' || !(FUZZY_TOKENS as readonly string[]).includes(v.token)) return false
    // `setAt` was added in Dexie v49 (fuzzy schedule aging). `isOptDateLike`
    // (not `isDateLike`) lets a stale export from a v48 backup still validate;
    // the v49 upgrader re-stamps the field on import via the same backfill.
    return isOptDateLike(v.setAt)
  }
  return false
}

function checkTodo(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['title', isStr(v.title, 500)],
    ['notes', isOptStr(v.notes, 50000)],
    ['progress', isOptStr(v.progress, 500)],
    ['isCompleted', isBool(v.isCompleted)],
    ['scheduledDate', isOptScheduledValue(v.scheduledDate)],
    ['dueDate', isOptDateLike(v.dueDate)],
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
    || typeof v.showHiddenStatuses !== 'boolean'
    || typeof v.searchText !== 'string'
    || typeof v.dateRangeIncludeNoDate !== 'boolean') return false
  if (!isOptDateAnchor(v.dateRangeStart)) return false
  if (!isOptDateAnchor(v.dateRangeEnd)) return false
  if (!isOptTriBool(v.hasScheduled)) return false
  if (!isOptTriBool(v.hasDeadline)) return false
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

const VALID_RUNTIME_FILTER_FIELDS: readonly RuntimeFilterField[] = ['person', 'org', 'project', 'status', 'tag']

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
    ['favorited', v.favorited === undefined || isBool(v.favorited)],
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
    ['hideByDefault', isOptBool(v.hideByDefault)],
  ])
}

function checkPerson(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['initials', isStr(v.initials, 4)],
  ])
}

function checkOrg(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['initials', isOptStr(v.initials, 4)],
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

function checkTodoPerson(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['personId', isFiniteNum(v.personId)],
  ])
}

function checkTodoOrg(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['orgId', isFiniteNum(v.orgId)],
  ])
}

function checkPersonOrg(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['personId', isFiniteNum(v.personId)],
    ['orgId', isFiniteNum(v.orgId)],
  ])
}

function isOptBool(v: unknown): boolean {
  return v === undefined || isBool(v)
}

function checkNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['content', typeof v.content === 'string' && (v.content as string).length <= 500000],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
  ])
}

function checkFloatingNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
  ])
}

function isOptCalendarOrientation(v: unknown): boolean {
  return v === undefined || v === null || v === 'vertical' || v === 'horizontal'
}

function checkFloatingCalendar(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['orientation', isOptCalendarOrientation(v.orientation)],
    ['weekOffset', isOptNum(v.weekOffset)],
  ])
}

function checkFloatingHorizons(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['collapsed', v.collapsed === undefined || isBool(v.collapsed)],
  ])
}

function checkFloatingStatus(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['collapsed', v.collapsed === undefined || isBool(v.collapsed)],
  ])
}

function checkFloatingScoreboard(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['collapsed', v.collapsed === undefined || isBool(v.collapsed)],
  ])
}

function checkFloatingSnoozeGraveyard(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
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
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
  ])
}

const VALID_SETTING_KEYS: readonly string[] = ALL_SETTING_KEYS

// `defaultProjectGroupBy` shares the unified `TodoGroupBy` literal set; the
// canonical "no grouping" sentinel is `null` (carried as the empty string in
// the settings row), but `'none'` is also accepted.
const VALID_DEFAULT_PROJECT_GROUP_BY = ['', 'none', 'status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date'] as const

const SETTING_VALUE_MAX_LEN_DEFAULT = 200
const SETTING_VALUE_MAX_LEN_BY_KEY: Record<string, number> = {
  [SETTING_KEYS.canvasRails]: MAX_CANVAS_RAILS_SETTING_BYTES,
  [SETTING_KEYS.canvasViewport]: 200,
  [SETTING_KEYS.horizonSlots]: 500,
}

const MAX_HORIZON_ENTRIES = 16
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

function checkSetting(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  if (!isStr(v.key, 100)) return 'key'
  if (typeof v.value !== 'string') return 'value'
  const maxLen = SETTING_VALUE_MAX_LEN_BY_KEY[v.key as string] ?? SETTING_VALUE_MAX_LEN_DEFAULT
  if ((v.value as string).length > maxLen) return 'value'
  if (!isKnownSettingKey(v.key as string)) return 'key (unrecognized)'
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
    v.key === SETTING_KEYS.seededFollowupStatusId
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
  if (v.key === SETTING_KEYS.horizonSlots) {
    try {
      const parsed = JSON.parse(v.value as string) as unknown
      if (!Array.isArray(parsed)) return 'value (horizonSlots must be an array)'
      if (parsed.length > MAX_HORIZON_ENTRIES) return 'value (horizonSlots has too many entries)'
      for (const val of parsed) {
        if (typeof val !== 'number' || !Number.isInteger(val)) {
          return 'value (horizonSlots entries must be integer ids)'
        }
      }
      return true
    } catch {
      return 'value (horizonSlots must be valid JSON)'
    }
  }
  if (v.key === SETTING_KEYS.selectedHorizonDefId) {
    if (v.value === '' || v.value == null) return true
    const n = Number(v.value)
    return Number.isFinite(n) ? true : 'value (selectedHorizonDefId must be numeric or empty)'
  }
  if (v.key === SETTING_KEYS.defaultProjectGroupBy) {
    return (VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).includes(v.value as string)
      ? true
      : `value (defaultProjectGroupBy must be one of: ${(VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).filter(Boolean).join(', ')} or empty)`
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

function pickCanvas(v: Record<string, unknown>): Canvas {
  return { id: v.id as number | undefined, name: v.name as string, sortOrder: v.sortOrder as number, createdAt: v.createdAt as Date }
}

function pickProject(v: Record<string, unknown>): Project {
  return {
    id: v.id as number | undefined, name: v.name as string, canvasId: v.canvasId as number,
    positionX: v.positionX as number, positionY: v.positionY as number, isCollapsed: v.isCollapsed as boolean,
    sortOrder: v.sortOrder as number, createdAt: v.createdAt as Date,
    ...(v.color != null ? { color: v.color as string } : {}),
    ...(v.width != null ? { width: v.width as number } : {}),
    ...(v.groupBy !== undefined ? { groupBy: v.groupBy as ProjectGroupBy | null } : {}),
    ...(Array.isArray(v.groupOrder) ? { groupOrder: v.groupOrder as string[] } : {}),
  }
}

function pickTodo(v: Record<string, unknown>): TodoItem {
  return {
    id: v.id as number | undefined, title: v.title as string,
    isCompleted: v.isCompleted as boolean,
    createdAt: v.createdAt as Date, modifiedAt: v.modifiedAt as Date, sortOrder: v.sortOrder as number,
    ...(v.notes != null ? { notes: v.notes as string } : {}),
    ...(v.progress != null ? { progress: v.progress as string } : {}),
    ...(v.scheduledDate != null ? { scheduledDate: v.scheduledDate as TodoItem['scheduledDate'] } : {}),
    ...(v.dueDate != null ? { dueDate: v.dueDate as Date } : {}),
    ...(v.recurrenceRule != null ? { recurrenceRule: v.recurrenceRule as RecurrenceRule } : {}),
    ...(v.projectId != null ? { projectId: v.projectId as number } : {}),
    ...(v.canvasId != null ? { canvasId: v.canvasId as number } : {}),
    ...(v.statusId != null ? { statusId: v.statusId as number } : {}),
  }
}

function pickStatus(v: Record<string, unknown>): Status {
  // `icon` already validated by `checkStatus` -> `isOptStatusIcon`; the cast
  // narrows the validated string to the StatusIconKey union.
  return {
    id: v.id as number | undefined, name: v.name as string, color: v.color as string, sortOrder: v.sortOrder as number,
    ...(v.icon != null ? { icon: v.icon as StatusIconKey } : {}),
    ...(v.hideByDefault != null ? { hideByDefault: v.hideByDefault as boolean } : {}),
  }
}

function pickPerson(v: Record<string, unknown>): Person {
  return { id: v.id as number | undefined, name: v.name as string, initials: v.initials as string }
}

function pickOrg(v: Record<string, unknown>): Org {
  return {
    id: v.id as number | undefined, name: v.name as string,
    ...(v.initials != null ? { initials: v.initials as string } : {}),
    ...(v.color != null ? { color: v.color as string } : {}),
  }
}

function pickTag(v: Record<string, unknown>): ImportTag {
  return { id: v.id as number | undefined, name: v.name as string, color: v.color as string }
}

function pickListInset(v: Record<string, unknown>): ListInset {
  return {
    id: v.id as number | undefined,
    listDefinitionId: v.listDefinitionId as number,
    canvasId: v.canvasId as number, x: v.x as number, y: v.y as number,
    width: v.width as number, height: v.height as number, isCollapsed: v.isCollapsed as boolean,
    ...(Array.isArray(v.runtimeFilterValue) && v.runtimeFilterValue.length > 0
      ? { runtimeFilterValue: v.runtimeFilterValue as number[] }
      : {}),
  }
}

function pickTodoTag(v: Record<string, unknown>): ImportTodoTag {
  return { id: v.id as number | undefined, todoId: v.todoId as number, tagId: v.tagId as number }
}

function pickTodoPerson(v: Record<string, unknown>): TodoPerson {
  return { id: v.id as number | undefined, todoId: v.todoId as number, personId: v.personId as number }
}

function pickTodoOrg(v: Record<string, unknown>): TodoOrg {
  return { id: v.id as number | undefined, todoId: v.todoId as number, orgId: v.orgId as number }
}

function pickPersonOrg(v: Record<string, unknown>): PersonOrg {
  return { id: v.id as number | undefined, personId: v.personId as number, orgId: v.orgId as number }
}

function pickTaskboardEntry(v: Record<string, unknown>): TaskboardEntry {
  return { todoId: v.todoId as number, sortOrder: v.sortOrder as number }
}

function pickTaskboard(v: Record<string, unknown>): import('../models').Taskboard {
  return {
    id: v.id as number | undefined,
    entries: ((v.entries ?? []) as Record<string, unknown>[]).map(pickTaskboardEntry),
    createdAt: v.createdAt as Date,
    updatedAt: v.updatedAt as Date,
  }
}

function pickFloatingTaskboard(v: Record<string, unknown>): import('../models').FloatingTaskboard {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(typeof v.collapsed === 'boolean' ? { collapsed: v.collapsed } : {}),
  }
}

function pickSetting(v: Record<string, unknown>): SettingRow {
  return { key: v.key as string, value: v.value as string }
}

function pickNote(v: Record<string, unknown>): Note {
  return {
    id: v.id as number | undefined,
    content: v.content as string,
    createdAt: v.createdAt as Date,
    modifiedAt: v.modifiedAt as Date,
  }
}

function pickFloatingNote(v: Record<string, unknown>): FloatingNote {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
  }
}

function pickFloatingCalendar(v: Record<string, unknown>): FloatingCalendar {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(v.orientation === 'vertical' || v.orientation === 'horizontal'
      ? { orientation: v.orientation as FloatingCalendar['orientation'] }
      : {}),
    ...(typeof v.weekOffset === 'number' && Number.isFinite(v.weekOffset)
      ? { weekOffset: v.weekOffset as number }
      : {}),
  }
}

function pickFloatingHorizons(v: Record<string, unknown>): FloatingHorizons {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(typeof v.collapsed === 'boolean' ? { collapsed: v.collapsed } : {}),
  }
}

function pickFloatingStatus(v: Record<string, unknown>): FloatingStatus {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(typeof v.collapsed === 'boolean' ? { collapsed: v.collapsed } : {}),
  }
}

function pickFloatingScoreboard(v: Record<string, unknown>): FloatingScoreboard {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(typeof v.collapsed === 'boolean' ? { collapsed: v.collapsed } : {}),
  }
}

function pickFloatingSnoozeGraveyard(v: Record<string, unknown>): FloatingSnoozeGraveyard {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(typeof v.collapsed === 'boolean' ? { collapsed: v.collapsed } : {}),
  }
}

function pickTodoEvent(v: Record<string, unknown>): TodoEvent {
  return {
    id: v.id as number | undefined,
    todoId: v.todoId as number,
    type: v.type as TodoEventType,
    fromValue: (v.fromValue ?? null) as string | number | null,
    toValue: (v.toValue ?? null) as string | number | null,
    timestamp: v.timestamp as string,
  }
}

function pickRuntimeFilter(v: unknown): RuntimeFilterSpec | undefined {
  if (!isObj(v)) return undefined
  const field = v.field
  if (typeof field !== 'string' || !(VALID_RUNTIME_FILTER_FIELDS as readonly string[]).includes(field)) return undefined
  return {
    field: field as RuntimeFilterField,
    ...(typeof v.label === 'string' ? { label: v.label } : {}),
  }
}

function pickListDefinition(v: Record<string, unknown>): ListDefinition {
  const runtimeFilter = pickRuntimeFilter(v.runtimeFilter)
  return {
    id: v.id as number | undefined,
    name: v.name as string,
    sortOrder: v.sortOrder as number,
    membership: v.membership as ListMembership,
    sort: v.sort as ListSort,
    grouping: v.grouping as ListGrouping,
    pinnedToDashboard: typeof v.pinnedToDashboard === 'boolean' ? v.pinnedToDashboard : true,
    favorited: typeof v.favorited === 'boolean' ? v.favorited : false,
    ...(typeof v.maxTasks === 'number' ? { maxTasks: v.maxTasks } : {}),
    ...(v.limitMode === 'hard' || v.limitMode === 'scroll' ? { limitMode: v.limitMode } : {}),
    ...(runtimeFilter ? { runtimeFilter } : {}),
  }
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
  { key: 'todoOrgs', check: checkTodoOrg },
  { key: 'personOrgs', check: checkPersonOrg },
  { key: 'settings', check: checkSetting },
  { key: 'orgs', check: checkOrg },
  { key: 'taskboards', check: checkTaskboard },
  { key: 'floatingTaskboards', check: checkFloatingTaskboard },
  { key: 'statuses', check: checkStatus },
  { key: 'listDefinitions', check: checkListDefinition },
  { key: 'notes', check: checkNote },
  { key: 'floatingCalendars', check: checkFloatingCalendar },
  { key: 'floatingNotes', check: checkFloatingNote },
  { key: 'floatingHorizons', check: checkFloatingHorizons },
  { key: 'floatingStatus', check: checkFloatingStatus },
  { key: 'floatingScoreboard', check: checkFloatingScoreboard },
  { key: 'floatingSnoozeGraveyard', check: checkFloatingSnoozeGraveyard },
  { key: 'todoEvents', check: checkTodoEvent },
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
  todoOrgs: TodoOrg[]
  personOrgs: PersonOrg[]
  settings: SettingRow[]
  orgs: Org[]
  taskboards: import('../models').Taskboard[]
  floatingTaskboards: import('../models').FloatingTaskboard[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Note[]
  floatingCalendars: FloatingCalendar[]
  floatingNotes: FloatingNote[]
  floatingHorizons: FloatingHorizons[]
  floatingStatus: FloatingStatus[]
  floatingScoreboard: FloatingScoreboard[]
  floatingSnoozeGraveyard: FloatingSnoozeGraveyard[]
  todoEvents: TodoEvent[]
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

export function validateImportData(data: unknown): { ok: true; data: ImportData } | { ok: false; error: string } {
  if (!isObj(data)) {
    return { ok: false, error: 'Import data is not an object' }
  }

  const raw = data as Record<string, unknown>

  if (!Array.isArray(raw.canvases) || raw.canvases.length === 0) {
    return { ok: false, error: 'File is not a valid TODO2 database (missing canvases)' }
  }

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
      const result = check(arr[i])
      if (result !== true) {
        const label = isObj(arr[i]) && 'title' in arr[i] ? ` ("${arr[i].title}")` :
                      isObj(arr[i]) && 'name' in arr[i] ? ` ("${arr[i].name}")` : ''
        return { ok: false, error: `Invalid "${key}" record at index ${i}${label}: bad field "${result}"` }
      }
    }
  }

  return {
    ok: true,
    data: {
      canvases: (raw.canvases as Record<string, unknown>[]).map(pickCanvas),
      projects: ((raw.projects ?? []) as Record<string, unknown>[]).map(pickProject),
      todos: ((raw.todos ?? []) as Record<string, unknown>[]).map(pickTodo),
      people: ((raw.people ?? []) as Record<string, unknown>[]).map(pickPerson),
      ...(Array.isArray(raw.tags) && raw.tags.length > 0
        ? { tags: (raw.tags as Record<string, unknown>[]).map(pickTag) }
        : {}),
      listInsets: ((raw.listInsets ?? []) as Record<string, unknown>[]).map(pickListInset),
      ...(Array.isArray(raw.todoTags) && raw.todoTags.length > 0
        ? { todoTags: (raw.todoTags as Record<string, unknown>[]).map(pickTodoTag) }
        : {}),
      todoPeople: ((raw.todoPeople ?? []) as Record<string, unknown>[]).map(pickTodoPerson),
      todoOrgs: ((raw.todoOrgs ?? []) as Record<string, unknown>[]).map(pickTodoOrg),
      personOrgs: ((raw.personOrgs ?? []) as Record<string, unknown>[]).map(pickPersonOrg),
      settings: ((raw.settings ?? []) as Record<string, unknown>[]).map(pickSetting),
      orgs: ((raw.orgs ?? []) as Record<string, unknown>[]).map(pickOrg),
      taskboards: ((raw.taskboards ?? []) as Record<string, unknown>[]).map(pickTaskboard),
      floatingTaskboards: ((raw.floatingTaskboards ?? []) as Record<string, unknown>[]).map(pickFloatingTaskboard),
      statuses: ((raw.statuses ?? []) as Record<string, unknown>[]).map(pickStatus),
      listDefinitions: ((raw.listDefinitions ?? []) as Record<string, unknown>[]).map(pickListDefinition),
      notes: ((raw.notes ?? []) as Record<string, unknown>[]).map(pickNote),
      floatingCalendars: ((raw.floatingCalendars ?? []) as Record<string, unknown>[]).map(pickFloatingCalendar),
      floatingNotes: ((raw.floatingNotes ?? []) as Record<string, unknown>[]).map(pickFloatingNote),
      floatingHorizons: ((raw.floatingHorizons ?? []) as Record<string, unknown>[]).map(pickFloatingHorizons),
      floatingStatus: ((raw.floatingStatus ?? []) as Record<string, unknown>[]).map(pickFloatingStatus),
      floatingScoreboard: ((raw.floatingScoreboard ?? []) as Record<string, unknown>[]).map(pickFloatingScoreboard),
      floatingSnoozeGraveyard: ((raw.floatingSnoozeGraveyard ?? []) as Record<string, unknown>[]).map(pickFloatingSnoozeGraveyard),
      todoEvents: ((raw.todoEvents ?? []) as Record<string, unknown>[]).map(pickTodoEvent),
    },
  }
}
