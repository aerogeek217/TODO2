import type { TodoItem, Project, ProjectGroupBy, Canvas, Person, TodoPerson, TodoOrg, PersonOrg, Org, RecurrenceRule, TaskboardEntry, Status, Note, FloatingCalendar, FloatingNote, FloatingHorizons, FloatingStatus, FloatingScoreboard, FloatingSnoozeGraveyard, TodoEvent, TodoEventType } from '../models'
import { isTodoSortBy, isTodoGroupBy } from '../models'
import { flattenListSortValue, flattenListGroupingValue } from './database'
import type { LegacySavedView, LegacySavedViewFilters } from './saved-view-legacy'

/**
 * Top-level tag registry rows. Shape is shared between pre-v29 backups
 * (restore bakes `#tagname` into titles) and post-v36 backups (restore
 * bulk-adds them into the re-introduced `tags` + `todoTags` tables). The
 * disambiguation happens in `restoreFromImportData`, not here.
 */
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
import type { ListDefinition, ListMembership, ListSort, ListGrouping } from '../models/list-definition'
import { FUZZY_TOKENS } from '../models/scheduled-value'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { STATUS_ICON_KEYS } from '../models/status'
import { SLOT_KINDS } from '../models/canvas-rails'
import { LEGACY_HORIZON_KEYS } from '../utils/horizon-slots'

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

// Dates in JSON are ISO strings; Dexie stores them as Date objects or strings
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

// Post ui-consistency-2026-04-25 P4 `ProjectGroupBy = TodoGroupBy`. The
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
  if (v.kind === 'fuzzy') return typeof v.token === 'string' && (FUZZY_TOKENS as readonly string[]).includes(v.token)
  return false
}

function checkTodo(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['title', isStr(v.title, 500)],
    ['notes', isOptStr(v.notes, 50000)],
    ['progress', isOptStr(v.progress, 500)],
    // priority is legacy-optional: pre-v21 has a number (0/1/2), v21+ omits. Restore strips the field.
    ['priority',
      v.priority === undefined || v.priority === null
      || (typeof v.priority === 'number' && [0, 1, 2].includes(v.priority))
    ],
    ['isCompleted', isBool(v.isCompleted)],
    ['scheduledDate', isOptScheduledValue(v.scheduledDate)],
    ['dueDate', isOptDateLike(v.dueDate)],
    ['isHardDeadline', v.isHardDeadline === undefined || v.isHardDeadline === null || isBool(v.isHardDeadline)],
    ['recurrenceRule', isOptRecurrenceRule(v.recurrenceRule)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['projectId', isOptNum(v.projectId)],
    ['canvasId', isOptNum(v.canvasId)],
    ['statusId', isOptNum(v.statusId)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

/**
 * Post-v24 the only valid kind is `custom`. Legacy kinds are still *accepted*
 * here (so v21-v23 exports can be loaded) but `restoreFromImportData` drops
 * any listDefinition with a legacy kind after bulkAdd — the 5 horizon seeds
 * replace them.
 */
const VALID_LIST_MEMBERSHIP_KINDS = ['today', 'upcoming', 'deadlines', 'someday', 'custom']
const LEGACY_LIST_MEMBERSHIP_KINDS = ['today', 'upcoming', 'deadlines', 'someday']
export function isLegacyMembershipKind(kind: string): boolean {
  return LEGACY_LIST_MEMBERSHIP_KINDS.includes(kind)
}
const VALID_LIST_SORT_KINDS = ['effective-date-asc', 'scheduled-asc', 'deadline-asc', 'sort-order', 'sortBy']
const VALID_LIST_GROUPING_KINDS = ['none', 'relative-effective', 'relative-deadline', 'by-sortBy', 'by-field']
// v22→v21 back-compat: old exports may still carry `seededKey`; accepted but
// stripped at reconstruction time. Not validated against a strict enum —
// anything stringy passes so restore can drop it silently.

/** Accepts legacy ISO strings (pre-DSL) and `DateAnchor` objects. null/undefined = no filter. */
function isOptDateAnchorOrLegacy(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return isDateLike(v) // legacy ISO string
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
  // Minimal shape check — full field validation defers to savedView reader.
  // Must have the core boolean + string fields; everything else is optional.
  if (typeof v.showCompleted !== 'boolean'
    || typeof v.showHiddenStatuses !== 'boolean'
    || typeof v.searchText !== 'string'
    || typeof v.dateRangeIncludeNoDate !== 'boolean') return false
  if (!isOptDateAnchorOrLegacy(v.dateRangeStart)) return false
  if (!isOptDateAnchorOrLegacy(v.dateRangeEnd)) return false
  if (!isOptTriBool(v.hasScheduled)) return false
  if (!isOptTriBool(v.hasDeadline)) return false
  return true
}

function isValidMembership(m: unknown): boolean {
  if (!isObj(m) || typeof m.kind !== 'string') return false
  if (!VALID_LIST_MEMBERSHIP_KINDS.includes(m.kind)) return false
  if (m.kind === 'today' || m.kind === 'upcoming') {
    return m.warningWindowDays === undefined || m.warningWindowDays === null
      || (typeof m.warningWindowDays === 'number' && m.warningWindowDays >= 0 && m.warningWindowDays <= 365)
  }
  if (m.kind === 'custom') {
    return isTodoPredicateShape(m.predicate)
  }
  return true
}

function isValidSort(s: unknown): boolean {
  // Post ui-consistency-2026-04-25 P4: flat `TodoSortBy` literal is the
  // canonical shape; pre-v46 backups carry the legacy discriminated-union
  // shape and are accepted here, then normalised to the flat literal in
  // `pickListDefinition` via `flattenListSortValue`.
  if (typeof s === 'string') return isTodoSortBy(s)
  if (!isObj(s) || typeof s.kind !== 'string') return false
  if (!VALID_LIST_SORT_KINDS.includes(s.kind)) return false
  if (s.kind === 'sortBy') {
    return typeof s.by === 'string' && VALID_SORT_BY.includes(s.by)
  }
  return true
}

function isValidGrouping(g: unknown): boolean {
  // Post ui-consistency-2026-04-25 P4: flat `TodoGroupBy` literal is the
  // canonical shape; pre-v46 backups carry the legacy discriminated-union
  // shape and are accepted here, then normalised in `pickListDefinition` via
  // `flattenListGroupingValue`.
  if (typeof g === 'string') return isTodoGroupBy(g)
  if (!isObj(g) || typeof g.kind !== 'string') return false
  if (!VALID_LIST_GROUPING_KINDS.includes(g.kind)) return false
  if (g.kind === 'by-field') {
    return typeof g.by === 'string' && VALID_SORT_BY.includes(g.by)
  }
  return true
}

function checkListDefinition(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const membership = v.membership
  const sort = v.sort
  const grouping = v.grouping
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['membership', isValidMembership(membership)],
    ['sort', isValidSort(sort)],
    ['grouping', isValidGrouping(grouping)],
    // v22+: pinnedToDashboard required. v21 imports may omit; restore backfills.
    ['pinnedToDashboard', v.pinnedToDashboard === undefined || isBool(v.pinnedToDashboard)],
    // v39+: favorited required. Pre-v39 imports may omit; restore backfills false.
    ['favorited', v.favorited === undefined || isBool(v.favorited)],
    ['maxTasks', v.maxTasks === undefined || (isFiniteNum(v.maxTasks) && (v.maxTasks as number) >= 1 && (v.maxTasks as number) <= 10000)],
    ['limitMode', v.limitMode === undefined || v.limitMode === 'hard' || v.limitMode === 'scroll'],
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
    // v31+: color no longer stored on people. Tolerate legacy exports that still
    // carry it (must be a valid color if present) and strip at pickPerson time.
    ['color', isOptColor(v.color)],
    ['orgId', isOptNum(v.orgId)], // backward compat: old exports may have orgId
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

const VALID_PRESETS = ['due-this-week']
// Legacy preset names accepted for pre-v21 imports; dropped at restore time.
const LEGACY_PRESETS = ['starred', 'high-priority']

const VALID_ATTR_FILTER_TYPES = ['priority', 'person', 'tag', 'org']

function isValidAttributeFilter(f: unknown): boolean {
  if (!isObj(f)) return false
  if (typeof f.type !== 'string' || !VALID_ATTR_FILTER_TYPES.includes(f.type)) return false
  switch (f.type) {
    case 'priority': return isFiniteNum(f.priority)
    case 'person': return isFiniteNum(f.personId) && isStr(f.personName, 200)
    case 'tag': return isFiniteNum(f.tagId) && isStr(f.tagName, 200) && isOptColor(f.tagColor)
    case 'org': return isFiniteNum(f.orgId) && isStr(f.orgName, 200) && isOptColor(f.orgColor)
    default: return false
  }
}

function checkListInset(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const hasPreset = v.preset != null
  const hasAttrFilter = v.attributeFilter != null
  const hasDefId = v.listDefinitionId != null
  // Post-v23: must have `listDefinitionId`. Pre-v23: must have preset or attributeFilter.
  if (!hasDefId && !hasPreset && !hasAttrFilter) {
    return 'listDefinitionId or legacy preset/attributeFilter required'
  }
  return checkFields(v, [
    // Pre-v23 legacy: `name` was required; post-v23 drops it. Accept either.
    ['name', v.name === undefined || isOptStr(v.name, 200)],
    ['listDefinitionId', !hasDefId || isFiniteNum(v.listDefinitionId)],
    ['preset', !hasPreset || (typeof v.preset === 'string' && (VALID_PRESETS.includes(v.preset) || LEGACY_PRESETS.includes(v.preset)))],
    ['attributeFilter', !hasAttrFilter || isValidAttributeFilter(v.attributeFilter)],
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['isCollapsed', isBool(v.isCollapsed)],
    // runtime-filter pick: post-v41 array, pre-v41 scalar, or absent.
    ['runtimeFilterValue', isOptRuntimeFilterValue(v.runtimeFilterValue)],
  ])
}

function isOptRuntimeFilterValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (Array.isArray(v)) return v.every((x) => isFiniteNum(x))
  return isFiniteNum(v)
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

// Accept BOTH legacy ('priority', 'due') and new ('date'/'scheduled'/'deadline')
// values so pre-v21 saved views pass validation. Phase 5's savedFiltersToRuntime
// translates legacy → runtime at load time.
const VALID_SORT_BY = ['date', 'scheduled', 'deadline', 'due', 'priority', 'people', 'tag', 'project', 'org', 'status']
const VALID_DATE_FIELDS = ['date', 'scheduled', 'deadline', 'due', 'created', 'modified']

function isOptNullableIntArray(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (!Array.isArray(v)) return false
  return v.every(item => typeof item === 'number' && Number.isInteger(item))
}

function isOptBool(v: unknown): boolean {
  return v === undefined || isBool(v)
}

const VALID_COMPLETED_FILTERS = ['all', 'incomplete', 'completed', 'incomplete-only']
const VALID_ASSIGNED_FILTERS = ['all', 'unassigned', 'assigned', 'unassigned-only']
const VALID_FOLLOWUP_FILTERS = ['all', 'followup', 'no-followup']

function isOptFilterStr(v: unknown, valid: string[]): boolean {
  return v === undefined || v === null || (typeof v === 'string' && valid.includes(v))
}

function checkSavedViewFilters(v: unknown): CheckResult {
  if (!isObj(v)) return 'filters: not an object'
  return checkFields(v, [
    ['priorities', isOptNullableIntArray(v.priorities)],               // v20→v21 legacy (ignored at runtime)
    ['showCompleted', isOptBool(v.showCompleted)],
    ['showHiddenStatuses', isOptBool(v.showHiddenStatuses)],
    // v19→v20 legacy — accepted for backward compat
    ['completedFilter', isOptFilterStr(v.completedFilter, VALID_COMPLETED_FILTERS)],
    ['assignedFilter', isOptFilterStr(v.assignedFilter, VALID_ASSIGNED_FILTERS)],
    ['followupFilter', isOptFilterStr(v.followupFilter, VALID_FOLLOWUP_FILTERS)],
    ['showAssigned', isOptBool(v.showAssigned)],
    ['starredOnly', isOptBool(v.starredOnly)],
    // v20→v21 legacy — accepted at validation, dropped at runtime
    ['hardDeadlineOnly', isOptBool(v.hardDeadlineOnly)],
    ['dateRangeIncludeNoDue', isOptBool(v.dateRangeIncludeNoDue)],
    // v21 new
    ['dateRangeIncludeNoDate', isOptBool(v.dateRangeIncludeNoDate)],
    ['personIds', isOptNullableIntArray(v.personIds)],
    ['personFilterMode', isOptFilterStr(v.personFilterMode, ['include-orgs', 'direct-only'])],
    ['tagIds', isOptNullableIntArray(v.tagIds)],
    ['orgIds', isOptNullableIntArray(v.orgIds)],
    ['orgFilterMode', isOptFilterStr(v.orgFilterMode, ['include-people', 'direct-only'])],
    ['statusIds', isOptNullableIntArray(v.statusIds)],
    ['dateField', v.dateField === undefined || (typeof v.dateField === 'string' && VALID_DATE_FIELDS.includes(v.dateField))],
    ['dateRangeStart', isOptDateAnchorOrLegacy(v.dateRangeStart)],
    ['dateRangeEnd', isOptDateAnchorOrLegacy(v.dateRangeEnd)],
    ['hasScheduled', isOptTriBool(v.hasScheduled)],
    ['hasDeadline', isOptTriBool(v.hasDeadline)],
  ])
}

/**
 * Legacy sticky-note row shape. Still accepted by import validation so
 * pre-v26 backups can load; `restoreFromImportData` translates them into
 * `notes` rows via `translateStickyToNote`.
 */
function checkStickyNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['title', isOptStr(v.title, 200)],
    ['text', typeof v.text === 'string' && v.text.length <= 50000],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['color', isOptColor(v.color)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
  ])
}

function checkNote(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['content', typeof v.content === 'string' && (v.content as string).length <= 500000],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    // Pre-v28 rows carry optional placement + color fields for canvas floating
    // notes. We tolerate them here so legacy backups still validate; the
    // restore pass translates the canvas-scoped rows into `floatingNotes`.
    ['canvasId', isOptNum(v.canvasId)],
    ['x', isOptNum(v.x)],
    ['y', isOptNum(v.y)],
    ['width', isOptNum(v.width)],
    ['height', isOptNum(v.height)],
    ['color', isOptColor(v.color)],
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
  // Pre-v33 exports carry a `name`; post-v33 drops it. Accept either.
  const basic = checkFields(v, [
    ['name', v.name === undefined || isOptStr(v.name, 200)],
    ['entries', Array.isArray(v.entries)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt-or-updatedAt', isDateLike(v.updatedAt)],
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
  // Pre-v33 exports carry `taskboardId`; post-v33 drops it. Accept either.
  return checkFields(v, [
    ['canvasId', isFiniteNum(v.canvasId)],
    ['taskboardId', v.taskboardId === undefined || isFiniteNum(v.taskboardId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
  ])
}

function checkSavedView(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const basic = checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['sortBy', typeof v.sortBy === 'string' && VALID_SORT_BY.includes(v.sortBy)],
    ['filters', isObj(v.filters)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
    ['maxTasks', v.maxTasks === undefined || (isFiniteNum(v.maxTasks) && (v.maxTasks as number) >= 1 && (v.maxTasks as number) <= 10000)],
    ['limitMode', v.limitMode === undefined || v.limitMode === 'hard' || v.limitMode === 'scroll'],
  ])
  if (basic !== true) return basic
  return checkSavedViewFilters(v.filters)
}

// `defaultTaskboardId` is a pre-v33 legacy key accepted here so backups still
// validate; restore / the v33 migration drops it from settings.
// `notesPinnedToDashboard` / `dashboardUserLists` / `dashboardTopOrder` are
// post-Dashboard dormant keys: store + setter surface retired in
// code-review-2026-04-25 P8, but the import-validation entries stay one
// release so older backups still validate. Restore strips them; schedule
// deletion of the entries one release later.
const VALID_SETTING_KEYS = ['themeMode', 'defaultProjectId', 'defaultStatusId', 'quickStatusId', 'seededAssignedStatusId', 'seededFollowupStatusId', 'completedRetentionDays', 'weekStartsOn', 'canvasViewport', 'horizonSlots', 'selectedHorizon', 'selectedHorizonDefId', 'horizonCollapsed', 'notesPinnedToDashboard', 'canvasRails', 'dashboardUserLists', 'dashboardTopOrder', 'defaultTaskboardId', 'maxTags', 'defaultProjectGroupBy', 'canvasMaxExtent']

// Post ui-consistency-2026-04-25 P4 the canonical "no grouping" sentinel for
// projects is `null` (carried as the empty string in the settings row), but
// `'none'` is also accepted because `defaultProjectGroupBy` shares the unified
// `TodoGroupBy` literal set.
const VALID_DEFAULT_PROJECT_GROUP_BY = ['', 'none', 'status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date'] as const

const SETTING_VALUE_MAX_LEN_DEFAULT = 200
const SETTING_VALUE_MAX_LEN_BY_KEY: Record<string, number> = {
  canvasRails: 8000,
  dashboardUserLists: 4000,
  canvasViewport: 200,
  horizonSlots: 500,
  horizonCollapsed: 500,
}

const MAX_HORIZON_ENTRIES = 16
const LEGACY_HORIZON_KEYS_SET = new Set<string>(LEGACY_HORIZON_KEYS as readonly string[])
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
      // Either the new tabs[] shape OR the legacy flat shape is accepted.
      if (Array.isArray(s.tabs)) {
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
      } else {
        if (typeof s.kind !== 'string' || !SLOT_KINDS_SET.has(s.kind)) return `${side}.slot.kind`
        if (s.listDefinitionId !== undefined && !Number.isFinite(s.listDefinitionId)) return `${side}.slot.listDefinitionId`
        if (s.taskboardId !== undefined && !Number.isFinite(s.taskboardId)) return `${side}.slot.taskboardId`
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

function isValidSettingKey(key: string): boolean {
  // Theme color rows can be either legacy `color.<key>` (pre-per-theme,
  // mapped to dark on load) or per-theme `color.dark.<key>` /
  // `color.light.<key>` (triage-2026-04-27 P4) — the prefix match accepts
  // all three.
  return VALID_SETTING_KEYS.includes(key) || key.startsWith('color.')
}

function checkSetting(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  if (!isStr(v.key, 100)) return 'key'
  if (typeof v.value !== 'string') return 'value'
  const maxLen = SETTING_VALUE_MAX_LEN_BY_KEY[v.key as string] ?? SETTING_VALUE_MAX_LEN_DEFAULT
  if ((v.value as string).length > maxLen) return 'value'
  if (!isValidSettingKey(v.key as string)) return 'key (unrecognized)'
  if (typeof v.key === 'string' && v.key.startsWith('color.')) {
    return isValidCssColor(v.value) ? true : 'value (invalid color)'
  }
  if (v.key === 'defaultProjectId' || v.key === 'defaultTaskboardId') {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : `value (${v.key} must be numeric)`
  }
  if (v.key === 'defaultStatusId' || v.key === 'quickStatusId' || v.key === 'seededAssignedStatusId' || v.key === 'seededFollowupStatusId') {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : `value (${v.key} must be numeric)`
  }
  if (v.key === 'completedRetentionDays') {
    const n = Number(v.value)
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? true : 'value (retention days out of range)'
  }
  if (v.key === 'weekStartsOn') {
    const n = Number(v.value)
    return n === 0 || n === 1 ? true : 'value (weekStartsOn must be 0 or 1)'
  }
  if (v.key === 'canvasRails') {
    let parsed: unknown
    try {
      parsed = JSON.parse(v.value as string)
    } catch {
      return 'value (canvasRails must be valid JSON)'
    }
    const res = validateRailsShape(parsed)
    return res === true ? true : `value (canvasRails: ${res})`
  }
  if (v.key === 'canvasViewport') {
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
  if (v.key === 'horizonSlots') {
    try {
      const parsed = JSON.parse(v.value as string) as unknown
      // Post-P6 shape: number[]. Legacy shape: Partial<Record<HorizonKey, number>>.
      // Both accepted so older backups still validate.
      if (Array.isArray(parsed)) {
        if (parsed.length > MAX_HORIZON_ENTRIES) return 'value (horizonSlots has too many entries)'
        for (const val of parsed) {
          if (typeof val !== 'number' || !Number.isInteger(val)) {
            return 'value (horizonSlots entries must be integer ids)'
          }
        }
        return true
      }
      if (parsed && typeof parsed === 'object') {
        const entries = Object.entries(parsed as Record<string, unknown>)
        if (entries.length > MAX_HORIZON_ENTRIES) return 'value (horizonSlots has too many entries)'
        for (const [k, val] of entries) {
          if (!LEGACY_HORIZON_KEYS_SET.has(k)) return `value (horizonSlots: unknown key "${k}")`
          if (typeof val !== 'number' || !Number.isInteger(val)) {
            return `value (horizonSlots.${k} must be an integer id)`
          }
        }
        return true
      }
      return 'value (horizonSlots must be an array or object)'
    } catch {
      return 'value (horizonSlots must be valid JSON)'
    }
  }
  if (v.key === 'horizonCollapsed') {
    // Retired in P6 — accept legacy boolean-map payloads from older backups
    // so they validate; restore strips the row from IndexedDB regardless.
    try {
      const parsed = JSON.parse(v.value as string) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'value (horizonCollapsed must be an object)'
      }
      const entries = Object.entries(parsed as Record<string, unknown>)
      if (entries.length > MAX_HORIZON_ENTRIES) return 'value (horizonCollapsed has too many entries)'
      for (const [k, val] of entries) {
        if (!LEGACY_HORIZON_KEYS_SET.has(k)) return `value (horizonCollapsed: unknown key "${k}")`
        if (typeof val !== 'boolean') return `value (horizonCollapsed.${k} must be boolean)`
      }
      return true
    } catch {
      return 'value (horizonCollapsed must be valid JSON)'
    }
  }
  if (v.key === 'selectedHorizon') {
    // Legacy key (HorizonKey string). Settings load resolves it to
    // `selectedHorizonDefId` via the legacy map; accepted here for backup compat.
    return LEGACY_HORIZON_KEYS_SET.has(v.value as string)
      ? true
      : `value (selectedHorizon must be one of: ${(LEGACY_HORIZON_KEYS as readonly string[]).join(', ')})`
  }
  if (v.key === 'selectedHorizonDefId') {
    if (v.value === '' || v.value == null) return true
    const n = Number(v.value)
    return Number.isFinite(n) ? true : 'value (selectedHorizonDefId must be numeric or empty)'
  }
  if (v.key === 'defaultProjectGroupBy') {
    return (VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).includes(v.value as string)
      ? true
      : `value (defaultProjectGroupBy must be one of: ${(VALID_DEFAULT_PROJECT_GROUP_BY as readonly string[]).filter(Boolean).join(', ')} or empty)`
  }
  if (v.key === 'canvasMaxExtent') {
    const n = Number(v.value)
    return Number.isFinite(n) && n >= 1000 && n <= 100000
      ? true
      : 'value (canvasMaxExtent must be a finite number in [1000, 100000])'
  }
  // `notesPinnedToDashboard` / `dashboardUserLists` / `dashboardTopOrder` are
  // accepted as legacy keys (see VALID_SETTING_KEYS comment); restore strips
  // them so the format is irrelevant. Length bounded by SETTING_VALUE_MAX_LEN_BY_KEY.
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
    // Legacy fields preserved so restore can translate them. Post-restore translation deletes them.
    ...(v.priority != null ? { priority: v.priority } : {}),
    ...(v.isHardDeadline != null ? { isHardDeadline: v.isHardDeadline } : {}),
    ...(v.isStarred != null ? { isStarred: v.isStarred } : {}),
    ...(v.isAssigned != null ? { isAssigned: v.isAssigned } : {}),
    // Legacy inline tags (post-v35, pre-v37). Preserved for restore-side
    // translation into the registry; stripped before bulk-add.
    ...(Array.isArray(v.tags) && v.tags.length > 0 ? { tags: v.tags as string[] } : {}),
  } as TodoItem
}

function pickStatus(v: Record<string, unknown>): Status {
  return {
    id: v.id as number | undefined, name: v.name as string, color: v.color as string, sortOrder: v.sortOrder as number,
    ...(v.icon != null ? { icon: v.icon as string } : {}),
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

/**
 * Post-v23 `ListInset` only has `listDefinitionId`. Pre-v23 rows still carry
 * `preset` / `attributeFilter` / `name`; `restoreFromImportData` translates
 * them into fresh ListDefinitions before write. The import stage keeps the
 * legacy fields visible so the translator has something to consume.
 */
export type LegacyAttributeFilter =
  | { type: 'person'; personId: number; personName: string }
  | { type: 'tag'; tagId: number; tagName: string; tagColor?: string } // pre-v29: translated to a `#tagname` text-search predicate by buildListDefFromLegacyInset
  | { type: 'org'; orgId: number; orgName: string; orgColor?: string }

export interface ImportListInset {
  id?: number
  listDefinitionId?: number
  name?: string
  preset?: string
  attributeFilter?: LegacyAttributeFilter
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  isCollapsed: boolean
  /**
   * Runtime-filter pick. Always emitted as `number[]` (the post-v41 shape);
   * `pickListInset` lifts a legacy scalar `number` into `[number]` so the
   * restore path doesn't need to re-run the v41 migration.
   */
  runtimeFilterValue?: number[]
}

function pickAttributeFilter(f: Record<string, unknown>): LegacyAttributeFilter | undefined {
  switch (f.type) {
    // 'priority' is a retired v20 attribute; the inset row is dropped before
    // write in restore, so accepting it here is a no-op. Return undefined so
    // the inset picker drops the filter cleanly if a caller ever surfaces one.
    case 'priority': return undefined
    case 'person': return { type: 'person', personId: f.personId as number, personName: f.personName as string }
    case 'tag': return { type: 'tag', tagId: f.tagId as number, tagName: f.tagName as string, ...(f.tagColor != null ? { tagColor: f.tagColor as string } : {}) }
    case 'org': return { type: 'org', orgId: f.orgId as number, orgName: f.orgName as string, ...(f.orgColor != null ? { orgColor: f.orgColor as string } : {}) }
    default: return undefined
  }
}

function pickListInset(v: Record<string, unknown>): ImportListInset {
  return {
    id: v.id as number | undefined,
    ...(v.listDefinitionId != null ? { listDefinitionId: v.listDefinitionId as number } : {}),
    ...(v.name != null ? { name: v.name as string } : {}),
    ...(v.preset != null ? { preset: v.preset as string } : {}),
    ...(v.attributeFilter != null ? { attributeFilter: pickAttributeFilter(v.attributeFilter as Record<string, unknown>) } : {}),
    canvasId: v.canvasId as number, x: v.x as number, y: v.y as number,
    width: v.width as number, height: v.height as number, isCollapsed: v.isCollapsed as boolean,
    ...(pickRuntimeFilterValue(v.runtimeFilterValue) ?? {}),
  }
}

function pickRuntimeFilterValue(v: unknown): { runtimeFilterValue: number[] } | undefined {
  if (Array.isArray(v)) {
    const ids: number[] = []
    for (const x of v) if (typeof x === 'number' && Number.isFinite(x)) ids.push(x)
    return ids.length > 0 ? { runtimeFilterValue: ids } : undefined
  }
  if (typeof v === 'number' && Number.isFinite(v)) return { runtimeFilterValue: [v] }
  return undefined
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

/**
 * Parsed legacy sticky shape. `restoreFromImportData` translates instances
 * of this into `notes` rows via `translateStickyToNote`.
 */
export interface ImportStickyNote {
  id?: number
  canvasId: number
  title?: string
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  createdAt: Date
  modifiedAt: Date
}

function pickStickyNote(v: Record<string, unknown>): ImportStickyNote {
  return {
    id: v.id as number | undefined,
    canvasId: v.canvasId as number,
    ...(v.title != null ? { title: v.title as string } : {}),
    text: v.text as string,
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    ...(v.color != null ? { color: v.color as string } : {}),
    createdAt: v.createdAt as Date,
    modifiedAt: v.modifiedAt as Date,
  }
}

function pickSavedViewFilters(v: Record<string, unknown>): LegacySavedViewFilters {
  return {
    // Legacy + new coexist in the parsed structure. Translation at runtime.
    ...(v.priorities !== undefined ? { priorities: v.priorities as number[] | null } : {}),
    showCompleted: (v.showCompleted as boolean) ?? false,
    showHiddenStatuses: (v.showHiddenStatuses as boolean) ?? false,
    // v19→v20 legacy — preserved for savedFiltersToPredicate translation at load time
    ...(v.completedFilter !== undefined ? { completedFilter: v.completedFilter as string } : {}),
    ...(v.assignedFilter !== undefined ? { assignedFilter: v.assignedFilter as string } : {}),
    ...(v.followupFilter !== undefined ? { followupFilter: v.followupFilter as string } : {}),
    ...(v.showAssigned !== undefined ? { showAssigned: v.showAssigned as boolean } : {}),
    ...(v.starredOnly !== undefined ? { starredOnly: v.starredOnly as boolean } : {}),
    // v20→v21 legacy — preserved for translation
    ...(v.hardDeadlineOnly !== undefined ? { hardDeadlineOnly: v.hardDeadlineOnly as boolean } : {}),
    ...(v.dateRangeIncludeNoDue !== undefined ? { dateRangeIncludeNoDue: v.dateRangeIncludeNoDue as boolean } : {}),
    // v21 new — required; fall through to false when absent
    dateRangeIncludeNoDate: (v.dateRangeIncludeNoDate as boolean) ?? false,
    personIds: v.personIds as number[] | null,
    ...(v.personFilterMode !== undefined ? { personFilterMode: v.personFilterMode as LegacySavedViewFilters['personFilterMode'] } : {}),
    // v29 retired tags; pre-v29 backups may carry tagIds — silently dropped here.
    orgIds: v.orgIds as number[] | null,
    ...(v.orgFilterMode !== undefined ? { orgFilterMode: v.orgFilterMode as LegacySavedViewFilters['orgFilterMode'] } : {}),
    ...(v.projectIds !== undefined ? { projectIds: v.projectIds as number[] | null } : {}),
    ...(v.statusIds !== undefined ? { statusIds: v.statusIds as number[] | null } : {}),
    ...(v.dateField !== undefined ? { dateField: v.dateField as LegacySavedViewFilters['dateField'] } : {}),
    ...(v.dateRangeStart !== undefined ? { dateRangeStart: v.dateRangeStart as LegacySavedViewFilters['dateRangeStart'] } : {}),
    ...(v.dateRangeEnd !== undefined ? { dateRangeEnd: v.dateRangeEnd as LegacySavedViewFilters['dateRangeEnd'] } : {}),
    ...(v.hasScheduled !== undefined ? { hasScheduled: v.hasScheduled as boolean | null } : {}),
    ...(v.hasDeadline !== undefined ? { hasDeadline: v.hasDeadline as boolean | null } : {}),
  }
}

function pickSavedView(v: Record<string, unknown>): LegacySavedView {
  return {
    id: v.id as number | undefined,
    name: v.name as string,
    sortBy: v.sortBy as LegacySavedView['sortBy'],
    ...(v.groupBy !== undefined ? { groupBy: v.groupBy as LegacySavedView['groupBy'] } : {}),
    ...(v.itemSortBy !== undefined ? { itemSortBy: v.itemSortBy as LegacySavedView['itemSortBy'] } : {}),
    filters: pickSavedViewFilters(v.filters as Record<string, unknown>),
    sortOrder: v.sortOrder as number,
    ...(v.maxTasks !== undefined ? { maxTasks: v.maxTasks as number } : {}),
    ...(v.limitMode !== undefined ? { limitMode: v.limitMode as LegacySavedView['limitMode'] } : {}),
  }
}

function pickTaskboardEntry(v: Record<string, unknown>): TaskboardEntry {
  return { todoId: v.todoId as number, sortOrder: v.sortOrder as number }
}

function pickTaskboard(v: Record<string, unknown>): import('../models').Taskboard {
  // `name` silently dropped (v33 collapse to singleton).
  return {
    id: v.id as number | undefined,
    entries: ((v.entries ?? []) as Record<string, unknown>[]).map(pickTaskboardEntry),
    createdAt: v.createdAt as Date,
    updatedAt: v.updatedAt as Date,
  }
}

function pickFloatingTaskboard(v: Record<string, unknown>): import('../models').FloatingTaskboard {
  // `taskboardId` silently dropped (v33 collapse to singleton).
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

/**
 * Parsed note shape. Post-v28 `Note` is content-only; pre-v28 rows may carry
 * canvasId + placement + color. We keep those fields here (`LegacyNoteFields`)
 * so restore can split them out into `floatingNotes` before the cleaned-up
 * row lands in the `notes` table.
 */
export type LegacyNoteFields = {
  canvasId?: number
  x?: number
  y?: number
  width?: number
  height?: number
  color?: string
}
export type ImportNote = Note & LegacyNoteFields

function pickNote(v: Record<string, unknown>): ImportNote {
  return {
    id: v.id as number | undefined,
    content: v.content as string,
    createdAt: v.createdAt as Date,
    modifiedAt: v.modifiedAt as Date,
    ...(v.canvasId != null ? { canvasId: v.canvasId as number } : {}),
    ...(v.x != null ? { x: v.x as number } : {}),
    ...(v.y != null ? { y: v.y as number } : {}),
    ...(v.width != null ? { width: v.width as number } : {}),
    ...(v.height != null ? { height: v.height as number } : {}),
    ...(v.color != null ? { color: v.color as string } : {}),
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

function pickListDefinition(v: Record<string, unknown>): ListDefinition {
  // Normalise legacy discriminated-union shapes for `sort` / `grouping` to
  // the flat literal — pre-v46 backups carry the union; the runtime expects
  // the flat shape (ui-consistency-2026-04-25 P4).
  const flatSort = flattenListSortValue(v.sort)
  const flatGrouping = flattenListGroupingValue(v.grouping, flatSort)
  return {
    id: v.id as number | undefined,
    name: v.name as string,
    sortOrder: v.sortOrder as number,
    membership: v.membership as ListMembership,
    sort: flatSort as ListSort,
    grouping: flatGrouping as ListGrouping,
    // v21 exports omit pinnedToDashboard; treat as pinned (matches v22 migration).
    // v21 `seededKey` is silently dropped.
    pinnedToDashboard: typeof v.pinnedToDashboard === 'boolean' ? v.pinnedToDashboard : true,
    // Pre-v39 exports omit favorited; default to false (matches v39 backfill).
    favorited: typeof v.favorited === 'boolean' ? v.favorited : false,
    ...(typeof v.maxTasks === 'number' ? { maxTasks: v.maxTasks } : {}),
    ...(v.limitMode === 'hard' || v.limitMode === 'scroll' ? { limitMode: v.limitMode } : {}),
    ...(v.runtimeFilter != null ? { runtimeFilter: v.runtimeFilter as ListDefinition['runtimeFilter'] } : {}),
  }
}

// --- Main validation ---

export const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_RECORDS_PER_TABLE = 100_000

type TableValidator = { key: string; check: (v: unknown) => CheckResult; required?: boolean }

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
  { key: 'savedViews', check: checkSavedView },
  { key: 'stickyNotes', check: checkStickyNote },
  { key: 'taskboardEntries', check: checkTaskboardEntry },
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

export interface ImportData {
  canvases: Canvas[]
  projects: Project[]
  todos: TodoItem[]
  people: Person[]
  /**
   * Tag registry rows. Pre-v29 backups: baked into titles by restore.
   * Post-v36 backups: bulk-added into the `tags` table. Absent for v29–v35.
   */
  tags?: ImportTag[]
  listInsets: ImportListInset[]
  /**
   * Tag assignment rows. Pre-v29 backups: join data for title-baking.
   * Post-v36 backups: bulk-added into `todoTags`. Absent for v29–v35.
   */
  todoTags?: ImportTodoTag[]
  todoPeople: TodoPerson[]
  todoOrgs: TodoOrg[]
  personOrgs: PersonOrg[]
  settings: SettingRow[]
  orgs: Org[]
  /**
   * Pre-v39 backups carry saved-view rows. Restore translates each into a
   * favorited `ListDefinition` via `savedViewToListDefinition`; the table no
   * longer exists post-v39. Absent for post-v39 backups.
   */
  savedViews: LegacySavedView[]
  stickyNotes: ImportStickyNote[]
  /** Pre-v30 queue rows. Restore path collapses them into `taskboards[0].entries`. */
  taskboardEntries: TaskboardEntry[]
  taskboards: import('../models').Taskboard[]
  floatingTaskboards: import('../models').FloatingTaskboard[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: ImportNote[]
  floatingCalendars: FloatingCalendar[]
  floatingNotes: FloatingNote[]
  floatingHorizons: FloatingHorizons[]
  floatingStatus: FloatingStatus[]
  floatingScoreboard: FloatingScoreboard[]
  floatingSnoozeGraveyard: FloatingSnoozeGraveyard[]
  /**
   * Append-only history log (Dexie v42). Backfilled on in-place upgrade and
   * accumulates per-mutation events thereafter; restored verbatim on import.
   * Older backups omit the field — restore treats it as empty.
   */
  todoEvents: TodoEvent[]
}

export function validateImportData(data: unknown): { ok: true; data: ImportData } | { ok: false; error: string } {
  if (!isObj(data)) {
    return { ok: false, error: 'Import data is not an object' }
  }

  // Clone to avoid mutating the caller's object during backward-compat transforms
  const raw = structuredClone(data) as Record<string, unknown>

  // Backward compat: accept "groups" as "projects"
  if (!raw.projects && raw.groups) {
    raw.projects = raw.groups
  }

  // Backward compat: remap groupId → projectId on todos
  if (Array.isArray(raw.todos)) {
    for (const t of raw.todos) {
      if (isObj(t)) {
        if ('groupId' in t && !('projectId' in t)) {
          t.projectId = t.groupId
        }
        delete t.groupId
        delete t.assignedPerson
      }
    }
  }

  // Required: canvases must be a non-empty array
  if (!Array.isArray(raw.canvases) || raw.canvases.length === 0) {
    return { ok: false, error: 'File is not a valid TODO2 database (missing canvases)' }
  }

  // Validate each table
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

  // Reconstruct records from known fields only (strips __proto__, constructor, etc.)
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
      listInsets: ((raw.listInsets ?? []) as Record<string, unknown>[])
        .map(pickListInset)
        // Drop legacy-preset insets AND insets whose attributeFilter was stripped
        // (e.g. retired `type: 'priority'`) leaving them filterless.
        .filter(li => !(li.preset && LEGACY_PRESETS.includes(li.preset)))
        // Keep only rows that will produce a usable entry: either a v23+
        // listDefinitionId or a legacy shape restore can translate.
        .filter(li => li.listDefinitionId != null || li.preset != null || li.attributeFilter != null),
      ...(Array.isArray(raw.todoTags) && raw.todoTags.length > 0
        ? { todoTags: (raw.todoTags as Record<string, unknown>[]).map(pickTodoTag) }
        : {}),
      todoPeople: ((raw.todoPeople ?? []) as Record<string, unknown>[]).map(pickTodoPerson),
      todoOrgs: ((raw.todoOrgs ?? []) as Record<string, unknown>[]).map(pickTodoOrg),
      personOrgs: migratePersonOrgs(raw),
      settings: ((raw.settings ?? []) as Record<string, unknown>[]).map(pickSetting),
      orgs: ((raw.orgs ?? []) as Record<string, unknown>[]).map(pickOrg),
      savedViews: ((raw.savedViews ?? []) as Record<string, unknown>[]).map(pickSavedView),
      stickyNotes: ((raw.stickyNotes ?? []) as Record<string, unknown>[]).map(pickStickyNote),
      taskboardEntries: ((raw.taskboardEntries ?? []) as Record<string, unknown>[]).map(pickTaskboardEntry),
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

/** Build personOrgs from explicit table or migrate from legacy person.orgId */
function migratePersonOrgs(raw: Record<string, unknown>): PersonOrg[] {
  // Use explicit personOrgs table if present
  if (Array.isArray(raw.personOrgs) && raw.personOrgs.length > 0) {
    return (raw.personOrgs as Record<string, unknown>[]).map(pickPersonOrg)
  }
  // Backward compat: convert person.orgId to personOrgs entries
  const personOrgs: PersonOrg[] = []
  if (Array.isArray(raw.people)) {
    for (const p of raw.people) {
      if (isObj(p) && p.orgId != null && typeof p.orgId === 'number') {
        personOrgs.push({ personId: p.id as number, orgId: p.orgId as number })
      }
    }
  }
  return personOrgs
}
