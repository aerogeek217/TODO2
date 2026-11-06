// A purge of completed tasks has no undo step, so it leaves undo entries
// for tasks that are gone. Their undo / redo says so and drops the entry —
// it never "undoes" nothing silently (the next undo would then take back the
// step before it without the user seeing why), and never writes rows for a
// deleted task (cr31 stores L6).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { resetDb } from '../helpers'
import { addTask } from '../add-task'

beforeEach(async () => {
  await resetDb()
  useUndoStore.getState().clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const title = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)?.title

/** Purges `ids` (completed), as Settings' cleanup does. */
async function purge(ids: number[]) {
  expect(await useTodoStore.getState().purgeCompleted(ids)).toMatchObject({ status: 'done', deleted: ids.length })
}

describe('undo after a purge', () => {
  it('the completion of a purged task is dropped with a notice, and the next undo takes back the step before it', async () => {
    const kept = await addTask('Kept')
    const gone = await addTask('Gone')
    await useTodoStore.getState().update(kept, { title: 'Kept, renamed' })
    await useTodoStore.getState().toggleComplete(gone)
    await purge([gone])

    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'That task was deleted.', notice: true })
    expect(useUndoStore.getState().redoStack).toEqual([])
    expect(undoNames().at(-1)).toBe('Edit "Kept, renamed"')

    await useUndoStore.getState().undo()
    expect(title(kept)).toBe('Kept')
  })

  it('a field edit of a purged task is dropped too, and so is its create', async () => {
    const gone = await addTask('Gone')
    await useTodoStore.getState().update(gone, { title: 'Gone, renamed' })
    await useTodoStore.getState().toggleComplete(gone)
    await purge([gone])
    for (let i = 0; i < 3; i++) await useUndoStore.getState().undo()
    expect(useUndoStore.getState().undoStack).toEqual([])
    expect(useUndoStore.getState().redoStack).toEqual([])
    expect(await db.todos.count()).toBe(0)
  })

  it('undoing a people change of a purged task writes no join row for it', async () => {
    const gone = await addTask('Gone')
    const ann = await usePersonStore.getState().add('Ann', 'AN')
    await usePersonStore.getState().loadAssignments([gone])
    await usePersonStore.getState().assignPerson(gone, ann)
    await usePersonStore.getState().unassignPerson(gone, ann)
    await useTodoStore.getState().toggleComplete(gone)
    await purge([gone])
    await useUndoStore.getState().undo() // the completion
    await useUndoStore.getState().undo() // the unassign: would assign again
    expect(await db.todoPeople.count()).toBe(0)
    expect(useUndoStore.getState().snackbar?.description).toBe('That task was deleted.')
  })

  it('a status update or subtask added to a purged task is dropped on undo', async () => {
    const gone = await addTask('Gone')
    await useStatusUpdateStore.getState().add(gone, { date: new Date(), text: 'Called' })
    await useSubtaskStore.getState().add(gone, 'Step')
    await useTodoStore.getState().toggleComplete(gone)
    await purge([gone])
    for (let i = 0; i < 3; i++) await useUndoStore.getState().undo()
    expect(undoNames()).toEqual(['Add "Gone"'])
    expect(useUndoStore.getState().redoStack).toEqual([])
  })

  it('a bulk edit over a purged and a kept task still runs for the kept one', async () => {
    const kept = await addTask('Kept')
    const gone = await addTask('Gone')
    await useTodoStore.getState().bulkSetFocus([kept, gone], true)
    await useTodoStore.getState().toggleComplete(gone)
    await purge([gone])
    await useUndoStore.getState().undo() // the completion: dropped
    await useUndoStore.getState().undo() // the focus: undone for Kept
    expect(useTodoStore.getState().todos.find((t) => t.id === kept)?.focus).toBeUndefined()
    expect(useUndoStore.getState().redoStack.map((e) => e.description)).toEqual(['Add 2 tasks to Focus'])
  })
})
