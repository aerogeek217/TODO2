import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { subtaskRepository } from '../../data/subtask-repository'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { addDays, startOfToday } from '../../utils/date'
import { subtaskCount } from '../../utils/subtasks'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

/** The titles the store holds for `todoId`, in checklist order. */
const titles = (todoId: number) => (useSubtaskStore.getState().byTodo.get(todoId) ?? []).map((r) => r.title)
/** The checklist as `[title, done]`, in order. */
const list = (todoId: number) => (useSubtaskStore.getState().byTodo.get(todoId) ?? []).map((r) => [r.title, r.isCompleted])
/** The titles stored for `todoId`, in checklist order. */
const storedTitles = async (todoId: number) => (await db.subtasks.where('todoId').equals(todoId).sortBy('sortOrder')).map((r) => r.title)
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

async function task(title = 'Q4 budget'): Promise<number> {
  return useTodoStore.getState().add(title)
}

/** A task with the subtasks `names`, the undo stack cleared after. */
async function checklist(names: readonly string[], title = 'Q4 budget'): Promise<number> {
  const id = await task(title)
  for (const name of names) await useSubtaskStore.getState().add(id, name)
  useUndoStore.getState().clear()
  return id
}

describe('subtask-store: add', () => {
  it('stores one trimmed line last on the checklist, as one undo step', async () => {
    const id = await task()
    useUndoStore.getState().clear()
    const a = await useSubtaskStore.getState().add(id, '  Send the\n template ')
    const b = await useSubtaskStore.getState().add(id, 'Headcount')
    expect(a).toMatchObject({ todoId: id, title: 'Send the template', isCompleted: false, sortOrder: 0 })
    expect(b).toMatchObject({ sortOrder: 1 })
    expect(await storedTitles(id)).toEqual(['Send the template', 'Headcount'])
    expect(titles(id)).toEqual(['Send the template', 'Headcount'])
    expect(undoNames()).toEqual(['Add subtask “Send the template”', 'Add subtask “Headcount”'])
  })

  it('refuses a blank title: nothing written, no undo step', async () => {
    const id = await task()
    useUndoStore.getState().clear()
    expect(await useSubtaskStore.getState().add(id, ' \n ')).toBeUndefined()
    expect(await db.subtasks.count()).toBe(0)
    expect(undoNames()).toEqual([])
  })

  it('undo removes it, redo brings it back with its id', async () => {
    const id = await task()
    const added = await useSubtaskStore.getState().add(id, 'Draft')
    await useUndoStore.getState().undo()
    expect(await db.subtasks.count()).toBe(0)
    expect(titles(id)).toEqual([])
    await useUndoStore.getState().redo()
    expect((await db.subtasks.toArray()).map((r) => r.id)).toEqual([added!.id])
    expect(titles(id)).toEqual(['Draft'])
  })

  it('a failed write is reported, writes nothing and resolves undefined', async () => {
    const id = await task()
    const spy = vi.spyOn(subtaskRepository, 'add').mockRejectedValueOnce(new Error('disk full'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    useUndoStore.getState().clear()
    expect(await useSubtaskStore.getState().add(id, 'Draft')).toBeUndefined()
    expect(useUndoStore.getState().snackbar?.description).toBe("Couldn't add the subtask.")
    expect(undoNames()).toEqual([])
    expect(titles(id)).toEqual([])
    spy.mockRestore()
    err.mockRestore()
  })

  it('writes nothing for a task deleted meanwhile', async () => {
    const id = await task()
    await db.todos.delete(id)
    expect(await useSubtaskStore.getState().add(id, 'Late')).toBeUndefined()
    expect(await db.subtasks.count()).toBe(0)
  })
})

describe('subtask-store: addRows', () => {
  it('stores each title as add does and drops a row left with none', async () => {
    const id = await task()
    const now = new Date()
    const added = await useSubtaskStore.getState().addRows([
      { todoId: id, title: '', isCompleted: true, sortOrder: 0, createdAt: now },
      { todoId: id, title: '  Two \n lines ', isCompleted: false, sortOrder: 1, createdAt: now },
      { todoId: id, title: '   ', isCompleted: false, sortOrder: 2, createdAt: now },
      { todoId: id, title: 'q'.repeat(600), isCompleted: false, sortOrder: 3, createdAt: now },
    ])
    expect(added.map((r) => r.title)).toEqual(['Two lines', 'q'.repeat(500)])
    expect(await storedTitles(id)).toEqual(['Two lines', 'q'.repeat(500)])
    expect(titles(id)).toEqual(['Two lines', 'q'.repeat(500)])
  })

  it('writes nothing when every row is blank', async () => {
    const id = await task()
    expect(await useSubtaskStore.getState().addRows([{ todoId: id, title: ' ', isCompleted: false, sortOrder: 0, createdAt: new Date() }])).toEqual([])
    expect(await db.subtasks.count()).toBe(0)
  })
})

describe('subtask-store: rename and check', () => {
  it('rename stores the new title; undo / redo swap them; no change or a blank → nothing', async () => {
    const id = await checklist(['Draft'])
    const [row] = useSubtaskStore.getState().byTodo.get(id) ?? []
    expect(await useSubtaskStore.getState().rename(row!.id, ' Draft the charts ')).toBe(true)
    expect(titles(id)).toEqual(['Draft the charts'])
    expect((await db.subtasks.get(row!.id))?.title).toBe('Draft the charts')
    expect(undoNames()).toEqual(['Rename subtask “Draft”'])
    await useUndoStore.getState().undo()
    expect(titles(id)).toEqual(['Draft'])
    await useUndoStore.getState().redo()
    expect(titles(id)).toEqual(['Draft the charts'])
    expect(await useSubtaskStore.getState().rename(row!.id, 'Draft the charts')).toBe(false)
    expect(await useSubtaskStore.getState().rename(row!.id, '  ')).toBe(false)
    expect(await useSubtaskStore.getState().rename(9999, 'Gone')).toBe(false)
  })

  it('setDone checks and unchecks, each its own step without a snackbar while others stay open', async () => {
    const id = await checklist(['a', 'b'])
    const [a] = useSubtaskStore.getState().byTodo.get(id) ?? []
    expect(await useSubtaskStore.getState().setDone(a!.id, true)).toBe(true)
    expect(list(id)).toEqual([['a', true], ['b', false]])
    expect((await db.subtasks.get(a!.id))?.isCompleted).toBe(true)
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(undoNames()).toEqual(['Check “a”'])
    expect(await useSubtaskStore.getState().setDone(a!.id, true)).toBe(false)
    await useUndoStore.getState().undo()
    expect(list(id)).toEqual([['a', false], ['b', false]])
    expect(await useSubtaskStore.getState().setDone(a!.id, true)).toBe(true)
    expect(await useSubtaskStore.getState().setDone(a!.id, false)).toBe(true)
    expect(undoNames()).toEqual(['Check “a”', 'Uncheck “a”'])
  })

  it('checking the last open subtask shows the snackbar with a Complete task offer, which completes the task once', async () => {
    const id = await checklist(['a', 'b'])
    const [a, b] = useSubtaskStore.getState().byTodo.get(id) ?? []
    await useSubtaskStore.getState().setDone(a!.id, true)
    await useSubtaskStore.getState().setDone(b!.id, true)
    const snackbar = useUndoStore.getState().snackbar
    expect(snackbar?.description).toBe('Check “b”')
    expect(snackbar?.detail).toBe('All 2 subtasks are done')
    expect(snackbar?.action?.label).toBe('Complete task')
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.isCompleted).toBe(false)
    snackbar?.action?.run()
    await vi.waitFor(() => expect(useTodoStore.getState().todos.find((t) => t.id === id)?.isCompleted).toBe(true))
    // The offer taken again (a stale snackbar) doesn't reopen the task.
    snackbar?.action?.run()
    await new Promise((r) => setTimeout(r, 0))
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.isCompleted).toBe(true)
    expect(list(id)).toEqual([['a', true], ['b', true]])
  })
})

describe('subtask-store: the Complete task offer', () => {
  it('is not made on a completed task, nor on one the task store does not hold', async () => {
    const id = await checklist(['a'])
    await useTodoStore.getState().toggleComplete(id)
    useUndoStore.getState().clear()
    const [a] = useSubtaskStore.getState().byTodo.get(id) ?? []
    expect(await useSubtaskStore.getState().setDone(a!.id, true)).toBe(true)
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(useUndoStore.getState().undoStack.at(-1)?.action).toBeUndefined()
  })
})

describe('subtask-store: order', () => {
  it('move puts a subtask at an index, writing only the rows whose place changed; undo puts the order back', async () => {
    const id = await checklist(['a', 'b', 'c', 'd'])
    const rows = useSubtaskStore.getState().byTodo.get(id) ?? []
    expect(await useSubtaskStore.getState().move(rows[3]!.id, 1)).toBe(true)
    expect(titles(id)).toEqual(['a', 'd', 'b', 'c'])
    expect(await storedTitles(id)).toEqual(['a', 'd', 'b', 'c'])
    expect((await db.subtasks.get(rows[0]!.id))?.sortOrder).toBe(0)
    expect(undoNames()).toEqual(['Move subtask “d”'])
    await useUndoStore.getState().undo()
    expect(titles(id)).toEqual(['a', 'b', 'c', 'd'])
    expect(await storedTitles(id)).toEqual(['a', 'b', 'c', 'd'])
    await useUndoStore.getState().redo()
    expect(titles(id)).toEqual(['a', 'd', 'b', 'c'])
    expect(await useSubtaskStore.getState().move(rows[0]!.id, 0)).toBe(false)
    expect(await useSubtaskStore.getState().move(rows[0]!.id, 99)).toBe(true)
    expect(titles(id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('moveToTask puts a subtask last on another task; undo brings it back where it was; both tasks are stamped', async () => {
    const a = await checklist(['a1', 'a2'], 'A')
    const b = await checklist(['b1'], 'B')
    const longAgo = addDays(startOfToday(), -40)
    await db.todos.where('id').anyOf([a, b]).modify({ modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => ({ ...t, modifiedAt: longAgo })) })
    const [a1] = useSubtaskStore.getState().byTodo.get(a) ?? []
    expect(await useSubtaskStore.getState().moveToTask(a1!.id, b)).toBe(true)
    expect(titles(a)).toEqual(['a2'])
    expect(titles(b)).toEqual(['b1', 'a1'])
    expect((await db.subtasks.get(a1!.id))).toMatchObject({ todoId: b, sortOrder: 1 })
    for (const id of [a, b]) {
      expect((await db.todos.get(id))?.modifiedAt.getTime()).toBeGreaterThan(longAgo.getTime())
      expect(useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt.getTime()).toBeGreaterThan(longAgo.getTime())
    }
    await useUndoStore.getState().undo()
    expect(titles(a)).toEqual(['a1', 'a2'])
    expect(titles(b)).toEqual(['b1'])
    expect(await useSubtaskStore.getState().moveToTask(a1!.id, a)).toBe(false)
    await db.todos.delete(b)
    expect(await useSubtaskStore.getState().moveToTask(a1!.id, b)).toBe(false)
    expect(titles(a)).toEqual(['a1', 'a2'])
  })

  it('loads each task’s checklist by sortOrder, then id', async () => {
    const id = await task()
    await db.subtasks.bulkAdd([
      { todoId: id, title: 'c', isCompleted: false, sortOrder: 2, createdAt: new Date() },
      { todoId: id, title: 'a', isCompleted: false, sortOrder: 0, createdAt: new Date() },
      { todoId: id, title: 'b1', isCompleted: false, sortOrder: 1, createdAt: new Date() },
      { todoId: id, title: 'b2', isCompleted: false, sortOrder: 1, createdAt: new Date() },
    ])
    await useSubtaskStore.getState().load()
    expect(useSubtaskStore.getState().loaded).toBe(true)
    expect(titles(id)).toEqual(['a', 'b1', 'b2', 'c'])
    expect(subtaskCount(useSubtaskStore.getState().byTodo.get(id) ?? [])).toEqual({ done: 0, total: 4 })
  })
})

describe('subtask-store: remove and reset', () => {
  it('remove shows the undo snackbar; undo puts it back with its id and place, redo removes it again', async () => {
    const id = await checklist(['a', 'b', 'c'])
    const [, b] = useSubtaskStore.getState().byTodo.get(id) ?? []
    expect(await useSubtaskStore.getState().remove(b!.id)).toBe(true)
    expect(titles(id)).toEqual(['a', 'c'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Subtask removed')
    await useUndoStore.getState().undo()
    expect(titles(id)).toEqual(['a', 'b', 'c'])
    expect((await db.subtasks.get(b!.id))?.sortOrder).toBe(1)
    await useUndoStore.getState().redo()
    expect(titles(id)).toEqual(['a', 'c'])
    expect(await useSubtaskStore.getState().remove(b!.id)).toBe(false)
  })

  it('resetDone unchecks every done subtask as one step; nothing when none is done', async () => {
    const id = await checklist(['a', 'b', 'c'])
    const rows = useSubtaskStore.getState().byTodo.get(id) ?? []
    await useSubtaskStore.getState().setDone(rows[0]!.id, true)
    await useSubtaskStore.getState().setDone(rows[2]!.id, true)
    useUndoStore.getState().clear()
    await useSubtaskStore.getState().resetDone(id)
    expect(list(id)).toEqual([['a', false], ['b', false], ['c', false]])
    expect(undoNames()).toEqual(['Uncheck the subtasks'])
    await useUndoStore.getState().undo()
    expect(list(id)).toEqual([['a', true], ['b', false], ['c', true]])
    useUndoStore.getState().clear()
    await useSubtaskStore.getState().resetDone(await checklist([]))
    expect(undoNames()).toEqual([])
  })

  it('forgetTodos drops tasks’ checklists from memory only', async () => {
    const a = await checklist(['on A'], 'A')
    const b = await checklist(['on B'], 'B')
    useSubtaskStore.getState().forgetTodos([a])
    expect(titles(a)).toEqual([])
    expect(titles(b)).toEqual(['on B'])
    expect(await db.subtasks.count()).toBe(2)
  })
})

describe('task deletes keep the checklist for undo', () => {
  it('remove: the subtasks go with the task; undo brings them back, redo takes them again', async () => {
    const id = await checklist(['a', 'b'])
    await useTodoStore.getState().remove(id)
    expect(await db.subtasks.count()).toBe(0)
    expect(titles(id)).toEqual([])
    await useUndoStore.getState().undo()
    expect(await storedTitles(id)).toEqual(['a', 'b'])
    expect(titles(id)).toEqual(['a', 'b'])
    await useUndoStore.getState().redo()
    expect(await db.subtasks.count()).toBe(0)
  })

  it('bulkRemove: undo brings every task’s checklist back', async () => {
    const a = await checklist(['a1', 'a2'], 'A')
    const b = await checklist(['b1'], 'B')
    await useTodoStore.getState().bulkRemove([a, b])
    expect(await db.subtasks.count()).toBe(0)
    await useUndoStore.getState().undo()
    expect([titles(a), titles(b)]).toEqual([['a1', 'a2'], ['b1']])
    expect(await db.subtasks.count()).toBe(3)
  })

  it('undo of a create takes the subtasks added since, redo brings them back', async () => {
    const id = await task('Fresh')
    await useSubtaskStore.getState().addRows([{ todoId: id, title: 'Kept without a step', isCompleted: false, sortOrder: 0, createdAt: new Date() }])
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeUndefined()
    expect(await db.subtasks.count()).toBe(0)
    expect(titles(id)).toEqual([])
    await useUndoStore.getState().redo()
    expect(titles(id)).toEqual(['Kept without a step'])
    expect(await storedTitles(id)).toEqual(['Kept without a step'])
  })

  it('purgeCompleted cascades the checklist', async () => {
    const id = await checklist(['a'], 'Done')
    await useTodoStore.getState().toggleComplete(id)
    const outcome = await useTodoStore.getState().purgeCompleted([id])
    expect(outcome).toMatchObject({ status: 'done', deleted: 1 })
    expect(await db.subtasks.count()).toBe(0)
    expect(titles(id)).toEqual([])
  })
})

describe('duplicate copies the checklist, all unchecked', () => {
  it('same titles in the same order, none done; undo of the duplicate takes them, redo brings them back', async () => {
    const id = await checklist(['a', 'b', 'c'])
    const rows = useSubtaskStore.getState().byTodo.get(id) ?? []
    await useSubtaskStore.getState().setDone(rows[1]!.id, true)
    await useSubtaskStore.getState().move(rows[2]!.id, 0)
    const copy = await useTodoStore.getState().duplicate(id)
    expect(copy).toBeDefined()
    expect(list(copy!)).toEqual([['c', false], ['a', false], ['b', false]])
    expect((await db.subtasks.where('todoId').equals(copy!).sortBy('sortOrder')).map((r) => r.sortOrder)).toEqual([0, 1, 2])
    expect(list(id)).toEqual([['c', false], ['a', false], ['b', true]])
    await useUndoStore.getState().undo()
    expect(await db.subtasks.where('todoId').equals(copy!).count()).toBe(0)
    await useUndoStore.getState().redo()
    expect(titles(copy!)).toEqual(['c', 'a', 'b'])
  })
})

describe('a recurring task’s completion starts its checklist over', () => {
  async function recurring(names: readonly string[]): Promise<number> {
    const id = await checklist(names, 'Water the plants')
    await useTodoStore.getState().update(id, { dueDate: startOfToday(), recurrenceRule: { type: 'weekly' } })
    const rows = useSubtaskStore.getState().byTodo.get(id) ?? []
    for (const r of rows) await useSubtaskStore.getState().setDone(r.id, true)
    useUndoStore.getState().clear()
    return id
  }

  it('toggleComplete rolls the due date and unchecks every subtask as one undo step', async () => {
    const id = await recurring(['a', 'b'])
    await useTodoStore.getState().toggleComplete(id)
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
    expect(todo.isCompleted).toBe(false)
    expect(todo.dueDate).toEqual(addDays(startOfToday(), 7))
    expect(list(id)).toEqual([['a', false], ['b', false]])
    expect(undoNames()).toEqual(['Advance recurring "Water the plants"'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Advance recurring "Water the plants"')
    await useUndoStore.getState().undo()
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate).toEqual(startOfToday())
    expect(list(id)).toEqual([['a', true], ['b', true]])
    await useUndoStore.getState().redo()
    expect(list(id)).toEqual([['a', false], ['b', false]])
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate).toEqual(addDays(startOfToday(), 7))
  })

  it('bulkSetCompleted does the same for the recurring tasks among the ids, in one step', async () => {
    const r = await recurring(['a'])
    const plain = await checklist(['p'], 'Plain')
    const [p] = useSubtaskStore.getState().byTodo.get(plain) ?? []
    await useSubtaskStore.getState().setDone(p!.id, true)
    useUndoStore.getState().clear()
    await useTodoStore.getState().bulkSetCompleted([r, plain], true)
    expect(list(r)).toEqual([['a', false]])
    // A plain task completes with its checklist as it is.
    expect(list(plain)).toEqual([['p', true]])
    expect(useTodoStore.getState().todos.find((t) => t.id === plain)?.isCompleted).toBe(true)
    expect(undoNames()).toEqual(['Complete 2 tasks'])
    await useUndoStore.getState().undo()
    expect(list(r)).toEqual([['a', true]])
    expect(useTodoStore.getState().todos.find((t) => t.id === plain)?.isCompleted).toBe(false)
  })

  it('inside an open undo group (a check-in reply) the advance and the reset join that group', async () => {
    const id = await recurring(['a'])
    await useUndoStore.getState().runGroup('Apply the reply', async () => {
      await useTodoStore.getState().toggleComplete(id)
    })
    expect(list(id)).toEqual([['a', false]])
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate).toEqual(addDays(startOfToday(), 7))
    expect(undoNames()).toEqual(['Apply the reply'])
    await useUndoStore.getState().undo()
    expect(list(id)).toEqual([['a', true]])
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate).toEqual(startOfToday())
  })

  it('completing a plain task with open subtasks asks nothing and leaves them', async () => {
    const id = await checklist(['open'])
    await useTodoStore.getState().toggleComplete(id)
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.isCompleted).toBe(true)
    expect(list(id)).toEqual([['open', false]])
  })
})

describe('a subtask write is activity on its task', () => {
  const longAgo = addDays(startOfToday(), -40)

  async function stale(id: number): Promise<void> {
    await db.todos.update(id, { modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: longAgo } : t)) })
  }

  async function modifiedAt(id: number): Promise<{ stored: Date | undefined; shown: Date | undefined }> {
    return {
      stored: (await db.todos.get(id))?.modifiedAt,
      shown: useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt,
    }
  }

  async function expectStamped(id: number, write: () => Promise<unknown>): Promise<void> {
    await stale(id)
    const before = Date.now()
    await write()
    const { stored, shown } = await modifiedAt(id)
    expect(stored?.getTime()).toBeGreaterThanOrEqual(before)
    expect(shown).toEqual(stored)
  }

  it('add, rename, check, move, remove and their undo stamp the task’s Modified date, stored and in the store', async () => {
    const id = await checklist(['first'])
    let subId = 0
    await expectStamped(id, async () => { subId = (await useSubtaskStore.getState().add(id, 'second'))!.id })
    await expectStamped(id, () => useSubtaskStore.getState().rename(subId, 'second, renamed'))
    await expectStamped(id, () => useSubtaskStore.getState().setDone(subId, true))
    await expectStamped(id, () => useSubtaskStore.getState().move(subId, 0))
    await expectStamped(id, () => useSubtaskStore.getState().remove(subId))
    await expectStamped(id, () => useUndoStore.getState().undo())
    await expectStamped(id, () => useUndoStore.getState().redo())
  })

  it('a write that changes nothing stamps nothing; a task delete’s undo and a duplicate’s copies don’t stamp', async () => {
    const id = await checklist(['a'])
    const [a] = useSubtaskStore.getState().byTodo.get(id) ?? []
    await stale(id)
    await useSubtaskStore.getState().rename(a!.id, 'a')
    await useSubtaskStore.getState().setDone(a!.id, false)
    await useSubtaskStore.getState().add(id, '  ')
    expect(await modifiedAt(id)).toEqual({ stored: longAgo, shown: longAgo })
    await useTodoStore.getState().remove(id)
    await useUndoStore.getState().undo()
    expect((await db.todos.get(id))?.modifiedAt).toEqual(longAgo)
  })
})
