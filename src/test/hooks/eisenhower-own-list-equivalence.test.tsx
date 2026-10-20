import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { upgradeV67 } from '../../data/upgrades/v67-layout-order-and-eisenhower-list'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { Person, Status } from '../../models'
import { useEisenhowerSource } from '../../hooks/use-eisenhower-source'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import { computeEisenhowerSummary, eisenhowerSourceTasks } from '../../services/stats/eisenhower-summary'
import { statsFilter } from '../../services/stats/stats-context'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { applyFilter } from '../../utils/filter-match'
import { resolvePanes } from '../../utils/eisenhower-panes'
import { DEFAULT_HOT_RULE } from '../../utils/hot'
import { startOfDay } from '../../utils/date'
import { emptyFilterCriteria, makeTodo, statsPaneContext } from '../helpers'

/**
 * The upgrade gives an Eisenhower that showed all tasks a new list with no
 * filter as its own. That list must show exactly the tasks "All tasks"
 * showed — open and completed, under any screen filter — in the Eisenhower
 * widget and in the dashboard's Eisenhower section. The list is taken from
 * the transform itself, so a change to what it makes is checked here too.
 */
const madeList = upgradeV67({ listDefinitions: [], settings: [] }).listDefinitions![0] as unknown as PersistedListDefinition

const today = startOfDay(new Date())
const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000)

const ann: Person & { id: number } = { id: 1, name: 'Ann', initials: 'A' }
const waiting: Status & { id: number } = { id: 2, name: 'Waiting', color: '#888', sortOrder: 0 }

const todos = [
  makeTodo({ id: 1, title: 'Send report', urgent: true, dueDate: inDays(1) }),
  makeTodo({ id: 2, title: 'Plan', important: true, statusId: 2 }),
  makeTodo({ id: 3, title: 'Report draft', isCompleted: true, completedAt: inDays(-1), urgent: true }),
  makeTodo({ id: 4, title: 'Call', focus: true, dueDate: inDays(-2) }),
  makeTodo({ id: 5, title: 'Old report', isCompleted: true, completedAt: inDays(-30), important: true, statusId: 2 }),
  makeTodo({ id: 6, title: 'Idle' }),
]
const assignedPeopleMap = new Map<number, Person[]>([[1, [ann]], [3, [ann]], [6, [ann]]])

const SCREENS: Array<[string, Partial<FilterCriteria>]> = [
  ['no screen filter', {}],
  ['Show completed', { showCompleted: true }],
  ['a person', { personIds: new Set([1]) }],
  ['a person, with Show completed', { personIds: new Set([1]), showCompleted: true }],
  ['a status “is not”', { statusIds: new Set([2]), negate: { statusIds: true } }],
  ['search text, with Show completed', { searchText: 'report', showCompleted: true }],
  ['a marker', { markers: { urgent: true } }],
  ['a due date', { dates: { deadline: { match: 'set' } } }],
]

beforeEach(() => {
  useTodoStore.setState({ todos })
  usePersonStore.setState({ people: [ann], assignedPeopleMap })
  useStatusStore.setState({ statuses: [waiting] })
  useListDefinitionStore.setState({ listDefinitions: [madeList], loaded: true })
})

const ids = (tasks: readonly { id: number }[]) => tasks.map((t) => t.id).sort((a, b) => a - b)

describe('the Eisenhower’s new list (no filter) shows what All tasks showed', () => {
  it('the list the upgrade makes has no filter but Show completed off', () => {
    expect(madeList.membership.predicate).toEqual({
      showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null,
    })
    expect('runtimeFilter' in madeList).toBe(false)
    expect(madeList.owner).toEqual({ eisenhower: true })
  })

  it.each(SCREENS)('in the widget, under %s: the same tasks shown and the same open total', (_what, screen) => {
    act(() => useFilterStore.getState().setAllFilters({ ...emptyFilterCriteria, ...screen }))
    useSettingsStore.setState({ eisenhowerListId: null })
    const { result, rerender } = renderHook(() => useEisenhowerSource())
    const all = result.current
    act(() => useSettingsStore.setState({ eisenhowerListId: madeList.id }))
    rerender()
    const own = result.current
    expect(own.list?.definition.id).toBe(madeList.id)
    expect(ids(own.shown)).toEqual(ids(all.shown))
    expect(own.openTotal).toBe(all.openTotal)
    expect(all.shown.length).toBeGreaterThan(0)
    // Completed tasks show exactly when the screen filter shows them.
    expect(own.shown.some((t) => t.isCompleted)).toBe(screen.showCompleted === true && all.shown.some((t) => t.isCompleted))
  })

  it.each(SCREENS)('on the dashboard, under %s: the same counts per pane, shown and in total', (_what, screen) => {
    const criteria: FilterCriteria = { ...emptyFilterCriteria, ...screen }
    const settings = { urgentRange: 3 as const, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 1 as const }
    const lookups = { assignedPeopleMap, assignedTagsMap: new Map(), statusesById: new Map([[2, waiting]]) }
    // The dashboard's screen-filtered tasks (completed included).
    const shownAll = applyFilter(statsFilter(criteria), todos, assignedPeopleMap, [waiting], today, new Map(), settings)
    const opts = { screen: statsFilter(criteria), lookups, today, settings }
    const all = eisenhowerSourceTasks(todos, shownAll, undefined, opts)
    const own = eisenhowerSourceTasks(todos, shownAll, madeList, opts)
    const panes = resolvePanes({})
    const paneCtx = statsPaneContext({ today, weekStartsOn: 1, urgentRange: 3, hotRule: DEFAULT_HOT_RULE, assignedPeopleMap, assignedTagsMap: new Map(), statuses: [waiting] })
    expect(computeEisenhowerSummary(own.shown, panes, paneCtx)).toEqual(computeEisenhowerSummary(all.shown, panes, paneCtx))
    expect(computeEisenhowerSummary(own.total, panes, paneCtx)).toEqual(computeEisenhowerSummary(all.total, panes, paneCtx))
    expect(ids(own.total.filter((t) => !t.isCompleted))).toEqual(ids(all.total.filter((t) => !t.isCompleted)))
  })
})
