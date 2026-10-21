import { DATE_FIELD_VALUES, type DateField, type PersistedTodoItem, type Person, type Status, type Tag, type TodoItem } from '../models'
import { EISENHOWER_QUADRANTS, type EisenhowerQuadrant } from '../models/workspace-layout'
import type { TodoNameLookups } from './filter'
import { filterChips, type FilterChipField, type FilterChipNames } from './filter-chips'
import { predicateToCriteria, type FilterCriteria } from './filter-criteria'
import { DATE_FIELD_LABELS_SHORT } from './filter-labels'
import { matchesFilterWithLookups, type FilterSettings } from './filter-match'
import { isHotFilter, MARKER_LABELS } from './markers'
import { isEffectivelyUrgent, isUrgentByDate, URGENT_BY_DATE_HINT, urgentByDateSentence, type UrgentDueWithinDays } from './urgency'
import { paneWrites, QUADRANT_ADD_HINT, QUADRANT_NAME, type EisenhowerPane, type PaneEntityField } from './eisenhower-panes'

/**
 * The Eisenhower matrix: a task shows in the first pane (in position order)
 * whose filter it matches, or in none (`classifyPanes`). The default panes
 * are the classic quadrants of effective Urgent (flag OR due within the
 * app-wide range, see `utils/urgency`) × Important. Dropping a task on a pane
 * writes what the pane's filter implies (`resolvePaneDrop`) — and is refused
 * when the task still wouldn't land there, e.g. a task urgent by its due date
 * dropped on a not-urgent pane (clearing a flag wouldn't move it; the urgent
 * flag is never written for it).
 */

type MatrixFields = Pick<TodoItem, 'urgent' | 'important' | 'dueDate' | 'isCompleted'>
type SortFields = Pick<TodoItem, 'dueDate' | 'isCompleted' | 'sortOrder'>

/**
 * Order inside a quadrant: open before completed; then by due date (overdue
 * first, as the earliest), tasks without a due date last; ties by `sortOrder`.
 *
 * Not `compareTodosByDate('deadline')` (the lists' Due sort), which it
 * resembles: a quadrant also sinks completed tasks (a list leaves that to its
 * grouping / filter), compares the due dates as stored rather than by day,
 * and keeps the input order on a `sortOrder` tie instead of ordering by id.
 */
export function compareInQuadrant(a: SortFields, b: SortFields): number {
  if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
  const ad = a.dueDate ? new Date(a.dueDate).getTime() : null
  const bd = b.dueDate ? new Date(b.dueDate).getTime() : null
  if (ad != null && bd != null && ad !== bd) return ad - bd
  if (ad != null && bd == null) return -1
  if (ad == null && bd != null) return 1
  return a.sortOrder - b.sortOrder
}

/** Where a task would land among a quadrant's sorted tasks (its index without it). */
export function insertionIndex<T extends SortFields & { id: number }>(sorted: readonly T[], task: T): number {
  const others = sorted.filter((t) => t.id !== task.id)
  const i = others.findIndex((t) => compareInQuadrant(task, t) < 0)
  return i === -1 ? others.length : i
}

// ── Panes ─────────────────────────────────────────────────────────────────

/** What pane classification and the drop rules read besides the task itself. */
export interface PaneContext {
  today: Date
  /** The urgent range and Hot rule (Priority clauses), the week start (date clauses). */
  settings: FilterSettings
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  assignedTagsMap: ReadonlyMap<number, readonly Tag[]>
  /** Names for text clauses and messages (a drop may add a person / tag the task hasn't got yet). */
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
}

/**
 * A task as the pane filters see it: its fields, and the lookups its people /
 * tags / status names are read from (`matchesFilterWithLookups` — the one
 * evaluation path the lists and the screen filter use).
 */
interface TaskView {
  todo: PersistedTodoItem
  lookups: TodoNameLookups
}

interface PaneMatcher {
  viewOf: (todo: PersistedTodoItem) => TaskView
  /** `view` with `change` applied (a drop's writes, before they are made). */
  applied: (view: TaskView, change: PaneChange) => TaskView
  /** The first pane the task matches, or `null`. */
  paneOf: (view: TaskView) => EisenhowerQuadrant | null
  /** The first clause of `pane`'s filter the task fails (`null` when it matches). */
  failingField: (pane: EisenhowerPane, view: TaskView) => FilterChipField | DateField | null
}

/** The criteria with one field's clause only (the others no filter). */
function onlyField(c: FilterCriteria, field: FilterChipField | DateField): FilterCriteria {
  const base: FilterCriteria = { showCompleted: true, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
  switch (field) {
    case 'markers': return { ...base, markers: c.markers }
    case 'status': return { ...base, statusIds: c.statusIds, ...(c.negate?.statusIds ? { negate: { statusIds: true } } : {}) }
    case 'people': return { ...base, personIds: c.personIds, ...(c.negate?.personIds ? { negate: { personIds: true } } : {}) }
    case 'tags': return { ...base, tags: c.tags, ...(c.negate?.tags ? { negate: { tags: true } } : {}) }
    case 'text': return { ...base, searchText: c.searchText }
    case 'dates':
    case 'completed':
      return base
    default: {
      const clause = c.dates[field]
      return { ...base, dates: clause ? { [field]: clause } : {} }
    }
  }
}

/** The clause fields in the order a refusal names the first one failing. */
const CLAUSE_ORDER: readonly (FilterChipField | DateField)[] = ['markers', 'status', 'people', 'tags', ...DATE_FIELD_VALUES, 'text']

/** `rows` with row `id` of `all` added (when it isn't there yet). */
function withRow<T extends { id?: number }>(rows: readonly T[], all: readonly T[], id: number | undefined): readonly T[] {
  if (id === undefined || rows.some((r) => r.id === id)) return rows
  const row = all.find((r) => r.id === id)
  return row ? [...rows, row] : rows
}

function hasRow(rows: readonly { id?: number }[] | undefined, id: number): boolean {
  return (rows ?? []).some((r) => r.id === id)
}

function createPaneMatcher(panes: readonly EisenhowerPane[], ctx: PaneContext): PaneMatcher {
  // A pane ignores Show completed: the matrix's source decides about completed tasks.
  const criteria = new Map(panes.map((p) => [p.id, predicateToCriteria({ ...p.filter, showCompleted: true })]))
  const lookups: TodoNameLookups = {
    assignedPeopleMap: ctx.assignedPeopleMap,
    assignedTagsMap: ctx.assignedTagsMap,
    statusesById: new Map(ctx.statuses.flatMap((s) => (s.id != null ? [[s.id, s] as const] : []))),
  }
  const test = (c: FilterCriteria, v: TaskView) => matchesFilterWithLookups(c, v.todo, v.lookups, ctx.today, ctx.settings)
  const criteriaOf = (pane: EisenhowerPane) => criteria.get(pane.id) ?? predicateToCriteria({ ...pane.filter, showCompleted: true })
  return {
    viewOf: (todo) => ({ todo, lookups }),
    applied: (view, change) => {
      const todo: PersistedTodoItem = { ...view.todo }
      if (change.urgent !== undefined) todo.urgent = change.urgent || undefined
      if (change.important !== undefined) todo.important = change.important || undefined
      if (change.focus !== undefined) todo.focus = change.focus || undefined
      if (change.statusId !== undefined) todo.statusId = change.statusId
      if (change.personId === undefined && change.tagId === undefined) return { todo, lookups: view.lookups }
      // This task's people / tags with the one added (the lookups are read by the task's id).
      const people = withRow(view.lookups.assignedPeopleMap?.get(todo.id) ?? [], ctx.people, change.personId)
      const tags = withRow(view.lookups.assignedTagsMap?.get(todo.id) ?? [], ctx.tags, change.tagId)
      return {
        todo,
        lookups: { ...view.lookups, assignedPeopleMap: new Map([[todo.id, people]]), assignedTagsMap: new Map([[todo.id, tags]]) },
      }
    },
    paneOf: (v) => panes.find((p) => test(criteriaOf(p), v))?.id ?? null,
    failingField: (pane, v) => {
      const c = criteriaOf(pane)
      return CLAUSE_ORDER.find((f) => !test(onlyField(c, f), v)) ?? null
    },
  }
}

/** The tasks of each pane (first match wins), each sorted by {@link compareInQuadrant}, and those in none. */
export interface PaneClassification<T> {
  byPane: Record<EisenhowerQuadrant, T[]>
  /** Tasks no pane's filter matches (input order). */
  none: T[]
}

export function classifyPanes<T extends PersistedTodoItem>(
  todos: readonly T[],
  panes: readonly EisenhowerPane[],
  ctx: PaneContext,
): PaneClassification<T> {
  const m = createPaneMatcher(panes, ctx)
  const byPane: Record<EisenhowerQuadrant, T[]> = { do: [], schedule: [], delegate: [], drop: [] }
  const none: T[] = []
  for (const t of todos) {
    const q = m.paneOf(m.viewOf(t))
    if (q) byPane[q].push(t)
    else none.push(t)
  }
  for (const q of EISENHOWER_QUADRANTS) byPane[q].sort(compareInQuadrant)
  return { byPane, none }
}

// ── Drops ─────────────────────────────────────────────────────────────────

/** The writes one task needs (only what changes): flags, a status, a person or tag added. */
export interface PaneChange {
  todoId: number
  urgent?: boolean
  important?: boolean
  focus?: boolean
  statusId?: number
  /** A person to add. */
  personId?: number
  /** A tag to add. */
  tagId?: number
}

/** Why a dropped task wouldn't land in the pane. */
export type PaneMiss =
  /** Its due date keeps it urgent and the pane wants it not urgent. */
  | { kind: 'urgent-date' }
  /** It would match an earlier pane first. */
  | { kind: 'earlier'; pane: EisenhowerQuadrant }
  /** It fails the pane's clause on `field`, which the drop can't change. */
  | { kind: 'clause'; field: FilterChipField | DateField }
  /** The status / person / tag the pane's clause on `field` names no longer exists (nothing is written). */
  | { kind: 'deleted'; field: PaneEntityField }

export interface BlockedTask<T> {
  task: T
  miss: PaneMiss
}

export type PaneDropResult<T> =
  /** Nothing changes (every task is already there). */
  | { kind: 'none' }
  /** Refused: these tasks wouldn't land in the pane. */
  | { kind: 'blocked'; blocked: BlockedTask<T>[] }
  | { kind: 'apply'; changes: PaneChange[] }

/**
 * What dropping `todos` on pane `target` does. Each task gets what the
 * pane's filter implies (`paneWrites`) where it differs: each Priority
 * marker the filter tests set Yes or No — except that Urgent Yes is never
 * written for a task already urgent by its due date —, "Status is" one
 * status, "People is" / "Tags is" one person / tag added — never one that no
 * longer exists. Then, if a task still wouldn't land in `target` (its first
 * matching pane, so an earlier pane counts too), the whole drop is refused,
 * naming why per task.
 */
export function resolvePaneDrop<T extends PersistedTodoItem>(
  todos: readonly T[],
  target: EisenhowerQuadrant,
  panes: readonly EisenhowerPane[],
  ctx: PaneContext,
): PaneDropResult<T> {
  return dropOn(todos, target, panes, ctx, createPaneMatcher(panes, ctx))
}

/** {@link resolvePaneDrop} on each pane, with one matcher for the four (a drag's start works them all out). */
export function resolvePaneDrops<T extends PersistedTodoItem>(
  todos: readonly T[],
  panes: readonly EisenhowerPane[],
  ctx: PaneContext,
): Record<EisenhowerQuadrant, PaneDropResult<T>> {
  const m = createPaneMatcher(panes, ctx)
  const of = (q: EisenhowerQuadrant) => dropOn(todos, q, panes, ctx, m)
  return { do: of('do'), schedule: of('schedule'), delegate: of('delegate'), drop: of('drop') }
}

function dropOn<T extends PersistedTodoItem>(
  todos: readonly T[],
  target: EisenhowerQuadrant,
  panes: readonly EisenhowerPane[],
  ctx: PaneContext,
  m: PaneMatcher,
): PaneDropResult<T> {
  const pane = panes.find((p) => p.id === target)
  if (!pane) return { kind: 'none' }
  const w = paneWrites(pane.filter, ctx)
  const range = ctx.settings.urgentRange
  const blocked: BlockedTask<T>[] = []
  const changes: PaneChange[] = []
  for (const t of todos) {
    const view = m.viewOf(t)
    const change: PaneChange = { todoId: t.id }
    const urgent = w.markers.urgent
    if (urgent === true && !isEffectivelyUrgent(t, ctx.today, range)) change.urgent = true
    else if (urgent === false && t.urgent === true) change.urgent = false
    for (const k of ['important', 'focus'] as const) {
      const want = w.markers[k]
      if (want !== undefined && (t[k] === true) !== want) change[k] = want
    }
    if (w.statusId !== undefined && t.statusId !== w.statusId) change.statusId = w.statusId
    if (w.personId !== undefined && !hasRow(view.lookups.assignedPeopleMap?.get(t.id), w.personId)) change.personId = w.personId
    if (w.tagId !== undefined && !hasRow(view.lookups.assignedTagsMap?.get(t.id), w.tagId)) change.tagId = w.tagId

    const after = m.applied(view, change)
    const landed = m.paneOf(after)
    if (landed !== target) {
      blocked.push({ task: t, miss: missOf(m, pane, after, landed, w.deleted ?? [], ctx) })
      continue
    }
    if (Object.keys(change).length > 1) changes.push(change)
  }
  if (blocked.length > 0) return { kind: 'blocked', blocked }
  return changes.length > 0 ? { kind: 'apply', changes } : { kind: 'none' }
}

function missOf(
  m: PaneMatcher,
  pane: EisenhowerPane,
  after: TaskView,
  landed: EisenhowerQuadrant | null,
  deleted: readonly PaneEntityField[],
  ctx: PaneContext,
): PaneMiss {
  const field = m.failingField(pane, after)
  if (field == null) return landed ? { kind: 'earlier', pane: landed } : { kind: 'clause', field: 'markers' }
  const gone = deleted.find((f) => f === field)
  if (gone) return { kind: 'deleted', field: gone }
  const markers = pane.filter.markers
  if (field === 'markers' && markers != null && !isHotFilter(markers) && markers.urgent === false
    && isUrgentByDate(after.todo, ctx.today, ctx.settings.urgentRange)) {
    return { kind: 'urgent-date' }
  }
  return { kind: 'clause', field }
}

/** Names for the writes and refusals: people, tags, statuses. */
export type PaneNames = FilterChipNames

function nameIn(rows: readonly { id?: number; name: string }[], id: number): string | undefined {
  return rows.find((r) => r.id === id)?.name
}

/** The first value of each kind of write among `changes` (a drop writes the same to every task). */
function firstWrites(changes: readonly PaneChange[]) {
  const first = <K extends keyof PaneChange>(k: K) => changes.find((c) => c[k] !== undefined)?.[k]
  return {
    urgent: first('urgent'),
    important: first('important'),
    focus: first('focus'),
    statusId: first('statusId'),
    personId: first('personId'),
    tagId: first('tagId'),
  }
}

/** `+ Urgent`, `− Important`, `+ Urgent · − Important · → Waiting · + Ann · + #home` — what a drop changes. */
export function dropPreviewLabel(changes: readonly PaneChange[], names?: PaneNames): string {
  const w = firstWrites(changes)
  const parts: string[] = []
  if (w.urgent !== undefined) parts.push(`${w.urgent ? '+' : '−'} ${MARKER_LABELS.urgent}`)
  if (w.important !== undefined) parts.push(`${w.important ? '+' : '−'} ${MARKER_LABELS.important}`)
  if (w.focus !== undefined) parts.push(`${w.focus ? '+' : '−'} ${MARKER_LABELS.focus}`)
  if (w.statusId !== undefined) parts.push(`→ ${(names && nameIn(names.statuses, w.statusId)) ?? 'status'}`)
  if (w.personId !== undefined) parts.push(`+ ${(names && nameIn(names.people, w.personId)) ?? 'person'}`)
  if (w.tagId !== undefined) parts.push(`+ #${(names && nameIn(names.tags, w.tagId)) ?? 'tag'}`)
  return parts.join(' · ')
}

/**
 * A pane's "+" hint: a default pane's plain words, else what the new task
 * gets from the pane's filter — `Opens Quick Add with + Urgent · → Waiting.` —
 * its Yes markers, status, person and tag (a No gives nothing: a new task
 * starts without the flag).
 */
export function paneAddHint(pane: EisenhowerPane, names: PaneNames): string {
  if (!pane.customFilter) return QUADRANT_ADD_HINT[pane.id]
  const w = paneWrites(pane.filter, names)
  const what = dropPreviewLabel([{
    todoId: 0,
    ...(w.markers.urgent === true ? { urgent: true } : {}),
    ...(w.markers.important === true ? { important: true } : {}),
    ...(w.markers.focus === true ? { focus: true } : {}),
    ...(w.statusId !== undefined ? { statusId: w.statusId } : {}),
    ...(w.personId !== undefined ? { personId: w.personId } : {}),
    ...(w.tagId !== undefined ? { tagId: w.tagId } : {}),
  }], names)
  return what ? `Opens Quick Add with ${what}.` : 'Opens Quick Add.'
}

/**
 * The undo step / snackbar text: `Marked urgent · Send board update`,
 * `Marked urgent, not important · 3 tasks`, `Marked urgent, status Delegated,
 * assigned to Ann · Send board update`.
 */
export function dropDescription(
  changes: readonly PaneChange[],
  titleOf: (todoId: number) => string | undefined,
  names?: PaneNames,
): string {
  const w = firstWrites(changes)
  const flags: string[] = []
  if (w.urgent !== undefined) flags.push(w.urgent ? 'urgent' : 'not urgent')
  if (w.important !== undefined) flags.push(w.important ? 'important' : 'not important')
  if (w.focus !== undefined) flags.push(w.focus ? 'focus' : 'not focus')
  const parts = flags.length > 0 ? [`marked ${flags.join(', ')}`] : []
  if (w.statusId !== undefined) parts.push(`status ${(names && nameIn(names.statuses, w.statusId)) ?? 'set'}`)
  if (w.personId !== undefined) parts.push(`assigned to ${(names && nameIn(names.people, w.personId)) ?? 'a person'}`)
  if (w.tagId !== undefined) parts.push(`tagged #${(names && nameIn(names.tags, w.tagId)) ?? 'tag'}`)
  const text = parts.join(', ')
  const first = changes[0]
  const what = changes.length === 1 && first ? (titleOf(first.todoId) ?? 'task') : `${changes.length} tasks`
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} · ${what}`
}

function withinPhrase(range: number): string {
  return range === 0 ? 'due today or overdue' : `due within ${range} ${range === 1 ? 'day' : 'days'}`
}

/** The refusal lines for tasks kept urgent by their due dates. */
function dueDateLines(
  title: string,
  blocked: readonly (MatrixFields & { title: string })[],
  total: number,
  today: Date,
  range: UrgentDueWithinDays,
): [string, string, string] {
  const only = blocked.length === 1 && total === 1 ? blocked[0] : undefined
  const onlyWhy = only ? urgentByDateSentence(only, today, range) : ''
  if (onlyWhy) return [title, onlyWhy, URGENT_BY_DATE_HINT]
  const n = blocked.length
  const verb = n === 1 ? 'is' : 'are'
  const they = n === 1 ? 'it counts' : 'they count'
  const why = `${n} of ${total} ${total === 1 ? 'task' : 'tasks'} ${verb} ${range == null ? 'due soon' : withinPhrase(range)}, so ${they} as urgent.`
  return [title, why, `Change ${n === 1 ? 'its due date' : 'their due dates'} or the due-soon range first.`]
}

/** A clause's name in a refusal (`Priority`, `People`, `Due`, …). */
function clauseName(field: FilterChipField | DateField): string {
  switch (field) {
    case 'markers': return 'Priority'
    case 'status': return 'Status'
    case 'people': return 'People'
    case 'tags': return 'Tags'
    case 'text': return 'Text'
    case 'dates':
    case 'completed':
      return 'date'
    default: return DATE_FIELD_LABELS_SHORT[field]
  }
}

/** Why a pane's drop is refused when what its clause names was deleted. */
const DELETED_SENTENCE: Record<PaneEntityField, string> = {
  status: 'The status this pane sets no longer exists.',
  people: 'The person this pane adds no longer exists.',
  tags: 'The tag this pane adds no longer exists.',
}

/** Why one task wouldn't land in `pane`, as a sentence. */
function missSentence(
  task: { title: string; statusId?: number },
  miss: PaneMiss,
  pane: EisenhowerPane,
  panes: readonly EisenhowerPane[],
  names: PaneNames,
): string {
  if (miss.kind === 'earlier') {
    const first = panes.find((p) => p.id === miss.pane)?.name ?? QUADRANT_NAME[miss.pane]
    return `${task.title} matches “${first}” first.`
  }
  if (miss.kind === 'deleted') return DELETED_SENTENCE[miss.field]
  if (miss.kind === 'clause' && miss.field === 'status') {
    const status = task.statusId != null ? nameIn(names.statuses, task.statusId) : undefined
    return status ? `${task.title} is still ${status}.` : `${task.title} has no status.`
  }
  const field = miss.kind === 'clause' ? miss.field : 'markers'
  const chip = filterChips(pane.filter, names).find((c) => c.field === field || c.dateField === field)
  const value = chip ? ` (${chip.value})` : ''
  return `${task.title} doesn’t match its ${clauseName(field)} filter${value}.`
}

/**
 * The refusal tooltip's lines for a blocked drop on `pane`: `Can’t move to
 * <pane>` / why / what to change. Tasks kept urgent by their due dates read
 * as on the default quadrants; otherwise the one task's reason (`… is still
 * Waiting.`, `… matches “Do” first.`), or for several how many and the first
 * one's reason.
 */
export function blockedPaneLines<T extends PersistedTodoItem>(
  pane: EisenhowerPane,
  blocked: readonly BlockedTask<T>[],
  total: number,
  panes: readonly EisenhowerPane[],
  ctx: Pick<PaneContext, 'today' | 'settings'>,
  names: PaneNames,
): [string, string, string] {
  const title = `Can’t move to ${pane.name}`
  if (blocked.every((b) => b.miss.kind === 'urgent-date')) {
    return dueDateLines(title, blocked.map((b) => b.task), total, ctx.today, ctx.settings.urgentRange)
  }
  const first = blocked.find((b) => b.miss.kind !== 'urgent-date') ?? blocked[0]
  const why = first ? missSentence(first.task, first.miss, pane, panes, names) : ''
  const hint = first?.miss.kind === 'deleted'
    ? 'Edit the pane first.'
    : first?.miss.kind === 'clause' && first.miss.field === 'status'
      ? `Change ${blocked.length === 1 ? 'its status' : 'their statuses'} first, or edit the pane.`
      : `Change ${blocked.length === 1 ? 'the task' : 'the tasks'} first, or edit the panes.`
  if (blocked.length === 1 && total === 1) return [title, why, hint]
  const n = blocked.length
  return [title, `${n} of ${total} ${total === 1 ? 'task' : 'tasks'} wouldn’t land in “${pane.name}”: ${why}`, hint]
}
