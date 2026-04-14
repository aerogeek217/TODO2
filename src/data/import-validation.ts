import { Priority } from '../models/priority'
import type { TodoItem, Project, Canvas, Person, Tag, ListInset, TodoTag, TodoPerson, TodoOrg, PersonOrg, Org, RecurrenceRule, SavedView, StickyNote, TaskboardEntry, Status } from '../models'

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

// --- Color validation ---

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isValidCssColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

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
  ])
}

function checkTodo(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['title', isStr(v.title, 500)],
    ['notes', isOptStr(v.notes, 50000)],
    ['progress', isOptStr(v.progress, 500)],
    ['priority', typeof v.priority === 'number' && [Priority.Normal, Priority.Medium, Priority.High].includes(v.priority)],
    ['isCompleted', isBool(v.isCompleted)],
    ['isStarred', isBool(v.isStarred)],
    ['dueDate', isOptDateLike(v.dueDate)],
    ['isAssigned', v.isAssigned === undefined || v.isAssigned === null || isBool(v.isAssigned)],
    ['isHardDeadline', v.isHardDeadline === undefined || v.isHardDeadline === null || isBool(v.isHardDeadline)],
    ['recurrenceRule', isOptRecurrenceRule(v.recurrenceRule)],
    ['createdAt', isDateLike(v.createdAt)],
    ['modifiedAt', isDateLike(v.modifiedAt)],
    ['projectId', isOptNum(v.projectId)],
    ['canvasId', isOptNum(v.canvasId)],
    ['parentId', isOptNum(v.parentId)],
    ['statusId', isOptNum(v.statusId)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

function checkStatus(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['color', isValidCssColor(v.color)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

function checkPerson(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['initials', isStr(v.initials, 4)],
    ['color', isValidCssColor(v.color)],
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

const VALID_PRESETS = ['due-this-week', 'starred', 'high-priority']

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
  if (!hasPreset && !hasAttrFilter) return 'preset or attributeFilter required'
  return checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['preset', !hasPreset || (typeof v.preset === 'string' && VALID_PRESETS.includes(v.preset))],
    ['attributeFilter', !hasAttrFilter || isValidAttributeFilter(v.attributeFilter)],
    ['canvasId', isFiniteNum(v.canvasId)],
    ['x', isFiniteNum(v.x)],
    ['y', isFiniteNum(v.y)],
    ['width', isFiniteNum(v.width)],
    ['height', isFiniteNum(v.height)],
    ['isCollapsed', isBool(v.isCollapsed)],
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

const VALID_SORT_BY = ['priority', 'due', 'people', 'tag', 'project', 'org', 'status']
const VALID_DATE_FIELDS = ['due', 'created', 'modified']

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
    ['priorities', isOptNullableIntArray(v.priorities)],
    // Accept both new string filters and old boolean fields
    ['completedFilter', isOptFilterStr(v.completedFilter, VALID_COMPLETED_FILTERS)],
    ['assignedFilter', isOptFilterStr(v.assignedFilter, VALID_ASSIGNED_FILTERS)],
    ['followupFilter', isOptFilterStr(v.followupFilter, VALID_FOLLOWUP_FILTERS)],
    ['showCompleted', isOptBool(v.showCompleted)],
    ['showAssigned', isOptBool(v.showAssigned)],
    ['starredOnly', isOptBool(v.starredOnly)],
    ['hardDeadlineOnly', isOptBool(v.hardDeadlineOnly)],
    ['personIds', isOptNullableIntArray(v.personIds)],
    ['tagIds', isOptNullableIntArray(v.tagIds)],
    ['orgIds', isOptNullableIntArray(v.orgIds)],
    ['orgFilterMode', isOptFilterStr(v.orgFilterMode, ['include-people', 'direct-only'])],
    ['statusIds', isOptNullableIntArray(v.statusIds)],
    ['dateField', v.dateField === undefined || (typeof v.dateField === 'string' && VALID_DATE_FIELDS.includes(v.dateField))],
    ['dateRangeStart', isOptDateLike(v.dateRangeStart)],
    ['dateRangeEnd', isOptDateLike(v.dateRangeEnd)],
    ['dateRangeIncludeNoDue', isOptBool(v.dateRangeIncludeNoDue)],
  ])
}

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

function checkTaskboardEntry(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  return checkFields(v, [
    ['todoId', isFiniteNum(v.todoId)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
}

function checkSavedView(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  const basic = checkFields(v, [
    ['name', isStr(v.name, 200)],
    ['sortBy', typeof v.sortBy === 'string' && VALID_SORT_BY.includes(v.sortBy)],
    ['filters', isObj(v.filters)],
    ['sortOrder', isFiniteNum(v.sortOrder)],
  ])
  if (basic !== true) return basic
  return checkSavedViewFilters(v.filters)
}

const VALID_SETTING_KEYS = ['themeMode', 'defaultProjectId', 'defaultStatusId', 'completedRetentionDays', 'canvasViewport']

function isValidSettingKey(key: string): boolean {
  return VALID_SETTING_KEYS.includes(key) || key.startsWith('color.')
}

function checkSetting(v: unknown): CheckResult {
  if (!isObj(v)) return 'not an object'
  if (!isStr(v.key, 100)) return 'key'
  if (typeof v.value !== 'string' || (v.value as string).length > 200) return 'value'
  if (!isValidSettingKey(v.key as string)) return 'key (unrecognized)'
  if (typeof v.key === 'string' && v.key.startsWith('color.')) {
    return isValidCssColor(v.value) ? true : 'value (invalid color)'
  }
  if (v.key === 'defaultProjectId') {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : 'value (defaultProjectId must be numeric)'
  }
  if (v.key === 'defaultStatusId') {
    const n = Number(v.value)
    return Number.isFinite(n) ? true : 'value (defaultStatusId must be numeric)'
  }
  if (v.key === 'completedRetentionDays') {
    const n = Number(v.value)
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? true : 'value (retention days out of range)'
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
  }
}

function pickTodo(v: Record<string, unknown>): TodoItem {
  return {
    id: v.id as number | undefined, title: v.title as string, priority: v.priority as number,
    isCompleted: v.isCompleted as boolean, isStarred: v.isStarred as boolean,
    createdAt: v.createdAt as Date, modifiedAt: v.modifiedAt as Date, sortOrder: v.sortOrder as number,
    ...(v.notes != null ? { notes: v.notes as string } : {}),
    ...(v.progress != null ? { progress: v.progress as string } : {}),
    ...(v.dueDate != null ? { dueDate: v.dueDate as Date } : {}),
    ...(v.isAssigned != null ? { isAssigned: v.isAssigned as boolean } : {}),
    ...(v.isHardDeadline != null ? { isHardDeadline: v.isHardDeadline as boolean } : {}),
    ...(v.recurrenceRule != null ? { recurrenceRule: v.recurrenceRule as RecurrenceRule } : {}),
    ...(v.projectId != null ? { projectId: v.projectId as number } : {}),
    ...(v.canvasId != null ? { canvasId: v.canvasId as number } : {}),
    ...(v.parentId != null ? { parentId: v.parentId as number } : {}),
    ...(v.statusId != null ? { statusId: v.statusId as number } : {}),
  }
}

function pickStatus(v: Record<string, unknown>): Status {
  return { id: v.id as number | undefined, name: v.name as string, color: v.color as string, sortOrder: v.sortOrder as number }
}

function pickPerson(v: Record<string, unknown>): Person {
  return { id: v.id as number | undefined, name: v.name as string, initials: v.initials as string, color: v.color as string }
}

function pickOrg(v: Record<string, unknown>): Org {
  return {
    id: v.id as number | undefined, name: v.name as string,
    ...(v.initials != null ? { initials: v.initials as string } : {}),
    ...(v.color != null ? { color: v.color as string } : {}),
  }
}

function pickTag(v: Record<string, unknown>): Tag {
  return { id: v.id as number | undefined, name: v.name as string, color: v.color as string }
}

function pickAttributeFilter(f: Record<string, unknown>): ListInset['attributeFilter'] {
  switch (f.type) {
    case 'priority': return { type: 'priority', priority: f.priority as number }
    case 'person': return { type: 'person', personId: f.personId as number, personName: f.personName as string }
    case 'tag': return { type: 'tag', tagId: f.tagId as number, tagName: f.tagName as string, ...(f.tagColor != null ? { tagColor: f.tagColor as string } : {}) }
    case 'org': return { type: 'org', orgId: f.orgId as number, orgName: f.orgName as string, ...(f.orgColor != null ? { orgColor: f.orgColor as string } : {}) }
    default: return undefined
  }
}

function pickListInset(v: Record<string, unknown>): ListInset {
  return {
    id: v.id as number | undefined, name: v.name as string,
    ...(v.preset != null ? { preset: v.preset as ListInset['preset'] } : {}),
    ...(v.attributeFilter != null ? { attributeFilter: pickAttributeFilter(v.attributeFilter as Record<string, unknown>) } : {}),
    canvasId: v.canvasId as number, x: v.x as number, y: v.y as number,
    width: v.width as number, height: v.height as number, isCollapsed: v.isCollapsed as boolean,
  }
}

function pickTodoTag(v: Record<string, unknown>): TodoTag {
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

function pickStickyNote(v: Record<string, unknown>): StickyNote {
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

function pickSavedViewFilters(v: Record<string, unknown>): SavedView['filters'] {
  // Normalize: prefer new string fields, fall back to old booleans
  const completedFilter = (v.completedFilter as string) ?? ((v.showCompleted as boolean) ? 'all' : 'incomplete-only')
  const assignedFilter = (v.assignedFilter as string) ?? ((v.showAssigned as boolean) ? 'all' : 'unassigned-only')
  const followupFilter = (v.followupFilter as string) ?? ((v.starredOnly as boolean) ? 'followup' : 'all')
  return {
    priorities: v.priorities as number[] | null,
    completedFilter,
    assignedFilter,
    followupFilter,
    // Backward compat: dual-write old boolean fields
    showCompleted: completedFilter !== 'incomplete' && completedFilter !== 'incomplete-only',
    showAssigned: assignedFilter !== 'unassigned' && assignedFilter !== 'unassigned-only',
    starredOnly: followupFilter === 'followup',
    hardDeadlineOnly: (v.hardDeadlineOnly as boolean) ?? false,
    personIds: v.personIds as number[] | null,
    tagIds: v.tagIds as number[] | null,
    orgIds: v.orgIds as number[] | null,
    ...(v.orgFilterMode !== undefined ? { orgFilterMode: v.orgFilterMode as SavedView['filters']['orgFilterMode'] } : {}),
    ...(v.statusIds !== undefined ? { statusIds: v.statusIds as number[] | null } : {}),
    dateRangeIncludeNoDue: (v.dateRangeIncludeNoDue as boolean) ?? false,
    ...(v.dateField !== undefined ? { dateField: v.dateField as SavedView['filters']['dateField'] } : {}),
    ...(v.dateRangeStart !== undefined ? { dateRangeStart: v.dateRangeStart as string | null } : {}),
    ...(v.dateRangeEnd !== undefined ? { dateRangeEnd: v.dateRangeEnd as string | null } : {}),
  }
}

function pickSavedView(v: Record<string, unknown>): SavedView {
  return {
    id: v.id as number | undefined,
    name: v.name as string,
    sortBy: v.sortBy as SavedView['sortBy'],
    filters: pickSavedViewFilters(v.filters as Record<string, unknown>),
    sortOrder: v.sortOrder as number,
  }
}

function pickTaskboardEntry(v: Record<string, unknown>): TaskboardEntry {
  return { id: v.id as number | undefined, todoId: v.todoId as number, sortOrder: v.sortOrder as number }
}

function pickSetting(v: Record<string, unknown>): SettingRow {
  return { key: v.key as string, value: v.value as string }
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
  { key: 'statuses', check: checkStatus },
]

export interface ImportData {
  canvases: Canvas[]
  projects: Project[]
  todos: TodoItem[]
  people: Person[]
  tags: Tag[]
  listInsets: ListInset[]
  todoTags: TodoTag[]
  todoPeople: TodoPerson[]
  todoOrgs: TodoOrg[]
  personOrgs: PersonOrg[]
  settings: SettingRow[]
  orgs: Org[]
  savedViews: SavedView[]
  stickyNotes: StickyNote[]
  taskboardEntries: TaskboardEntry[]
  statuses: Status[]
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
      tags: ((raw.tags ?? []) as Record<string, unknown>[]).map(pickTag),
      listInsets: ((raw.listInsets ?? []) as Record<string, unknown>[]).map(pickListInset),
      todoTags: ((raw.todoTags ?? []) as Record<string, unknown>[]).map(pickTodoTag),
      todoPeople: ((raw.todoPeople ?? []) as Record<string, unknown>[]).map(pickTodoPerson),
      todoOrgs: ((raw.todoOrgs ?? []) as Record<string, unknown>[]).map(pickTodoOrg),
      personOrgs: migratePersonOrgs(raw),
      settings: ((raw.settings ?? []) as Record<string, unknown>[]).map(pickSetting),
      orgs: ((raw.orgs ?? []) as Record<string, unknown>[]).map(pickOrg),
      savedViews: ((raw.savedViews ?? []) as Record<string, unknown>[]).map(pickSavedView),
      stickyNotes: ((raw.stickyNotes ?? []) as Record<string, unknown>[]).map(pickStickyNote),
      taskboardEntries: ((raw.taskboardEntries ?? []) as Record<string, unknown>[]).map(pickTaskboardEntry),
      statuses: ((raw.statuses ?? []) as Record<string, unknown>[]).map(pickStatus),
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
