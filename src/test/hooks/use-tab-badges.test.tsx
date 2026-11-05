import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useTabBadges } from '../../hooks/use-tab-badges'
import type { LayoutTab } from '../../models/workspace-layout'
import type { PersistedListDefinition } from '../../models/list-definition'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { makePerson, makeTodo } from '../helpers'

/**
 * A strip's list-tab badges (cr31 tests 3.4): what each list tab shows on
 * opening — the list as edited (its draft), its prompt pick, the screen
 * filter — counted inside its ranges; open tasks only; a list waiting on its
 * prompt, or with nothing to count, has none. It re-implements
 * `useBuiltList`'s input, so these pin the two together.
 */

const day = (offset: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

const alice = makePerson({ id: 1, name: 'Alice' })
const bob = makePerson({ id: 2, name: 'Bob' })

const list = (id: number, predicate: Partial<TodoPredicate> = {}, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
  ...extra,
})
const tab = (id: string, listDefinitionId: number): LayoutTab => ({ id, kind: 'lens', config: { listDefinitionId } }) as LayoutTab

const TASKS = [
  makeTodo({ id: 1, dueDate: day(-2) }), // overdue
  makeTodo({ id: 2, dueDate: day(2) }), // within 3 days
  makeTodo({ id: 3, dueDate: day(10) }), // outside
  makeTodo({ id: 4, dueDate: day(-1), isCompleted: true }), // completed: never counts
  makeTodo({ id: 5, nextFollowupAt: day(0) }), // follow-up today
  makeTodo({ id: 6, nextFollowupAt: day(1) }), // follow-up tomorrow: outside the default (overdue and today)
]

beforeEach(() => {
  useTodoStore.setState({ todos: TASKS })
  usePersonStore.setState({
    people: [alice, bob],
    assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [5, [alice]]]),
  })
  useListDefinitionStore.setState({ listDefinitions: [list(7), list(8, { personIds: [1] })] })
})
afterEach(cleanup)

const badges = (tabs: LayoutTab[]) => renderHook(() => useTabBadges(tabs))

describe('useTabBadges', () => {
  it('counts each list tab’s open tasks inside the app’s ranges (default: due within 3 days, follow-ups today), overdue apart', () => {
    const { result } = badges([tab('a', 7), tab('b', 8)])
    expect(result.current.get('a')?.counts).toEqual({ due: 2, dueOverdue: 1, followup: 1, followupOverdue: 0 })
    expect(result.current.get('a')?.summary).toEqual(['2 due: 1 overdue, 1 within 3 days', '1 follow-up: today'])
    // People is Alice: tasks 1 and 5.
    expect(result.current.get('b')?.counts).toEqual({ due: 1, dueOverdue: 1, followup: 1, followupOverdue: 0 })
  })

  it('no badge for a tab with nothing to count, a list gone, or a tab that isn’t a list', () => {
    useListDefinitionStore.setState({ listDefinitions: [list(7, { personIds: [2] }), list(9, { searchText: 'nothing' })] })
    const { result } = badges([
      tab('a', 7), tab('gone', 42), tab('none', 9),
      { id: 'cal', kind: 'calendar', config: {} } as unknown as LayoutTab,
    ])
    expect([...result.current.keys()]).toEqual(['a'])
  })

  it('reads the list as edited: its draft, not the saved definition', () => {
    const { result, rerender } = badges([tab('a', 7)])
    expect(result.current.get('a')?.counts.due).toBe(2)
    act(() => useListDraftStore.setState({ drafts: { 7: list(7, { personIds: [2] }) } }))
    rerender()
    expect(result.current.get('a')?.counts).toEqual({ due: 1, dueOverdue: 0, followup: 0, followupOverdue: 0 })
  })

  it('the list’s own ranges win over the app’s; its own “off” shows none; the app’s ranges from Settings', () => {
    useListDefinitionStore.setState({
      listDefinitions: [list(7, {}, { tabBadges: { due: 'overdue', followup: 1 } }), list(8, {}, { tabBadges: 'off' })],
    })
    const { result } = badges([tab('a', 7), tab('b', 8)])
    expect(result.current.get('a')?.counts).toEqual({ due: 1, dueOverdue: 1, followup: 2, followupOverdue: 0 })
    expect(result.current.has('b')).toBe(false)
    cleanup()
    useListDefinitionStore.setState({ listDefinitions: [list(7)] })
    useSettingsStore.setState({ tabBadges: { due: 14, followup: 'off' } })
    const again = badges([tab('a', 7)])
    expect(again.result.current.get('a')?.counts).toEqual({ due: 3, dueOverdue: 1, followup: 0, followupOverdue: 0 })
  })

  it('a list with a prompt: none until it is picked, then the pick narrows it', () => {
    useListDefinitionStore.setState({ listDefinitions: [list(7, {}, { runtimeFilter: { field: 'person' } })] })
    const { result, rerender } = badges([tab('a', 7)])
    expect(result.current.has('a')).toBe(false)
    act(() => useListWidgetStore.setState({ picks: { a: [2] } }))
    rerender()
    expect(result.current.get('a')?.counts).toEqual({ due: 1, dueOverdue: 0, followup: 0, followupOverdue: 0 })
  })

  it('the screen filter narrows every tab', () => {
    const { result, rerender } = badges([tab('a', 7)])
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    rerender()
    expect(result.current.get('a')?.counts).toEqual({ due: 1, dueOverdue: 1, followup: 1, followupOverdue: 0 })
  })
})
