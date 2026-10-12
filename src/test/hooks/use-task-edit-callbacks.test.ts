import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useTaskEditCallbacks } from '../../hooks/use-task-edit-callbacks'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo } from '../helpers'
import { usePersonStore } from '../../stores/person-store'
import { db } from '../../data/database'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

/**
 * The editor's onUpdate is bulk-aware: with several tasks selected, a change
 * to status, due date or either follow-up date also goes to the others.
 */
describe('useTaskEditCallbacks — edits apply to the other selected tasks', () => {
  beforeEach(() => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'A' }), makeTodo({ id: 2, title: 'B' }), makeTodo({ id: 3, title: 'C' })],
    })
    useUIStore.setState({ selectedTodoId: 1, selectedTodoIds: new Set([1, 2]) })
  })

  afterEach(cleanup)

  function edit(changes: Record<string, unknown>) {
    const { result } = renderHook(() => useTaskEditCallbacks())
    const todo = useTodoStore.getState().todos.find((t) => t.id === 1)!
    act(() => { result.current.editProps!.onUpdate({ ...todo, ...changes }) })
  }

  const field = (id: number, key: 'lastFollowupAt' | 'nextFollowupAt' | 'title') =>
    useTodoStore.getState().todos.find((t) => t.id === id)![key]

  it('a manual Last follow-up edit goes to every selected task (like Next and Followed up)', () => {
    edit({ lastFollowupAt: day(2026, 9, 13) })
    expect(field(1, 'lastFollowupAt')).toEqual(day(2026, 9, 13))
    expect(field(2, 'lastFollowupAt')).toEqual(day(2026, 9, 13))
    expect(field(3, 'lastFollowupAt')).toBeUndefined()
  })

  it('clearing Last clears it on the others too', () => {
    useTodoStore.setState({
      todos: useTodoStore.getState().todos.map((t) => ({ ...t, lastFollowupAt: day(2026, 9, 1) })),
    })
    edit({ lastFollowupAt: undefined })
    expect(field(2, 'lastFollowupAt')).toBeUndefined()
    expect(field(3, 'lastFollowupAt')).toEqual(day(2026, 9, 1))
  })

  it('Next follow-up still propagates; a title edit does not', () => {
    edit({ nextFollowupAt: day(2026, 12, 1), title: 'Renamed' })
    expect(field(2, 'nextFollowupAt')).toEqual(day(2026, 12, 1))
    expect(field(2, 'title')).toBe('B')
  })
})

describe('useTaskEditCallbacks — create', () => {
  beforeEach(async () => {
    // Tables cleared (not the db deleted) so the edit tests' writes can settle.
    await Promise.all([db.people.clear(), db.todoPeople.clear(), db.todos.clear()])
    useTodoStore.setState({ todos: [] })
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
  })

  afterEach(cleanup)

  it('an @name that matches nobody creates the person and assigns it', async () => {
    const { result } = renderHook(() => useTaskEditCallbacks())
    let id = 0
    await act(async () => { id = await result.current.onCreate({ title: 'Call legal @Marco' }) })

    const people = await db.people.toArray()
    expect(people.map((p) => p.name)).toEqual(['Marco'])
    const joins = await db.todoPeople.where('todoId').equals(id).toArray()
    expect(joins.map((j) => j.personId)).toEqual([people[0]!.id])
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('Call legal')
  })

  it('onCreatePerson reuses an existing person whatever the case', async () => {
    const existing = await usePersonStore.getState().add('Dana Kim', 'DK')
    const { result } = renderHook(() => useTaskEditCallbacks())
    let id = 0
    await act(async () => { id = await result.current.entityCreators.onCreatePerson('dana kim') })
    expect(id).toBe(existing)
    expect((await db.people.toArray()).map((p) => p.name)).toEqual(['Dana Kim'])
  })
})
