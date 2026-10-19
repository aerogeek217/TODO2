import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useUIStore } from '../../stores/ui-store'
import { defaultPaneFilter, paneWrites, withPaneSeed } from '../../utils/eisenhower-panes'
import { dragTasks } from '../../components/workspace/eisenhower/eisenhower-drag'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.setState(useUndoStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!

describe('setMarkerFlags', () => {
  it('writes per-task flag changes as one undo step with the snackbar', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    await useTodoStore.getState().bulkSetImportant([a], true)

    await useTodoStore.getState().setMarkerFlags(
      [{ todoId: a, urgent: true, important: false }, { todoId: b, urgent: true }],
      'Marked urgent · 2 tasks',
    )
    expect(mem(a)).toMatchObject({ urgent: true })
    expect(mem(a).important).toBeUndefined()
    expect('important' in (await db.todos.get(a))!).toBe(false)
    expect((await db.todos.get(b))!.urgent).toBe(true)
    expect(useUndoStore.getState().snackbar?.description).toBe('Marked urgent · 2 tasks')

    await useUndoStore.getState().undo()
    expect(mem(a).important).toBe(true)
    expect(mem(a).urgent).toBeUndefined()
    expect((await db.todos.get(a))!.important).toBe(true)
    expect('urgent' in (await db.todos.get(b))!).toBe(false)

    await useUndoStore.getState().redo()
    expect(mem(b).urgent).toBe(true)
    expect(mem(a).important).toBeUndefined()
  })

  it('does nothing for tasks that are gone', async () => {
    await useTodoStore.getState().setMarkerFlags([{ todoId: 999, urgent: true }], 'x')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})

describe('withPaneSeed on the default panes', () => {
  const base = { personIds: [1], tagIds: [2], statusId: 3 }
  const seed = (q: Parameters<typeof defaultPaneFilter>[0]) => paneWrites(defaultPaneFilter(q), { people: [], tags: [], statuses: [] })
  it('replaces Urgent / Important, keeps Focus and the rest', () => {
    expect(withPaneSeed({ ...base, markers: { urgent: true, focus: true } }, seed('schedule')))
      .toEqual({ ...base, markers: { focus: true, important: true } })
    expect(withPaneSeed({ ...base, markers: { urgent: true } }, seed('drop'))).toEqual(base)
    expect(withPaneSeed(base, seed('do'))).toEqual({ ...base, markers: { urgent: true, important: true } })
  })

  it('keeps a Focus No and drops an Urgent / Important No (the pane decides those)', () => {
    expect(withPaneSeed({ ...base, markers: { focus: false, important: false } }, seed('delegate')))
      .toEqual({ ...base, markers: { focus: false, urgent: true } })
  })
})

describe('dragTasks', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'fresh' }), makeTodo({ id: 2 }), makeTodo({ id: 3 })] })
  })

  it('the dragged task, as the store has it now', () => {
    expect(dragTasks({ todo: makeTodo({ id: 1, title: 'stale' }) }).map((t) => t.title)).toEqual(['fresh'])
    expect(dragTasks({})).toEqual([])
  })

  it('the selection, when the dragged row is one of several selected in its widget', () => {
    useUIStore.setState({ selectionScope: 'w1', selectedTodoIds: new Set([1, 3]) })
    expect(dragTasks({ todo: makeTodo({ id: 3 }), listTabId: 'w1' }).map((t) => t.id)).toEqual([1, 3])
    // Another widget's row, or a row outside the selection: just that task.
    expect(dragTasks({ todo: makeTodo({ id: 3 }), listTabId: 'w2' }).map((t) => t.id)).toEqual([3])
    expect(dragTasks({ todo: makeTodo({ id: 2 }), listTabId: 'w1' }).map((t) => t.id)).toEqual([2])
  })
})
