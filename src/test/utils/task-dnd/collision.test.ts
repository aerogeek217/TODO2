import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CollisionDetection, DroppableContainer } from '@dnd-kit/core'
import { RAILS_DRAG_TYPE, isRailsDropId } from '../../../utils/rail-dnd'
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

function callArgs(ids: (string | number)[], active: { id: string; data: Record<string, unknown> } | null) {
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
        when: (a) => a.data.type === TASK_DRAG_KIND.task,
        accept: (id) => String(id).startsWith('project-drop-'),
        algorithm: 'pointerWithin',
      },
    ])
    const result = detect(callArgs(
      ['project-drop-1', 'project-drop-2', 'rails:slot:x'],
      { id: 'todo-5', data: { type: TASK_DRAG_KIND.task } },
    ))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    const args = pointerWithinSpy.mock.calls[0][0]
    expect(args.droppableContainers.map((c: DroppableContainer) => c.id)).toEqual([
      'project-drop-1',
      'project-drop-2',
    ])
    expect(result.map((r) => r.id)).toEqual(['project-drop-1', 'project-drop-2'])
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
    detect(callArgs(['x', 'y'], { id: 'center-case', data: {} }))
    expect(closestCenterSpy).toHaveBeenCalledTimes(1)
    expect(pointerWithinSpy).not.toHaveBeenCalled()
    expect(rectIntersectionSpy).not.toHaveBeenCalled()

    pointerWithinSpy.mockClear(); closestCenterSpy.mockClear()
    detect(callArgs(['x', 'y'], { id: 'rect-case', data: {} }))
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
    detect(callArgs(['x'], { id: 'any', data: {} }))
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
    detect(callArgs(['a', 'b'], { id: 'other', data: {} }))
    expect(closestCenterSpy).toHaveBeenCalledTimes(1)
    // Fallback passes droppableContainers through unfiltered.
    expect(closestCenterSpy.mock.calls[0][0].droppableContainers.map((c: DroppableContainer) => c.id)).toEqual(['a', 'b'])
  })

  it('honors a custom fallback algorithm', () => {
    const detect = buildTaskCollision([], 'rectIntersection')
    detect(callArgs(['a'], { id: 'x', data: {} }))
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

describe('buildTaskCollision — F12 rails / task isolation', () => {
  // This mirrors the rules table wired in CanvasPage.tsx (lines 539–550). If
  // the production table drifts, update this test rather than deleting it —
  // the whole point of F12 is that this contract stays intact.
  const railsFirstThenTasks = buildTaskCollision([
    {
      when: (a) => a.data.type === RAILS_DRAG_TYPE,
      accept: (id) => isRailsDropId(String(id)),
      algorithm: 'pointerWithin',
    },
    {
      when: () => true,
      accept: (id) => !isRailsDropId(String(id)),
      algorithm: 'pointerWithin',
    },
  ])

  const mixed = [
    'rails:slot:s-1',
    'rails:tab-strip:s-2',
    'rails:empty-side:left',
    'project-drop-1',
    'dashboard-taskboard-drop',
    'taskboard-drop-77',
  ]

  it('rails drag sees only rails droppables', () => {
    railsFirstThenTasks(callArgs(mixed, {
      id: 'rails-active',
      data: { type: RAILS_DRAG_TYPE, kind: 'slot', slotId: 's-1', fromSide: 'left' },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    const seen = pointerWithinSpy.mock.calls[0][0].droppableContainers.map((c: DroppableContainer) => c.id)
    expect(seen).toEqual([
      'rails:slot:s-1',
      'rails:tab-strip:s-2',
      'rails:empty-side:left',
    ])
  })

  it('task drag never sees rails droppables', () => {
    railsFirstThenTasks(callArgs(mixed, {
      id: 'todo-5',
      data: { type: TASK_DRAG_KIND.task },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    const seen = pointerWithinSpy.mock.calls[0][0].droppableContainers.map((c: DroppableContainer) => c.id)
    expect(seen).toEqual([
      'project-drop-1',
      'dashboard-taskboard-drop',
      'taskboard-drop-77',
    ])
  })

  it('taskboard-task drag is routed like a task drag (never into rails zones)', () => {
    railsFirstThenTasks(callArgs(mixed, {
      id: 'tbp-1',
      data: { type: TASK_DRAG_KIND.taskboardTask },
    }))
    const seen = pointerWithinSpy.mock.calls[0][0].droppableContainers.map((c: DroppableContainer) => c.id)
    expect(seen.every((id: string) => !isRailsDropId(String(id)))).toBe(true)
  })
})
