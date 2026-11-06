import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/database'
import { addSubtasksFromNote, noteSubtaskDrafts } from '../../services/note-subtasks'
import { convertCandidates, singleLineCandidateAt } from '../../services/note-lines'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

describe('noteSubtaskDrafts', () => {
  it('flattens a line and the list lines under it, in note order, titles unparsed', () => {
    const lines = convertCandidates('- Venue @Ben #ops\n  - Call\n  - [x] Date\n- Invites', null)
    expect(noteSubtaskDrafts(lines)).toEqual([
      { title: 'Venue @Ben #ops', done: false },
      { title: 'Call', done: false },
      { title: 'Date', done: true },
      { title: 'Invites', done: false },
    ])
  })

  it('titles are as stored: a line with none makes no subtask, the rest convert; a long one is cut', () => {
    const long = 'z'.repeat(600)
    const lines = convertCandidates(`- Venue\n  - [x]\n  - ${long}\n  - Call`, null)
    expect(noteSubtaskDrafts(lines)).toEqual([
      { title: 'Venue', done: false },
      { title: 'z'.repeat(500), done: false },
      { title: 'Call', done: false },
    ])
  })

  it('a single done box is a done subtask', () => {
    const line = singleLineCandidateAt('- [x] Finished', 1)
    if (!line) throw new Error('no line')
    expect(noteSubtaskDrafts([line])).toEqual([{ title: 'Finished', done: true }])
  })
})

describe('addSubtasksFromNote', () => {
  it('adds last on the checklist, then writes the note, as one undo step', async () => {
    const id = await addTask('Offsite')
    await useSubtaskStore.getState().add(id, 'Existing')
    useUndoStore.getState().clear()
    const seen: string[][] = []
    const ok = await addSubtasksFromNote(id, [{ title: 'One', done: false }, { title: 'Two', done: true }], async () => {
      seen.push((useSubtaskStore.getState().byTodo.get(id) ?? []).map((s) => s.title))
    })
    expect(ok).toBe(true)
    expect(seen).toEqual([['Existing', 'One', 'Two']])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Added 2 subtasks'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Added 2 subtasks')
    await useUndoStore.getState().undo()
    expect(await db.subtasks.where('todoId').equals(id).count()).toBe(1)
  })

  it('names a single subtask', async () => {
    const id = await addTask('Offsite')
    useUndoStore.getState().clear()
    await addSubtasksFromNote(id, [{ title: 'One', done: false }], async () => {})
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Added subtask “One”'])
  })

  it('a draft with no title is skipped, not a failure: the rest go in and the note is written', async () => {
    const id = await addTask('Offsite')
    useUndoStore.getState().clear()
    const writeNote = vi.fn(async () => {})
    const ok = await addSubtasksFromNote(id, [{ title: 'One', done: false }, { title: '  ', done: true }, { title: 'Two', done: false }], writeNote)
    expect(ok).toBe(true)
    expect(writeNote).toHaveBeenCalledOnce()
    expect((await db.subtasks.where('todoId').equals(id).sortBy('sortOrder')).map((s) => s.title)).toEqual(['One', 'Two'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Added 2 subtasks'])
  })

  it('drafts with no title at all add nothing and leave the note alone', async () => {
    const id = await addTask('Offsite')
    useUndoStore.getState().clear()
    const writeNote = vi.fn(async () => {})
    expect(await addSubtasksFromNote(id, [{ title: '', done: true }], writeNote)).toBe(false)
    expect(writeNote).not.toHaveBeenCalled()
    expect(useUndoStore.getState().undoStack).toEqual([])
  })

  it('a failed write takes back what went in, leaves the note alone and leaves no step', async () => {
    const id = await addTask('Offsite')
    useUndoStore.getState().clear()
    const realAdd = useSubtaskStore.getState().add
    let calls = 0
    useSubtaskStore.setState({
      add: (...args) => {
        calls += 1
        return calls === 2 ? Promise.resolve(undefined) : realAdd(...args)
      },
    })
    const writeNote = vi.fn(async () => {})
    const ok = await addSubtasksFromNote(id, [{ title: 'One', done: false }, { title: 'Two', done: false }], writeNote)
    expect(ok).toBe(false)
    expect(writeNote).not.toHaveBeenCalled()
    expect(await db.subtasks.where('todoId').equals(id).count()).toBe(0)
    expect(useUndoStore.getState().undoStack).toEqual([])
  })
})
