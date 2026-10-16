import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { DndContext, KeyboardSensor, useSensor, useSensors, type Active } from '@dnd-kit/core'
import { TaskDraggable } from '../../../../components/task/dnd/TaskDraggable'
import { TASK_DRAG_KIND, type TaskSurfaceKey } from '../../../../utils/task-dnd'
import { makeTodo } from '../../../helpers'

afterEach(() => cleanup())

/**
 * What a `TaskDraggable` owns: the drag id (`taskDragId(surface, todoId,
 * extras)`) and the drag data (`{ ...extraData, type, todo }`). Both are read
 * off a real drag: a keyboard drag (Space on the row) starts in JSDOM, and
 * `onDragStart` hands over dnd-kit's `active`.
 */
function startDrag(opts: {
  surface?: TaskSurfaceKey
  scope?: string
  sectionKey?: string
  todoId?: number
  extraData?: Record<string, unknown>
} = {}): Active {
  const todo = makeTodo({ id: opts.todoId ?? 9 })
  let active: Active | null = null
  function Harness() {
    const sensors = useSensors(useSensor(KeyboardSensor))
    return (
      <DndContext sensors={sensors} onDragStart={(e) => { active = e.active }}>
        <TaskDraggable
          todo={todo}
          surface={opts.surface ?? 'list-widget'}
          scope={opts.scope ?? 't1'}
          sectionKey={opts.sectionKey ?? 'status-5'}
          extraData={opts.extraData}
        >
          {({ setNodeRef, attributes, listeners }) => <div ref={setNodeRef} {...attributes} {...listeners} data-testid="row" />}
        </TaskDraggable>
      </DndContext>
    )
  }
  render(<Harness />)
  fireEvent.keyDown(screen.getByTestId('row'), { code: 'Space', key: ' ' })
  if (!active) throw new Error('the drag did not start')
  return active
}

describe('TaskDraggable — per-surface id', () => {
  it.each([
    { surface: 'calendar-widget' as const, scope: 't2', sectionKey: 'due', expectedId: 'cw|t2|due|42' },
    { surface: 'list-widget' as const, scope: 't1', sectionKey: 'all', expectedId: 'lw|t1|all|42' },
  ])('$surface emits id $expectedId', ({ surface, scope, sectionKey, expectedId }) => {
    expect(startDrag({ surface, scope, sectionKey, todoId: 42 }).id).toBe(expectedId)
  })

  it('throws when a list-widget row is missing its scope / section', () => {
    const todo = makeTodo({ id: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <DndContext>
          <TaskDraggable todo={todo} surface="list-widget">
            {() => <div />}
          </TaskDraggable>
        </DndContext>,
      ),
    ).toThrow(/scope/)
    spy.mockRestore()
  })
})

describe('TaskDraggable — drag payload', () => {
  it('carries `type: task`, the todo and the extra data', () => {
    const active = startDrag({ extraData: { listTabId: 't1', rowKey: 'status-5:9' } })
    expect(active.data.current).toMatchObject({ type: TASK_DRAG_KIND.task, listTabId: 't1', rowKey: 'status-5:9' })
    expect(active.data.current?.todo).toMatchObject({ id: 9 })
  })

  it('`type` and `todo` win over same-named extra data', () => {
    const active = startDrag({ extraData: { type: 'something-else', todo: { id: 1 } } })
    expect(active.data.current?.type).toBe(TASK_DRAG_KIND.task)
    expect(active.data.current?.todo).toMatchObject({ id: 9 })
  })
})
