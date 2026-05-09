import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { Person, Org, Status } from '../../models'
import { useGroupedTaskBlocks } from '../../hooks/use-grouped-task-blocks'
import { UNGROUPED_GROUP_KEY } from '../../utils/cross-group-drag'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useFilterStore } from '../../stores/filter-store'
import { useSettingsStore } from '../../stores/settings-store'
import { makeTodo, clearFilterStore, resetEntityStores } from '../helpers'

const STATUSES: Status[] = [
  { id: 1, name: 'Active', color: '#0a0', sortOrder: 0 },
  { id: 2, name: 'Blocked', color: '#a00', sortOrder: 1 },
]

const ALICE: Person = { id: 1, name: 'Alice', initials: 'A' }
const BOB: Person = { id: 2, name: 'Bob', initials: 'B' }
const ACME: Org = { id: 10, name: 'Acme' }

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useStatusStore.setState({ statuses: STATUSES })
  useSettingsStore.setState({ weekStartsOn: 1 })
})

afterEach(() => {
  cleanup()
})

describe('useGroupedTaskBlocks', () => {
  it('returns null when groupBy is undefined', () => {
    const todos = [makeTodo({ id: 1, statusId: 1 })]
    const { result } = renderHook(() => useGroupedTaskBlocks(todos, undefined, undefined))
    expect(result.current).toBeNull()
  })

  it('returns null when groupBy is null', () => {
    const todos = [makeTodo({ id: 1, statusId: 1 })]
    const { result } = renderHook(() => useGroupedTaskBlocks(todos, null, undefined))
    expect(result.current).toBeNull()
  })

  it('partitions tasks by status into named blocks', () => {
    const todos = [
      makeTodo({ id: 1, statusId: 1 }),
      makeTodo({ id: 2, statusId: 2 }),
      makeTodo({ id: 3, statusId: 1 }),
    ]
    const { result } = renderHook(() => useGroupedTaskBlocks(todos, 'status', undefined))
    expect(result.current).not.toBeNull()
    const blocks = result.current!
    const keys = blocks.map((b) => b.key)
    expect(keys).toContain('status-1')
    expect(keys).toContain('status-2')
    const statusOne = blocks.find((b) => b.key === 'status-1')!
    expect(statusOne.todos.map((t) => t.id).sort()).toEqual([1, 3])
    expect(statusOne.label).toBe('Active')
  })

  it('emits the synthetic ungrouped block first when present', () => {
    const todos = [
      makeTodo({ id: 1, statusId: 1 }),
      makeTodo({ id: 2 }), // no status → ungrouped
    ]
    const { result } = renderHook(() => useGroupedTaskBlocks(todos, 'status', undefined))
    const blocks = result.current!
    expect(blocks[0]?.key).toBe(UNGROUPED_GROUP_KEY)
    expect(blocks[0]?.label).toBeNull()
    expect(blocks[0]?.todos.map((t) => t.id)).toEqual([2])
  })

  it('chains nextBlockFirstId across blocks for trigger placement', () => {
    const todos = [
      makeTodo({ id: 100, statusId: 1 }),
      makeTodo({ id: 200, statusId: 2 }),
      makeTodo({ id: 300 }), // ungrouped
    ]
    const { result } = renderHook(() => useGroupedTaskBlocks(todos, 'status', undefined))
    const blocks = result.current!
    // Ungrouped block leads, status-1, status-2 last
    expect(blocks[0]?.nextBlockFirstId).toBe(blocks[1]?.todos[0]?.id ?? null)
    expect(blocks[1]?.nextBlockFirstId).toBe(blocks[2]?.todos[0]?.id ?? null)
    expect(blocks[blocks.length - 1]?.nextBlockFirstId).toBeNull()
  })

  it('partitions by people using the assignedPeopleMap prop', () => {
    const t1 = makeTodo({ id: 1 })
    const t2 = makeTodo({ id: 2 })
    const peopleMap = new Map<number, Person[]>([
      [1, [ALICE]],
      [2, [BOB]],
    ])
    const { result } = renderHook(() =>
      useGroupedTaskBlocks([t1, t2], 'people', peopleMap),
    )
    const blocks = result.current!
    const keys = blocks.map((b) => b.key)
    expect(keys).toContain('person-1')
    expect(keys).toContain('person-2')
  })

  it('restricts visible groups to active people filter (P6 intersection)', () => {
    useFilterStore.setState({
      filters: { ...useFilterStore.getState().filters, personIds: new Set([1]) },
    })
    const t1 = makeTodo({ id: 1 })
    const t2 = makeTodo({ id: 2 })
    const peopleMap = new Map<number, Person[]>([
      [1, [ALICE]],
      [2, [BOB]],
    ])
    const { result } = renderHook(() =>
      useGroupedTaskBlocks([t1, t2], 'people', peopleMap),
    )
    const blocks = result.current!
    const keys = blocks.map((b) => b.key)
    expect(keys).toContain('person-1')
    expect(keys).not.toContain('person-2')
  })

  it('surfaces include-orgs implicit person keys for tasks with org but no person', () => {
    // ALICE belongs to ACME; the task has ACME but no direct person assignment.
    useOrgStore.setState({
      orgs: [ACME],
      assignedOrgsMap: new Map([[1, [ACME]]]),
      personOrgMap: new Map([[1, [10]]]),
    })
    useFilterStore.setState({
      filters: {
        ...useFilterStore.getState().filters,
        personIds: new Set([1]),
        personFilterMode: 'include-orgs',
      },
    })
    const t = makeTodo({ id: 1 })
    const peopleMap = new Map<number, Person[]>()
    const { result } = renderHook(() =>
      useGroupedTaskBlocks([t], 'people', peopleMap),
    )
    const blocks = result.current!
    // Cross-axis: surfaces under person-1 because ALICE is a member of ACME.
    expect(blocks.find((b) => b.key === 'person-1')?.todos.map((x) => x.id)).toEqual([1])
  })

  it('returns no implicit-tier surfaces for direct-only mode', () => {
    useOrgStore.setState({
      orgs: [ACME],
      assignedOrgsMap: new Map([[1, [ACME]]]),
      personOrgMap: new Map([[1, [10]]]),
    })
    useFilterStore.setState({
      filters: {
        ...useFilterStore.getState().filters,
        personIds: new Set([1]),
        personFilterMode: 'direct-only',
      },
    })
    const t = makeTodo({ id: 1 })
    const peopleMap = new Map<number, Person[]>()
    const { result } = renderHook(() =>
      useGroupedTaskBlocks([t], 'people', peopleMap),
    )
    const blocks = result.current!
    // direct-only: the org-membership cross-axis path is skipped, so
    // person-1 has no rows.
    expect(blocks.find((b) => b.key === 'person-1')).toBeUndefined()
  })

  it('restricts to active tag filter without cross-axis path', () => {
    const urgent = { id: 7, name: 'urgent', color: '#f00' }
    useTagStore.setState({
      tags: [urgent],
      assignedTagsMap: new Map([[1, [urgent]]]),
    })
    useFilterStore.setState({
      filters: { ...useFilterStore.getState().filters, tags: new Set([7]) },
    })
    // SortableTaskList consumers pre-filter via the FilterStore, so by the
    // time tasks land here only the tag-matched task remains; the visible
    // groups are then narrowed to the tag-7 chip.
    const t1 = makeTodo({ id: 1 })
    const { result } = renderHook(() =>
      useGroupedTaskBlocks([t1], 'tag', undefined),
    )
    const blocks = result.current!
    expect(blocks.map((b) => b.key)).toEqual(['tag-7'])
    expect(blocks[0]?.todos.map((x) => x.id)).toEqual([1])
  })
})
