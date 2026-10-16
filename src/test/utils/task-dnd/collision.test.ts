import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CollisionDetection, DroppableContainer } from '@dnd-kit/core'
import { WORKSPACE_TAB_DRAG } from '../../../components/workspace/workspace-drag'
import { TASK_DRAG_KIND, buildTaskCollision } from '../../../utils/task-dnd'

type DetectArgs = Parameters<CollisionDetection>[0]

// A spy around dnd-kit's pointerWithin. We don't care what it returns for
// these tests — only that it ran and with which droppable set.
const pointerWithinSpy = vi.fn((args: DetectArgs) => args.droppableContainers.map((c: DroppableContainer) => ({ id: c.id })))

vi.mock('@dnd-kit/core', () => ({
  pointerWithin: (args: DetectArgs) => pointerWithinSpy(args),
}))

function container(id: string | number): DroppableContainer {
  return { id, data: { current: {} } } as unknown as DroppableContainer
}

function callArgs(
  ids: (string | number)[],
  active: { id: string; data: { current: Record<string, unknown> | null } } | null,
): DetectArgs {
  return {
    active,
    droppableContainers: ids.map(container),
    collisionRect: { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 },
    droppableRects: new Map(),
    pointerCoordinates: { x: 0, y: 0 },
  } as unknown as DetectArgs
}

function seenIds(call = 0): (string | number)[] {
  const args = pointerWithinSpy.mock.calls[call]?.[0]
  return (args?.droppableContainers ?? []).map((c) => c.id)
}

beforeEach(() => {
  pointerWithinSpy.mockClear()
})

describe('buildTaskCollision — basic dispatch', () => {
  it('returns results from the first matching rule, over the droppables it accepts', () => {
    const detect = buildTaskCollision([
      {
        when: (a) => a.data.current?.type === TASK_DRAG_KIND.task,
        accept: (id) => String(id).startsWith('calday-'),
      },
    ])
    const result = detect(callArgs(
      ['calday-a-1', 'calday-a-2', 'other-x'],
      { id: 'lw|t|all|5', data: { current: { type: TASK_DRAG_KIND.task } } },
    ))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(seenIds()).toEqual(['calday-a-1', 'calday-a-2'])
    expect(result.map((r) => r.id)).toEqual(['calday-a-1', 'calday-a-2'])
  })

  it('stops at the first matching rule even when later rules would also match', () => {
    const detect = buildTaskCollision([
      { when: () => true, accept: (id) => id === 'x' },
      { when: () => true, accept: () => true },
    ])
    detect(callArgs(['x', 'y'], { id: 'any', data: { current: {} } }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(seenIds()).toEqual(['x'])
  })

  it('every droppable is in scope when no rule matches', () => {
    const detect = buildTaskCollision([{ when: (a) => a.id === 'never', accept: () => false }])
    detect(callArgs(['a', 'b'], { id: 'other', data: { current: {} } }))
    expect(seenIds()).toEqual(['a', 'b'])
  })

  it('every droppable is in scope when no drag is in flight (rules skipped)', () => {
    const when = vi.fn(() => true)
    const detect = buildTaskCollision([{ when, accept: () => false }])
    detect(callArgs(['a'], null))
    expect(when).not.toHaveBeenCalled()
    expect(seenIds()).toEqual(['a'])
  })
})

describe('buildTaskCollision — workspace tab / task isolation', () => {
  // Mirrors the rules table wired in WorkspacePage.tsx: tab drags find their
  // target from measured geometry, so they hit no droppable; task drags hit
  // the calendar days / quadrants under the pointer.
  const workspaceRules = buildTaskCollision([
    { when: (a) => a.data.current?.type === WORKSPACE_TAB_DRAG, accept: () => false },
  ])

  const droppables = ['calday-ws-cal1-0', 'calday-ws-cal2-77', 'eis-t3-do']

  it('a tab drag sees no droppables', () => {
    workspaceRules(callArgs(droppables, {
      id: 'ws-tab-t1',
      data: { current: { type: WORKSPACE_TAB_DRAG, tabId: 't1' } },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(seenIds()).toEqual([])
  })

  it('a task drag sees every calendar day and quadrant', () => {
    workspaceRules(callArgs(droppables, {
      id: 'lw|t1|all|5',
      data: { current: { type: TASK_DRAG_KIND.task } },
    }))
    expect(pointerWithinSpy).toHaveBeenCalledTimes(1)
    expect(seenIds()).toEqual(droppables)
  })
})
