import { describe, it, expect, beforeEach } from 'vitest'
import { emptyPredicate, type FilterExpr, type PersistedTodoItem, type Person, type Status, type Tag, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { BreakdownSplit } from '../../models/chart-widgets'
import { expressionResolver } from '../../services/filter-expression-field'
import {
  breakdownReviewFilter,
  breakdownReviews,
  breakdownRowTerm,
  listReviewCount,
  listReviewFilter,
  peopleReviewFilter,
  personReviewFilter,
  reviewTasksLabel,
  screenReviewFilter,
  tagReviewFilter,
} from '../../services/review'
import { computeBreakdown, type BreakdownRow } from '../../services/stats/breakdown'
import type { StatsContext } from '../../services/stats/stats-context'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListWidgetStore, type ReviewFilter, type ShownList } from '../../stores/list-widget-store'
import { useTodoStore } from '../../stores/todo-store'
import { todoNameLookups } from '../../utils/filter'
import { expressionNamesOf } from '../../utils/filter-chips'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { parseExpression, printExpression } from '../../utils/filter-expression'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { withExpression } from '../../utils/predicate-expression'
import { clearFilterStore, makePerson, makeTodo } from '../helpers'

/**
 * What each Review button sends to a Review widget (widget feedback 2B):
 * a filter built as a tree of ids, never as text.
 */

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n, 9)

describe('reviewTasksLabel', () => {
  it('one task, several', () => {
    expect(reviewTasksLabel(1)).toBe('Review this task')
    expect(reviewTasksLabel(8)).toBe('Review these 8 tasks')
  })
})

describe('people and tags', () => {
  it('a person, a tag, several people', () => {
    expect(personReviewFilter({ id: 3 })).toEqual({ expression: { kind: 'person', id: 3 }, showCompleted: false })
    expect(tagReviewFilter({ id: 7 })).toEqual({ expression: { kind: 'tag', id: 7 }, showCompleted: false })
    expect(peopleReviewFilter([{ id: 1 }, { id: 2 }])).toEqual({
      expression: { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }] },
      showCompleted: false,
    })
    expect(peopleReviewFilter([{ id: 1 }])?.expression).toEqual({ kind: 'person', id: 1 })
    expect(peopleReviewFilter([])).toBeNull()
  })

  it('names with spaces, quotes and parentheses print as the field reads them back', () => {
    const people: Person[] = [
      { id: 1, name: 'Marcus Chen', initials: 'MC' },
      { id: 2, name: 'Dana "DJ" O’Neil', initials: 'DO' },
      { id: 3, name: 'Ops (night)', initials: 'ON' },
    ]
    const tags: Tag[] = [{ id: 7, name: 'q4 launch (beta)', color: '#999' }]
    const statuses: Status[] = [{ id: 4, name: 'On hold', color: '#888', sortOrder: 1 }]
    const names = expressionNamesOf({ people, tags, statuses })
    const resolver = expressionResolver(people, tags, statuses)
    const roundTrip = (f: ReviewFilter | null) => {
      if (!f) throw new Error('no filter')
      const text = printExpression(f.expression, f.showCompleted, names)
      const parse = parseExpression(text, { today, names: resolver })
      expect(parse.ok, text).toBe(true)
      if (parse.ok) expect(parse.expression).toEqual(f.expression)
      return text
    }
    expect(roundTrip(peopleReviewFilter(people))).toContain('@"Marcus Chen"')
    roundTrip(tagReviewFilter({ id: 7 }))
    roundTrip({ expression: { kind: 'and', items: [{ kind: 'status', id: 4 }, { kind: 'person', id: 3 }] }, showCompleted: false })
  })
})

// ── A list tab ──────────────────────────────────────────────────────────────

const def = (predicate: TodoPredicate, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id: 9, name: 'Aisha 1:1', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate }, owner: { layoutId: 1 }, ...extra,
})

const section = (key: string, label: string, ids: number[]) => ({ key, label, todos: ids.map((id) => ({ id })) })
const shownList = (over: Partial<ShownList> = {}): ShownList => ({
  listId: 9,
  label: 'Aisha 1:1',
  description: 'list · People · Manual',
  grouped: true,
  sections: [section('a', 'Aisha', [4, 5]), section('b', 'Ben', [5, 6])],
  ...over,
})

describe('listReviewFilter / listReviewCount', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [makeTodo({ id: 4 }), makeTodo({ id: 5 }), makeTodo({ id: 6, isCompleted: true })] })
  })

  it('a Graphical list: its chips as one expression; the count its open tasks shown, each once', () => {
    useListDefinitionStore.setState({ listDefinitions: [def({ ...emptyPredicate(), personIds: [1], tags: [7] })] })
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReviewFilter('tab-1')).toEqual({
      expression: { kind: 'and', items: [{ kind: 'tag', id: 7 }, { kind: 'person', id: 1 }] },
      showCompleted: false,
      ignoreLens: false,
    })
    expect(listReviewCount('tab-1')).toBe(2)
  })

  it('carries the list’s lens switch: a list that ignores the top bar’s lens says so, one that follows it too (F4)', () => {
    useListDefinitionStore.setState({ listDefinitions: [def({ ...emptyPredicate(), personIds: [1] }, { ignoreLens: true })] })
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReviewFilter('tab-1')?.ignoreLens).toBe(true)
    useListDefinitionStore.setState({ listDefinitions: [def({ ...emptyPredicate(), personIds: [1] })] })
    expect(listReviewFilter('tab-1')?.ignoreLens).toBe(false)
  })

  it('an expression list: its expression', () => {
    const expression: FilterExpr = { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 2 }] }
    useListDefinitionStore.setState({ listDefinitions: [def({ ...emptyPredicate(), expression })] })
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReviewFilter('tab-1')?.expression).toEqual(expression)
  })

  it('a list with a prompt: its pick takes that field’s place, as the list applies it; nothing picked, nothing to review', () => {
    useListDefinitionStore.setState({ listDefinitions: [def({ ...emptyPredicate(), statusIds: [3] }, { runtimeFilter: { field: 'person' } })] })
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReviewFilter('tab-1')).toBeNull()
    useListWidgetStore.getState().setPicks('tab-1', [1, 2])
    expect(listReviewFilter('tab-1')?.expression).toEqual({
      kind: 'and',
      items: [{ kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }] }, { kind: 'status', id: 3 }],
    })
  })

  it('a list that narrows by nothing: every open task (an `and` of nothing)', () => {
    useListDefinitionStore.setState({ listDefinitions: [def(emptyPredicate())] })
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReviewFilter('tab-1')).toEqual({ expression: { kind: 'and', items: [] }, showCompleted: false, ignoreLens: false })
  })

  it('a tab not on screen: nothing to review', () => {
    expect(listReviewFilter('tab-x')).toBeNull()
    expect(listReviewCount('tab-x')).toBe(0)
  })
})

// ── The top bar ─────────────────────────────────────────────────────────────

describe('screenReviewFilter', () => {
  beforeEach(clearFilterStore)

  it('the chips and the text search as one expression', () => {
    useFilterStore.getState().setPersonIds(new Set([1, 2]))
    useFilterStore.getState().setSearchText('contract')
    expect(screenReviewFilter()).toEqual({
      expression: {
        kind: 'and',
        items: [{ kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }] }, { kind: 'text', text: 'contract' }],
      },
      showCompleted: false,
      // The panel's tasks are under the top bar's lens: the widget follows it too (F4).
      ignoreLens: false,
    })
  })

  it('a person’s, a tag’s and several people’s reviews count nothing under a lens switch: they carry none', () => {
    expect(personReviewFilter({ id: 3 })).not.toHaveProperty('ignoreLens')
    expect(tagReviewFilter({ id: 7 })).not.toHaveProperty('ignoreLens')
    expect(peopleReviewFilter([{ id: 1 }, { id: 2 }])).not.toHaveProperty('ignoreLens')
  })

  it('no chips: every open task', () => {
    expect(screenReviewFilter().expression).toEqual({ kind: 'and', items: [] })
  })
})

// ── A Breakdown row ─────────────────────────────────────────────────────────

describe('a Breakdown row as a filter keeps exactly the row’s tasks', () => {
  const zed = makePerson({ id: 1, name: 'Zed Ortiz' })
  const amy = makePerson({ id: 2, name: 'Amy' })
  const q4: Tag & { id: number } = { id: 1, name: 'q4', color: '#111' }
  const home: Tag & { id: number } = { id: 2, name: 'home', color: '#222' }
  const statuses: (Status & { id: number })[] = [
    { id: 10, name: 'Todo', color: '#888', sortOrder: 1 },
    { id: 11, name: 'Waiting', color: '#888', sortOrder: 2 },
  ]
  // Every bucket of every split: due late / today / this week / later / none; created this week … long ago; each marker mix.
  const tasks: PersistedTodoItem[] = [
    makeTodo({ id: 1, dueDate: day(-3), createdAt: day(-2), statusId: 10, urgent: true }),
    makeTodo({ id: 2, dueDate: day(0), createdAt: day(-6), statusId: 11, important: true }),
    makeTodo({ id: 3, dueDate: day(1), createdAt: day(-7), focus: true, important: true }),
    makeTodo({ id: 4, dueDate: day(7), createdAt: day(-27), urgent: true, important: true }),
    makeTodo({ id: 5, dueDate: day(8), createdAt: day(-28), statusId: 10 }),
    makeTodo({ id: 6, createdAt: day(-90) }),
    makeTodo({ id: 7, dueDate: day(2), createdAt: day(-91), statusId: 11 }),
    makeTodo({ id: 8, createdAt: day(-400), important: true, urgent: false }),
  ]
  const assignedPeopleMap = new Map<number, Person[]>([[1, [zed]], [2, [zed, amy]], [4, [amy]], [7, [zed]]])
  const assignedTagsMap = new Map<number, Tag[]>([[1, [q4]], [3, [q4, home]], [5, [home]]])
  const ctx: StatsContext = { today, weekStartsOn: 1, urgentRange: 3, assignedPeopleMap, assignedTagsMap, statuses }
  const lookups = todoNameLookups({ assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo: new Map(), subtasksByTodo: new Map() })

  const kept = (f: ReviewFilter): number[] => {
    const criteria = predicateToCriteria(withExpression(emptyPredicate(), f.expression, f.showCompleted))
    return tasks.filter((t) => matchesFilterWithLookups(criteria, t, lookups, today, { urgentRange: 3, weekStartsOn: 1 })).map((t) => t.id).sort((a, b) => a - b)
  }
  const ids = (row: BreakdownRow) => [...row.ids].sort((a, b) => a - b)
  const rowsOf = (splitBy: BreakdownSplit, over: readonly PersistedTodoItem[] = tasks) =>
    computeBreakdown(over, ctx, { splitBy, show: 'count', oldestBy: 'created', columns: [] }).rows

  for (const splitBy of ['people', 'tags', 'status', 'priority', 'due', 'age'] as const) {
    it(`split by ${splitBy}: every row, the none row too`, () => {
      const rows = rowsOf(splitBy)
      expect(rows.length).toBeGreaterThan(1)
      for (const row of rows) {
        expect(breakdownRowTerm(row, splitBy), row.key).not.toBeNull()
        const filter = breakdownReviewFilter({ filter: emptyPredicate(), splitBy }, row)
        expect(filter && kept(filter), row.key).toEqual(ids(row))
      }
    })
  }

  it('ANDed with the Breakdown’s own filter, and a count column’s filter', () => {
    const chartFilter: TodoPredicate = { ...emptyPredicate(), tags: [1, 2] }
    const chartTasks = tasks.filter((t) => (assignedTagsMap.get(t.id) ?? []).length > 0)
    const zedRow = rowsOf('people', chartTasks).find((r) => r.key === 'person-1')
    if (!zedRow) throw new Error('no row')
    const filter = breakdownReviewFilter({ filter: chartFilter, splitBy: 'people' }, zedRow)
    expect(filter && kept(filter)).toEqual(ids(zedRow))
    const column = { filter: { ...emptyPredicate(), statusIds: [10] } }
    const withColumn = breakdownReviewFilter({ filter: chartFilter, splitBy: 'people' }, zedRow, column)
    expect(withColumn?.expression).toEqual({
      kind: 'and',
      items: [{ kind: 'or', items: [{ kind: 'tag', id: 1 }, { kind: 'tag', id: 2 }] }, { kind: 'person', id: 1 }, { kind: 'status', id: 10 }],
    })
    expect(withColumn && kept(withColumn)).toEqual([1])
  })

  it('carries the Breakdown’s lens switch (F4)', () => {
    const row = rowsOf('people')[0]
    if (!row) throw new Error('no row')
    expect(breakdownReviewFilter({ filter: emptyPredicate(), splitBy: 'people' }, row, undefined, true)?.ignoreLens).toBe(true)
    expect(breakdownReviewFilter({ filter: emptyPredicate(), splitBy: 'people' }, row, undefined, false)?.ignoreLens).toBe(false)
    expect(breakdownReviewFilter({ filter: emptyPredicate(), splitBy: 'people' }, row)).not.toHaveProperty('ignoreLens')
  })

  it('a Breakdown that counts completed tasks has no review: a row’s tasks open in the task dialog instead (G2)', () => {
    const row = rowsOf('people')[0]
    if (!row) throw new Error('no row')
    const thisWeek: TodoPredicate = { ...emptyPredicate(), dates: { completed: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'offset', days: 0 } } } }
    const shown: TodoPredicate = { ...emptyPredicate(), showCompleted: true }
    const typed: TodoPredicate = withExpression(emptyPredicate(), { kind: 'date', field: 'completed', match: { match: 'range', start: { kind: 'offset', days: -7 }, end: null } }, false)
    for (const filter of [thisWeek, shown, typed]) {
      expect(breakdownReviews({ filter })).toBe(false)
      expect(breakdownReviewFilter({ filter, splitBy: 'people' }, row)).toBeNull()
      expect(breakdownReviewFilter({ filter, splitBy: 'people' }, row, { filter: emptyPredicate() })).toBeNull()
    }
    // Open tasks only: reviewed as before.
    expect(breakdownReviews({ filter: emptyPredicate() })).toBe(true)
    expect(breakdownReviews({ filter: { ...emptyPredicate(), tags: [1] } })).toBe(true)
  })
})
