import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CollisionDetection, DroppableContainer } from '@dnd-kit/core'
import { WORKSPACE_TAB_DRAG } from '../../../components/workspace/workspace-drag'
import { TASK_DRAG_KIND, buildTaskCollision } from '../../../utils/task-dnd'

// Spy wrappers around dnd-kit's real algorithms. We don't care what they
// return for these tests — only which one ran and with which droppable set.
const pointerWithinSpy = vi.fn((args: any) => args.droppableContainers.map((c: DroppableContainer) => ({ id: c.id })))
const closestCenterSpy = vi.fn((args: any) => args.droppableContainers.map((c: DroppableContainer) => ({ id: c.id })))
const rectIntersectionSpy = vi.fn((args: any) => args.droppableContainers.map((c: DroppableContainer) => ({ id: c.id })))

vi.mock('@dnd-kit/core', () => ({
  pointerWithin: (args: any) => pointerWithinSpy(args),
  closestCenter: (args: any) => closestCenterSpy(args),
  rectIntersection: (args: any) => rectIntersectionSpy(args),
}))

function container(id: string | number): DroppableContainer {
  return { id, data: { current: {} } } as unknown as DroppableContainer
}

function callArgs(
  ids: (string | number)[],
  active: { id: string; data: { current: Record<string, unknown> | null } } | null,
) {
  return {
    active,
    droppableContainers: ids.map(container),
    collisionRect: { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 },
    droppableRects: new Map(),
    pointerCoordinates: { x: 0, y: 0 },
  } as unknown as Parameters<CollisionDetection>[0]
}

beforeEach(() => {
  pointerWithinSpy.mockClear()
  closestCenterSpy.mockClear()
  rectIntersectionSpy.mockClear()
})

describe('buildTaskCollision — basic dispatch', () => {
  it('returns results from the first matching rule', () => {
    const detect = buildTaskCollision([
      {
        when: (a) => a.data.current?.type === TASK_DRAG_KIND.task,
        accept: (id) => String(id).startsWith('calday-'),
        algorithm: 'pointerWithin',
      },
    ])
    const result = detect(callArgs(
      ['calday-a-1', 'calday-a-2', 'other-x'],
      { id: 'lw|t|all|5', data: { current: { type: TASK_DRAG_KIND.task } } },
    ))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    const args = pointerWithinSpy.mock.calls[0]![0]
    expect(args.droppableContainers.map((c: DroppableContainer) => c.id)).toEqual([
      'calday-a-1',
      'calday-a-2',
    ])
    expect(result.map((r) => r.id)).toEqual(['calday-a-1', 'calday-a-2'])
  })

  it('honors per-rule algorithm selection', () => {
    const detect = buildTaskCollision([
      {
        when: (a) => a.id === 'center-case',
        accept: () => true,
        algorithm: 'closestCenter',
      },
      {
        when: (a) => a.id === 'rect-case',
        accept: () => true,
        algorithm: 'rectIntersection',
      },
    ])
    detect(callArgs(['x', 'y'], { id: 'center-case', data: { current: {} } }))
    expect(closestCenterSpy).toHaveBeenCalledTimes(1)
    expect(pointerWithinSpy).not.toHaveBeenCalled()
    expect(rectIntersectionSpy).not.toHaveBeenCalled()

    pointerWithinSpy.mockClear(); closestCenterSpy.mockClear()
    detect(callArgs(['x', 'y'], { id: 'rect-case', data: { current: {} } }))
    expect(rectIntersectionSpy).toHaveBeenCalledTimes(1)
    expect(closestCenterSpy).not.toHaveBeenCalled()
    expect(pointerWithinSpy).not.toHaveBeenCalled()
  })

  it('stops at the first matching rule even when later rules would also match', () => {
    const detect = buildTaskCollision([
      {
        when: () => true,
        accept: () => true,
        algorithm: 'pointerWithin',
      },
      {
        when: () => true,
        accept: () => true,
        algorithm: 'closestCenter',
      },
    ])
    detect(callArgs(['x'], { id: 'any', data: { current: {} } }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(closestCenterSpy).not.toHaveBeenCalled()
  })

  it('falls back to closestCenter when no rule matches', () => {
    const detect = buildTaskCollision([
      {
        when: (a) => a.id === 'never',
        accept: () => true,
        algorithm: 'rectIntersection',
      },
    ])
    detect(callArgs(['a', 'b'], { id: 'other', data: { current: {} } }))
    expect(closestCenterSpy).toHaveBeenCalledTimes(1)
    // Fallback passes droppableContainers through unfiltered.
    expect(closestCenterSpy.mock.calls[0]![0].droppableContainers.map((c: DroppableContainer) => c.id)).toEqual(['a', 'b'])
  })

  it('honors a custom fallback algorithm', () => {
    const detect = buildTaskCollision([], 'rectIntersection')
    detect(callArgs(['a'], { id: 'x', data: { current: {} } }))
    expect(rectIntersectionSpy).toHaveBeenCalledTimes(1)
    expect(closestCenterSpy).not.toHaveBeenCalled()
  })

  it('falls back to closestCenter when active is null (no drag in flight)', () => {
    const detect = buildTaskCollision([
      {
        when: () => true,
        accept: () => true,
        algorithm: 'pointerWithin',
      },
    ])
    detect(callArgs(['a'], null))
    // null active skips the rules table entirely.
    expect(pointerWithinSpy).not.toHaveBeenCalled()
    expect(closestCenterSpy).toHaveBeenCalledTimes(1)
  })
})

describe('buildTaskCollision — workspace tab / task isolation', () => {
  // Mirrors the rules table wired in WorkspacePage.tsx: tab drags find their
  // target from measured geometry, so they hit no droppable; task drags hit
  // the calendar days under the pointer.
  const workspaceRules = buildTaskCollision([
    { when: (a) => a.data.current?.type === WORKSPACE_TAB_DRAG, accept: () => false, algorithm: 'pointerWithin' },
    { when: () => true, accept: () => true, algorithm: 'pointerWithin' },
  ])

  const days = ['calday-cal1-0', 'calday-cal2-77']

  it('a tab drag sees no droppables', () => {
    workspaceRules(callArgs(days, {
      id: 'ws-tab-t1',
      data: { current: { type: WORKSPACE_TAB_DRAG, tabId: 't1' } },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(pointerWithinSpy.mock.calls[0]![0].droppableContainers).toEqual([])
  })

  it('a task drag sees every calendar day', () => {
    workspaceRules(callArgs(days, {
      id: 'lw|t1|all|5',
      data: { current: { type: TASK_DRAG_KIND.task } },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    const seen = pointerWithinSpy.mock.calls[0]![0].droppableContainers.map((c: DroppableContainer) => c.id)
    expect(seen).toEqual(days)
  })
})
