import { beforeEach, describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import type { TodoPredicate } from '../../models'
import { upgradeV78 } from '../../data/upgrades/v78'
import { layoutNumbersOf, upgradeNumbers } from '../../data/upgrades/v78/numbers'
import { numberConfigOfMetric, V77_NUMBER_METRICS, type V77NumberMetric } from '../../data/upgrades/v78/number-metrics'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { readLayoutDraft } from '../../data/draft-storage'
import { db } from '../../data/database'
import { restoreFromImportData } from '../../data/restore'
import { rowFixes, validateRow } from '../../data/import-validation'
import { computeClosedThisWeek, computeMetrics } from '../fixtures/v77-metrics'
import type { StatsContext } from '../../services/stats/stats-context'
import { numberIds } from '../../services/stats/number-count'
import { expressionText } from '../../utils/filter-chips'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { asExpression } from '../../utils/predicate-expression'
import type { WeekStart } from '../../utils/effective-date'
import type { UrgentDueWithinDays } from '../../utils/urgency'
import type { LayoutTab } from '../../models/workspace-layout'
import { generateDevSeed } from '../../../scripts/dev-seed'
import { cell, grid } from '../helpers/layout-builders'
import { lookupsFor, makeTodo, resetDb } from '../helpers'

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const layout = (cells: unknown[]): Obj => ({ ...layoutRow(), cells })
function layoutRow(): Obj {
  return { id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...grid([[cell('a')]]) }
}
const v77Number = (id: string, metric: string, extra: Obj = {}) => ({ id, kind: 'number', config: { metric, ...extra } }) as unknown as LayoutTab

const NAMES = { people: [], tags: [], statuses: [] }

describe('v78 numbers: a Number’s metric becomes the filter that counts the same tasks', () => {
  it.each([
    ['open', 'Open', undefined, ''],
    ['overdue', 'Overdue', '#e86bf0', 'overdue'],
    ['dueToday', 'Due today', '#e86bf0', 'due today'],
    ['dueNext7', 'Due in the next 7 days', '#e86bf0', 'due within 6 days'],
    ['followupDue', 'Follow-up due', '#f5c842', 'followup by today'],
    ['noFollowup', 'No follow-up date', '#8f8a83', 'no followup'],
    ['focus', 'Focus', undefined, '/focus'],
    ['urgent', 'Urgent', '#ee7d77', '/urgent'],
    ['closedThisWeek', 'Closed this week', undefined, 'completed this week'],
  ] as const)('%s → “%s”, colour %s, filter `%s`', (metric, name, color, text) => {
    const config = numberConfigOfMetric(metric)
    expect(config.name).toBe(name)
    expect(config.color).toBe(color)
    expect(config.show).toBe('count')
    expect(expressionText(asExpression(config.filter as unknown as TodoPredicate) ?? {}, NAMES)).toBe(text)
  })

  it('lit above 0 where the metric lit above zero; Closed this week compares with last week', () => {
    const lit = V77_NUMBER_METRICS.filter((m) => numberConfigOfMetric(m).litWhen === 'above')
    expect(lit).toEqual(['urgent', 'overdue', 'followupDue', 'dueToday'])
    for (const m of lit) expect(numberConfigOfMetric(m).litAt).toBe(0)
    expect(numberConfigOfMetric('open')).not.toHaveProperty('litAt')
    expect(V77_NUMBER_METRICS.filter((m) => numberConfigOfMetric(m).compare === 'lastWeek')).toEqual(['closedThisWeek'])
  })

  it('keeps the breakdown, the tab’s id and its place; the row is one the current schema takes as it is', () => {
    const row = layout([{ id: 'a', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [
      { id: 'n1', kind: 'notes', config: {} },
      v77Number('n2', 'overdue', { breakdown: 'tags' }),
    ], activeTabId: 'n2' }])
    const out = layoutNumbersOf(row) as Obj & { cells: Array<{ tabs: LayoutTab[]; activeTabId: string }> }
    const tabs = out.cells[0]!.tabs
    expect(tabs[0]).toEqual({ id: 'n1', kind: 'notes', config: {} })
    expect(tabs[1]).toEqual({ id: 'n2', kind: 'number', config: { ...numberConfigOfMetric('overdue'), breakdown: 'tags' } })
    expect(out.cells[0]!.activeTabId).toBe('n2')
    expect(validateRow('layouts', out)).toBe(true)
    expect(rowFixes('layouts', out)).toEqual([])
  })

  it('is idempotent and defensive: a converted or unknown Number, an odd cell or tab, is left as it is', () => {
    const row = layout([{ id: 'a', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [v77Number('n', 'open')] }])
    const data = { layouts: [row] }
    const once = upgradeNumbers(data)
    expect(once).not.toBe(data)
    expect(upgradeNumbers(once)).toBe(once)
    const odd = layout(['x', { id: 'b', tabs: 'nope' }, { id: 'c', tabs: [7, v77Number('u', 'sparkles'), { id: 'm', kind: 'number', config: 'x' }] }])
    expect(layoutNumbersOf(odd)).toBe(odd)
    const none = { todos: [] }
    expect(upgradeNumbers(none)).toBe(none)
  })

  it('a v77 file imports through v78: its Numbers arrive as filters, nothing to repair', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 77,
      todos: [],
      settings: [],
      layouts: [{
        id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
        columns: [{ id: 'A', weight: 1, rows: [
          { id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [v77Number('n1', 'followupDue')] }, { id: 'b', weight: 1, tabs: [v77Number('n2', 'closedThisWeek', { breakdown: 'people' })] }] },
        ] }],
      }],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    const tabs = result.data.layouts[0]!.cells.flatMap((c) => c.tabs)
    expect(tabs).toEqual([
      { id: 'n1', kind: 'number', config: numberConfigOfMetric('followupDue') },
      { id: 'n2', kind: 'number', config: { ...numberConfigOfMetric('closedThisWeek'), breakdown: 'people' } },
    ])
  })

  it('runs after the table and the widget set in v78', () => {
    const v77 = {
      id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
      columns: [{ id: 'A', weight: 1, rows: [{ id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [v77Number('n', 'urgent'), { id: 'g', kind: 'today', config: {} }] }] }] }],
    }
    const out = upgradeV78({ layouts: [v77] }).layouts![0] as Obj & { cells: Array<{ tabs: LayoutTab[] }> }
    expect(out.cells[0]!.tabs).toEqual([{ id: 'n', kind: 'number', config: numberConfigOfMetric('urgent') }])
  })

  it('a kept v77 layout draft reads back with its Numbers as filters', () => {
    const body = { columns: [{ id: 'A', weight: 1, rows: [{ id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [v77Number('n', 'dueToday')] }] }] }] }
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', schemaVersion: 77, ...body }))
    const draft = readLayoutDraft()
    const tabs = draft?.kind === 'new' ? draft.body.cells.flatMap((c) => c.tabs) : []
    expect(tabs).toEqual([{ id: 'n', kind: 'number', config: numberConfigOfMetric('dueToday') }])
  })
})

// ── The counts ───────────────────────────────────────────────────────────────

interface Setup {
  today: Date
  weekStartsOn: WeekStart
  urgentRange: UrgentDueWithinDays
}

/** What the v77 metric counted (its ids, as a set) and what its converted filter keeps. */
function both(metric: V77NumberMetric, tasks: readonly PersistedTodoItem[], ctx: StatsContext): { metric: number[]; filter: number[] } {
  const v77 = metric === 'closedThisWeek' ? computeClosedThisWeek(tasks, ctx).ids : computeMetrics(tasks, ctx)[metric].ids
  const criteria = predicateToCriteria(numberConfigOfMetric(metric).filter as unknown as TodoPredicate)
  const lookups = lookupsFor({ assignedPeopleMap: ctx.assignedPeopleMap as Map<number, Person[]>, assignedTagsMap: ctx.assignedTagsMap as Map<number, Tag[]> })
  const ids = numberIds(criteria, tasks, lookups, ctx.today, { urgentRange: ctx.urgentRange, weekStartsOn: ctx.weekStartsOn })
  return { metric: [...v77].sort((a, b) => a - b), filter: [...ids].sort((a, b) => a - b) }
}

function ctxFor(s: Setup, people: StatsContext['assignedPeopleMap'] = new Map(), tags: StatsContext['assignedTagsMap'] = new Map()): StatsContext {
  return { today: s.today, weekStartsOn: s.weekStartsOn, urgentRange: s.urgentRange, assignedPeopleMap: people, assignedTagsMap: tags, statuses: [] }
}

const SETUPS: Setup[] = [
  { today: new Date(2026, 10, 11), weekStartsOn: 0, urgentRange: 3 }, // a Wednesday
  { today: new Date(2026, 10, 15), weekStartsOn: 0, urgentRange: 0 }, // a Sunday, the week's first day
  { today: new Date(2026, 10, 16), weekStartsOn: 1, urgentRange: null }, // a Monday, the week's first day
  { today: new Date(2026, 10, 21), weekStartsOn: 1, urgentRange: 7 }, // a Saturday
]

describe('each converted filter counts exactly what its metric counted', () => {
  /** Tasks around every edge the metrics have: each day from 9 back to 9 ahead, at its first and last minute. */
  function edgeTasks(today: Date): PersistedTodoItem[] {
    const at = (n: number, h: number, m: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, h, m)
    const tasks: PersistedTodoItem[] = []
    let id = 0
    for (let n = -9; n <= 9; n++) {
      for (const [h, m] of [[0, 0], [23, 59]] as const) {
        tasks.push(makeTodo({ id: ++id, dueDate: at(n, h, m) }))
        tasks.push(makeTodo({ id: ++id, nextFollowupAt: at(n, h, m), dueDate: at(n + 3, 12, 0) }))
        tasks.push(makeTodo({ id: ++id, isCompleted: true, completedAt: at(n, h, m), dueDate: at(n, h, m), nextFollowupAt: at(n, h, m) }))
        tasks.push(makeTodo({ id: ++id, urgent: n % 2 === 0, focus: n % 3 === 0, important: n % 4 === 0, dueDate: at(n, h, m) }))
        tasks.push(makeTodo({ id: ++id, isCompleted: true, completedAt: at(n, h, m), urgent: true, focus: true }))
      }
    }
    tasks.push(makeTodo({ id: ++id }))
    tasks.push(makeTodo({ id: ++id, urgent: true }))
    tasks.push(makeTodo({ id: ++id, focus: true, nextFollowupAt: at(0, 9, 0) }))
    tasks.push(makeTodo({ id: id + 1, isCompleted: true, completedAt: at(-40, 9, 0) }))
    return tasks
  }

  for (const setup of SETUPS) {
    it.each(V77_NUMBER_METRICS)(`%s, today ${setup.today.toDateString()}, week from ${setup.weekStartsOn}, urgent ${String(setup.urgentRange)}`, (metric) => {
      const tasks = edgeTasks(setup.today)
      const { metric: v77, filter } = both(metric, tasks, ctxFor(setup))
      expect(filter).toEqual(v77)
      if (metric !== 'noFollowup' && metric !== 'open') expect(v77.length).toBeGreaterThan(0)
    })
  }
})

describe('on the dev seed’s data', () => {
  beforeEach(resetDb)

  it('every converted filter counts what its metric did, on every setup', async () => {
    const seedDay = new Date(2026, 9, 11)
    const prepared = prepareImport(JSON.parse(JSON.stringify(generateDevSeed(seedDay))))
    if (!prepared.ok) throw new Error(prepared.error)
    await restoreFromImportData(prepared.data)
    const tasks = await db.todos.toArray() as PersistedTodoItem[]
    const people = new Map((await db.people.toArray()).map((p) => [p.id!, p]))
    const tags = new Map((await db.tags.toArray()).map((t) => [t.id!, t]))
    const assignedPeople = new Map<number, Person[]>()
    for (const tp of await db.todoPeople.toArray()) {
      const p = people.get(tp.personId)
      if (p) assignedPeople.set(tp.todoId, [...(assignedPeople.get(tp.todoId) ?? []), p])
    }
    const assignedTags = new Map<number, Tag[]>()
    for (const tt of await db.todoTags.toArray()) {
      const t = tags.get(tt.tagId)
      if (t) assignedTags.set(tt.todoId, [...(assignedTags.get(tt.todoId) ?? []), t])
    }
    expect(tasks.length).toBeGreaterThan(50)
    const counted: Record<string, number> = {}
    for (const setup of [{ today: seedDay, weekStartsOn: 0, urgentRange: 3 } as Setup, ...SETUPS.map((s) => ({ ...s, today: new Date(2026, 9, 11 + (s.today.getDate() % 5)) }))]) {
      for (const metric of V77_NUMBER_METRICS) {
        const { metric: v77, filter } = both(metric, tasks, ctxFor(setup, assignedPeople, assignedTags))
        expect(filter, `${metric} on ${setup.today.toDateString()}`).toEqual(v77)
        counted[metric] = (counted[metric] ?? 0) + v77.length
      }
    }
    // The seed exercises every metric.
    for (const metric of V77_NUMBER_METRICS) expect(counted[metric], metric).toBeGreaterThan(0)
  })
})
