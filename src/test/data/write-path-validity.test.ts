import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/database'
import { SUBTASK_TITLE_MAX } from '../../models/subtask'
import { STATUS_UPDATE_TEXT_MAX } from '../../models/status-update'
import { applyCheckinUpdates } from '../../services/checkin-reply/apply'
import { buildJsonExport, exportImportProblem } from '../../services/data-files'
import { addSubtasksFromNote, noteSubtaskDrafts } from '../../services/note-subtasks'
import { convertCandidates } from '../../services/note-lines'
import { createTasksFromDrafts } from '../../services/note-tasks'
import type { TaskDraft } from '../../services/task-draft'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

/**
 * Every path that writes subtask or status-update rows writes rows import
 * accepts: after it, a full export imports back (cr31 data H1 / S3-1(b)).
 * One bad row would make every export, backup and the sync file unimportable.
 */

const LONG = 'x'.repeat(SUBTASK_TITLE_MAX + 100)
const LONG_TEXT = 'y'.repeat(STATUS_UPDATE_TEXT_MAX + 100)

const base: TaskDraft = {
  title: 'T', urgent: false, important: false, focus: false,
  personIds: [], newPeople: [], tagIds: [], newTags: [],
}

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

async function exportProblem(): Promise<string | null> {
  return exportImportProblem(await buildJsonExport())
}

describe('every subtask / status-update write path stores rows import accepts', () => {
  it('a note converted to tasks: an empty done box and a long line under a bullet', async () => {
    const lines = convertCandidates(`- Plan trip\n  - [x]\n  - ${LONG}\n  - Book`, null)
    const drafts: TaskDraft[] = lines.map((line) => ({
      ...base,
      title: line.body,
      subtasks: (line.subtasks ?? []).map((s) => ({ title: s.title, isCompleted: s.done })),
    }))
    await createTasksFromDrafts(drafts, { description: 'Created tasks' })
    const titles = (await db.subtasks.toArray()).map((s) => s.title)
    expect(titles).toEqual(['x'.repeat(SUBTASK_TITLE_MAX), 'Book'])
    expect(await exportProblem()).toBeNull()
  })

  it('a new task whose drafts were not normalised (the editor’s create mode)', async () => {
    await createTasksFromDrafts([{
      ...base,
      subtasks: [{ title: '', isCompleted: true }, { title: '   ', isCompleted: false }, { title: LONG, isCompleted: false }],
      statusUpdates: [
        { date: new Date(), text: '', createdAt: new Date() },
        { date: new Date(), text: LONG_TEXT, createdAt: new Date() },
      ],
    }], { description: 'Created task' })
    expect((await db.subtasks.toArray()).map((s) => s.title.length)).toEqual([SUBTASK_TITLE_MAX])
    expect((await db.statusUpdates.toArray()).map((u) => u.text.length)).toEqual([STATUS_UPDATE_TEXT_MAX])
    expect(await exportProblem()).toBeNull()
  })

  it('a duplicate of a task holding rows stored before the titles were checked', async () => {
    const id = await useTodoStore.getState().add('Source')
    await db.subtasks.bulkAdd([
      { todoId: id, title: '', isCompleted: true, sortOrder: 0, createdAt: new Date() },
      { todoId: id, title: LONG, isCompleted: false, sortOrder: 1, createdAt: new Date() },
    ])
    await db.statusUpdates.add({ todoId: id, date: new Date(), text: LONG_TEXT, createdAt: new Date() })
    const copy = await useTodoStore.getState().duplicate(id)
    if (copy === undefined) throw new Error('no copy')
    expect((await db.subtasks.where('todoId').equals(copy).toArray()).map((s) => s.title.length)).toEqual([SUBTASK_TITLE_MAX])
    expect((await db.statusUpdates.where('todoId').equals(copy).toArray()).map((u) => u.text.length)).toEqual([STATUS_UPDATE_TEXT_MAX])
    // Only the copy is clean; the source rows were planted past the store.
    await db.subtasks.where('todoId').equals(id).delete()
    await db.statusUpdates.where('todoId').equals(id).delete()
    expect(await exportProblem()).toBeNull()
  })

  it('a task’s own notes converted to its subtasks', async () => {
    const id = await useTodoStore.getState().add('Offsite')
    const drafts = noteSubtaskDrafts(convertCandidates(`- Venue\n  - [x]\n  - ${LONG}`, null))
    expect(await addSubtasksFromNote(id, drafts, async () => {})).toBe(true)
    expect((await db.subtasks.toArray()).map((s) => s.title.length)).toEqual([5, SUBTASK_TITLE_MAX])
    expect(await exportProblem()).toBeNull()
  })

  it('a check-in reply’s status update', async () => {
    const id = await useTodoStore.getState().add('Report')
    await applyCheckinUpdates(
      [{ todoId: id, complete: false, statusUpdate: LONG_TEXT, changeCount: 1 }],
      { recordFollowup: false, personName: 'Ann' },
    )
    expect((await db.statusUpdates.toArray()).map((u) => u.text.length)).toEqual([STATUS_UPDATE_TEXT_MAX])
    expect(await exportProblem()).toBeNull()
  })
})
