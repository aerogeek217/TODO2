import type { PersistedTodoItem, Person, Status, Tag } from '../../models'
import { BREAKDOWN_FIXED_SORT_KEYS, type BreakdownOldestBy, type BreakdownShow, type BreakdownSort, type BreakdownSortKey, type BreakdownSplit } from '../../models/chart-widgets'
import { daysUntil } from '../../utils/effective-date'
import { NO_PRIORITY_LABEL, priorityRank } from '../../utils/markers'
import { keepsNoneRow, restrictedRows, type RowRestrictions } from './row-restrictions'
import { idsByDate, type StatsContext } from './stats-context'

/**
 * A Breakdown's rows (D26 P8): the tasks its filter keeps (already
 * composed with the top bar's filter: the caller passes them), split by
 * people, tags, status, priority, due date or age. Each row has its tasks,
 * the ones each count column keeps (board BC: the caller passes the ids
 * each column's filter keeps among the chart's tasks) and its oldest task
 * by a date. People and tags narrow by the `@` /
 * `#` picks (`RowRestrictions`), as a list grouped by them does. Pure.
 */

/** A priority row's group: the Priority sort's exclusive groups (`priorityRank`). */
export type PriorityGroupKey = 'focus' | 'urgentImportant' | 'urgent' | 'important'

const PRIORITY_GROUP_KEYS: readonly PriorityGroupKey[] = ['focus', 'urgentImportant', 'urgent', 'important']

export const PRIORITY_GROUP_LABELS: Record<PriorityGroupKey, string> = {
  focus: 'Focus',
  urgentImportant: 'Urgent + Important',
  urgent: 'Urgent',
  important: 'Important',
}

/** The due-date buckets, in order (no due date is the none row). */
export type DueBucket = 'overdue' | 'today' | 'week' | 'later'
const DUE_BUCKETS: readonly DueBucket[] = ['overdue', 'today', 'week', 'later']
export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
}

/** The age buckets (days since created), in order. */
export type AgeBucket = 'week' | 'month' | 'quarter' | 'older'
const AGE_BUCKETS: readonly AgeBucket[] = ['week', 'month', 'quarter', 'older']
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  week: 'Under a week',
  month: '1–4 weeks',
  quarter: '1–3 months',
  older: 'Over 3 months',
}

/** The none row's label per split (age has none: every task has an age). */
export const NONE_ROW_LABELS: Record<BreakdownSplit, string> = {
  people: 'Unassigned',
  tags: 'No tags',
  status: 'No status',
  priority: NO_PRIORITY_LABEL,
  due: 'No due date',
  age: '',
}

/** What a row stands for. */
export type BreakdownEntity =
  | { kind: 'person'; person: Person & { id: number } }
  | { kind: 'tag'; tag: Tag & { id: number } }
  | { kind: 'status'; status: Status & { id: number } }
  | { kind: 'priority'; group: PriorityGroupKey }
  | { kind: 'due'; bucket: DueBucket }
  | { kind: 'age'; bucket: AgeBucket }
  | { kind: 'none' }

/** A row's oldest task by the Breakdown's date (`oldestBy`). */
export interface OldestTask {
  id: number
  title: string
  /** Its age in whole days (by its due date: how many days late; negative while not yet due). */
  days: number
}

export interface BreakdownRow {
  /** Unique in the Breakdown: `person-3`, `tag-5`, `status-2`, `priority-focus`, `due-overdue`, `age-week`; `none`. */
  key: string
  label: string
  entity: BreakdownEntity
  /** Its colour (a person's, a tag's, a status's, a marker's); absent = neutral. */
  color?: string
  /** Its tasks, by due date then `sortOrder`. */
  ids: number[]
  /** How many of its open tasks are overdue (the bar's late part). */
  overdue: number
  /** Each count column's tasks of the row, by column id, by due date (a column the options don't name: none). */
  columns: Readonly<Record<string, number[]>>
  /** Its oldest task (`null` when none has the date: `due` with none due). */
  oldest: OldestTask | null
  /** The median age of its tasks that have the date, days. */
  medianDays: number | null
}

export interface BreakdownStats {
  /** Every row with a task, in the split's default order; the none row (when kept) last. */
  rows: BreakdownRow[]
  /** Every task counted (each once), by due date. */
  ids: number[]
}

export interface BreakdownOptions {
  splitBy: BreakdownSplit
  /** The date `oldest` reads (every row has its oldest either way). */
  oldestBy: BreakdownOldestBy
  show: BreakdownShow
  /** The count columns: each its id and the chart's tasks its filter keeps. */
  columns: readonly BreakdownColumnKeep[]
  /** The `@` picks (people) or `#` picks (tags) that narrow those rows. */
  restrictions?: RowRestrictions
}

/** A count column as the statistic reads it: its id and the ids of the chart's tasks its filter keeps. */
export interface BreakdownColumnKeep {
  id: string
  keep: ReadonlySet<number>
}

/** A row's count in column `id` (0 for a column it doesn't have). */
export function columnCount(row: Pick<BreakdownRow, 'columns'>, id: string): number {
  return row.columns[id]?.length ?? 0
}

/** The row's counts across every column (its default order's weight). */
function columnsTotal(row: Pick<BreakdownRow, 'columns'>): number {
  let n = 0
  for (const ids of Object.values(row.columns)) n += ids.length
  return n
}

/** The age a task has by `by` on `today`, days; `null` without the date (`due`). */
export function ageDays(task: PersistedTodoItem, by: BreakdownOldestBy, today: Date): number | null {
  const date = by === 'lastFollowup' ? (task.lastFollowupAt ?? task.createdAt)
    : by === 'created' ? task.createdAt
      : by === 'modified' ? task.modifiedAt
        : task.dueDate
  const until = daysUntil(date, today)
  return until == null ? null : -until
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/** A row of `tasks`: its counts under `opts` (`key`, `label`, `entity`, `color` given). */
export function breakdownRow(
  head: Pick<BreakdownRow, 'key' | 'label' | 'entity' | 'color'>,
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today'>,
  opts: Pick<BreakdownOptions, 'oldestBy' | 'columns'>,
): BreakdownRow {
  const { today } = ctx
  let oldest: OldestTask | null = null
  const ages: number[] = []
  let overdue = 0
  for (const t of tasks) {
    if (!t.isCompleted && (daysUntil(t.dueDate, today) ?? 0) < 0) overdue += 1
    const age = ageDays(t, opts.oldestBy, today)
    if (age == null) continue
    ages.push(age)
    if (!oldest || age > oldest.days) oldest = { id: t.id, title: t.title, days: age }
  }
  const ids = idsByDate(tasks, 'deadline')
  const columns: Record<string, number[]> = {}
  for (const c of opts.columns) columns[c.id] = ids.filter((id) => c.keep.has(id))
  return {
    ...head,
    ids,
    overdue,
    columns,
    oldest,
    medianDays: median(ages),
  }
}

function priorityGroupOf(t: PersistedTodoItem, ctx: Pick<StatsContext, 'today' | 'urgentRange'>): PriorityGroupKey | null {
  return PRIORITY_GROUP_KEYS[priorityRank(t, ctx.today, ctx.urgentRange)] ?? null
}

function dueBucketOf(t: PersistedTodoItem, today: Date): DueBucket | null {
  const days = daysUntil(t.dueDate, today)
  if (days == null) return null
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= 7 ? 'week' : 'later'
}

function ageBucketOf(t: PersistedTodoItem, today: Date): AgeBucket {
  const days = -(daysUntil(t.createdAt, today) ?? 0)
  if (days < 7) return 'week'
  if (days < 28) return 'month'
  return days < 91 ? 'quarter' : 'older'
}

type Head = Pick<BreakdownRow, 'key' | 'label' | 'entity' | 'color'>

/** The rows' heads each task falls under (none = `[]`: the none row). */
function splitHeads(t: PersistedTodoItem, ctx: StatsContext, opts: BreakdownOptions): Head[] {
  switch (opts.splitBy) {
    case 'people': {
      const people = new Map<number, Person>()
      for (const p of ctx.assignedPeopleMap.get(t.id) ?? []) if (p.id != null && !people.has(p.id)) people.set(p.id, p)
      return restrictedRows([...people.keys()], opts.restrictions ?? []).flatMap((id) => {
        const p = people.get(id)
        return p ? [{ key: `person-${id}`, label: p.name, entity: { kind: 'person', person: { ...p, id } }, color: p.color }] : []
      })
    }
    case 'tags': {
      const tags = new Map<number, Tag>()
      for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) if (tag.id != null && !tags.has(tag.id)) tags.set(tag.id, tag)
      return restrictedRows([...tags.keys()], opts.restrictions ?? []).flatMap((id) => {
        const tag = tags.get(id)
        return tag ? [{ key: `tag-${id}`, label: tag.name, entity: { kind: 'tag', tag: { ...tag, id } }, color: tag.color }] : []
      })
    }
    case 'status': {
      const status = t.statusId != null ? ctx.statuses.find((s) => s.id === t.statusId) : undefined
      return status?.id != null
        ? [{ key: `status-${status.id}`, label: status.name, entity: { kind: 'status', status: { ...status, id: status.id } }, color: status.color }]
        : []
    }
    case 'priority': {
      const group = priorityGroupOf(t, ctx)
      return group ? [{ key: `priority-${group}`, label: PRIORITY_GROUP_LABELS[group], entity: { kind: 'priority', group } }] : []
    }
    case 'due': {
      const bucket = dueBucketOf(t, ctx.today)
      return bucket ? [{ key: `due-${bucket}`, label: DUE_BUCKET_LABELS[bucket], entity: { kind: 'due', bucket } }] : []
    }
    case 'age': {
      const bucket = ageBucketOf(t, ctx.today)
      return [{ key: `age-${bucket}`, label: AGE_BUCKET_LABELS[bucket], entity: { kind: 'age', bucket } }]
    }
  }
}

/** A task with no person (tag) stays in the none row only while every restriction keeps it (`keepsNoneRow`). */
function keepsNone(opts: BreakdownOptions): boolean {
  return opts.splitBy === 'people' || opts.splitBy === 'tags' ? keepsNoneRow(opts.restrictions ?? []) : true
}

/** The rank of a row in its split's natural order (status: Settings order; priority / due / age: their order). */
function naturalRank(row: BreakdownRow, statuses: readonly Status[]): number {
  const e = row.entity
  switch (e.kind) {
    case 'status': return statuses.findIndex((s) => s.id === e.status.id)
    case 'priority': return PRIORITY_GROUP_KEYS.indexOf(e.group)
    case 'due': return DUE_BUCKETS.indexOf(e.bucket)
    case 'age': return AGE_BUCKETS.indexOf(e.bucket)
    default: return 0
  }
}

/** Splits with a natural order of their own (Settings', the groups', the buckets'); people and tags have none. */
export function hasNaturalOrder(split: BreakdownSplit): boolean {
  return split !== 'people' && split !== 'tags'
}

/** The oldest's age, for sorting (a row without one: last). */
const oldestDays = (r: BreakdownRow) => r.oldest?.days ?? Number.NEGATIVE_INFINITY

/**
 * A row's default place: people and tags most counted across the count
 * columns first (with `oldest`, oldest first), ties by the open count,
 * then the name; the other splits their natural order.
 */
function defaultCompare(split: BreakdownSplit, show: BreakdownShow, statuses: readonly Status[]) {
  if (hasNaturalOrder(split)) return (a: BreakdownRow, b: BreakdownRow) => naturalRank(a, statuses) - naturalRank(b, statuses)
  return (a: BreakdownRow, b: BreakdownRow) => (show === 'oldest' ? oldestDays(b) - oldestDays(a) : 0)
    || columnsTotal(b) - columnsTotal(a)
    || b.ids.length - a.ids.length
    || a.label.localeCompare(b.label)
}

/** The tasks of `tasks` split by `opts` (see the module comment). */
export function computeBreakdown(tasks: readonly PersistedTodoItem[], ctx: StatsContext, opts: BreakdownOptions): BreakdownStats {
  const groups = new Map<string, { head: Head; tasks: PersistedTodoItem[] }>()
  const none: PersistedTodoItem[] = []
  const counted: PersistedTodoItem[] = []
  const keepNone = keepsNone(opts)
  for (const t of tasks) {
    const heads = splitHeads(t, ctx, opts)
    if (heads.length === 0) {
      // A task with people (tags) none of the picks name counts nowhere.
      const hasOwn = (opts.splitBy === 'people' && (ctx.assignedPeopleMap.get(t.id)?.length ?? 0) > 0)
        || (opts.splitBy === 'tags' && (ctx.assignedTagsMap.get(t.id)?.length ?? 0) > 0)
      if (hasOwn || !keepNone) continue
      none.push(t)
      counted.push(t)
      continue
    }
    counted.push(t)
    for (const head of heads) {
      let g = groups.get(head.key)
      if (!g) {
        g = { head, tasks: [] }
        groups.set(head.key, g)
      }
      g.tasks.push(t)
    }
  }
  const rows = [...groups.values()].map((g) => breakdownRow(g.head, g.tasks, ctx, opts))
  rows.sort(defaultCompare(opts.splitBy, opts.show, ctx.statuses))
  if (none.length > 0 && opts.splitBy !== 'age') {
    rows.push(breakdownRow({ key: 'none', label: NONE_ROW_LABELS[opts.splitBy], entity: { kind: 'none' } }, none, ctx, opts))
  }
  return { rows, ids: idsByDate(counted, 'deadline') }
}

/** Each heading's comparator, its default direction first: counts largest first, the name A–Z; any other key a count column's. */
function keyCompare(by: BreakdownSortKey, show: BreakdownShow): (a: BreakdownRow, b: BreakdownRow) => number {
  switch (by) {
    case 'name': return (a, b) => a.label.localeCompare(b.label)
    case 'open': return show === 'oldest' ? (a, b) => oldestDays(b) - oldestDays(a) : (a, b) => b.ids.length - a.ids.length
    default: return (a, b) => columnCount(b, by) - columnCount(a, by)
  }
}

/**
 * `rows` in the order `sort` asks (absent, or by a count column the
 * Breakdown no longer has — not among `columnIds`: the split's default
 * order, as `computeBreakdown` returns them), ties in the default order;
 * the none row stays last.
 */
export function sortBreakdownRows(
  rows: readonly BreakdownRow[],
  sort: BreakdownSort | undefined,
  show: BreakdownShow,
  columnIds?: readonly string[],
): BreakdownRow[] {
  const none = rows.filter((r) => r.entity.kind === 'none')
  const rest = rows.filter((r) => r.entity.kind !== 'none')
  if (!sort || !isLiveSort(sort, columnIds)) return [...rest, ...none]
  const cmp = keyCompare(sort.by, show)
  const sign = sort.reversed ? -1 : 1
  const index = new Map(rest.map((r, i) => [r.key, i]))
  const sorted = [...rest].sort((a, b) => sign * cmp(a, b) || (index.get(a.key) ?? 0) - (index.get(b.key) ?? 0))
  return [...sorted, ...none]
}

/** Whether `sort` names a heading the Breakdown has: a fixed one, or one of `columnIds` (any, without them). */
export function isLiveSort(sort: BreakdownSort, columnIds: readonly string[] | undefined): boolean {
  return (BREAKDOWN_FIXED_SORT_KEYS as readonly string[]).includes(sort.by) || columnIds == null || columnIds.includes(sort.by)
}

/** The sort after a click on heading `by`: its default direction, then reversed, then back to the default order (`undefined`). */
export function nextBreakdownSort(current: BreakdownSort | undefined, by: BreakdownSortKey): BreakdownSort | undefined {
  if (current?.by !== by) return { by }
  return current.reversed ? undefined : { by, reversed: true }
}
