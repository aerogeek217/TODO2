import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { NotesBody } from '../../../components/task/notes/NotesBody'
import { useTaskNotesSource } from '../../../components/task/notes/use-task-notes-source'
import { addSubtasksFromNote, type NoteSubtaskTarget } from '../../../services/note-subtasks'
import { useSettingsStore } from '../../../stores/settings-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUndoStore } from '../../../stores/undo-store'
import { resetDb } from '../../helpers'
import { resetStores } from '../../store-tracking'
import { addTask } from '../../add-task'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

afterEach(cleanup)

/** A stored task's notes, as the task editor and the notes popover host them. */
function Harness({ todoId }: { todoId: number }) {
  const notes = useTaskNotesSource({ todoId })
  const target = useCallback<NoteSubtaskTarget>((drafts, writeNote) => addSubtasksFromNote(todoId, drafts, writeNote), [todoId])
  return <NotesBody source={notes.source} subtaskTarget={target} />
}

async function setup(note: string) {
  const id = await addTask('Offsite')
  await useTodoStore.getState().update(id, { notes: note })
  useUndoStore.getState().clear()
  const utils = render(<Harness todoId={id} />)
  const view = EditorView.findFromDOM(utils.container.querySelector('.cm-editor') as HTMLElement)
  if (!view) throw new Error('no editor')
  return { id, view, doc: () => view.state.doc.toString() }
}

const checklist = (id: number) => (useSubtaskStore.getState().byTodo.get(id) ?? []).map((s) => [s.title, s.isCompleted])
const storedNotes = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)?.notes

const NOTE = ['# Plan', '- Book the venue @Ben', '  - Call them', '  - [x] Pick a date', 'A thought', '- [ ] Send invites', '- [x] Already done'].join('\n')

describe('a task’s notes convert to subtasks', () => {
  it('names subtasks on the toolbar and the hover icon', async () => {
    await setup(NOTE)
    expect(screen.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ })).toBeTruthy()
    expect(document.querySelector('.cm-line-convert')?.getAttribute('aria-label')).toBe('Convert this line to a subtask')
  })

  it('the toolbar’s Convert makes them at once, plain titles in note order, children side by side; the lines turn ✓', async () => {
    const { id, doc } = await setup(NOTE)
    fireEvent.click(screen.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ }))
    await waitFor(() => expect(storedNotes(id)).toBe(['# Plan', '✓ Book the venue @Ben', 'A thought', '✓ Send invites', '- [x] Already done'].join('\n')))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(checklist(id)).toEqual([
      ['Book the venue @Ben', false],
      ['Call them', false],
      ['Pick a date', true],
      ['Send invites', false],
    ])
    expect(useTodoStore.getState().todos.map((t) => t.title)).toEqual(['Offsite'])
    expect(doc()).toBe(storedNotes(id))
  })

  it('takes only the selection’s lines', async () => {
    const { id, view } = await setup(NOTE)
    const line = view.state.doc.line(6)
    act(() => { view.dispatch({ selection: EditorSelection.range(line.from, line.to) }) })
    fireEvent.click(await screen.findByRole('button', { name: /^Convert 1 selected line to subtasks/ }))
    await waitFor(() => expect(checklist(id)).toEqual([['Send invites', false]]))
  })

  it('is one undo step with the note, Undo and Redo taking both', async () => {
    const { id, doc } = await setup(NOTE)
    fireEvent.click(screen.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ }))
    await waitFor(() => expect(storedNotes(id)).toContain('✓ Send invites'))
    await waitFor(() => expect(useUndoStore.getState().snackbar?.description).toBe('Added 4 subtasks'))
    expect(useUndoStore.getState().undoStack).toHaveLength(1)

    await act(async () => { await useUndoStore.getState().undo() })
    expect(checklist(id)).toEqual([])
    expect(storedNotes(id)).toBe(NOTE)
    await waitFor(() => expect(doc()).toBe(NOTE))

    await act(async () => { await useUndoStore.getState().redo() })
    expect(checklist(id)).toHaveLength(4)
    expect(storedNotes(id)).toContain('✓ Send invites')
  })

  it('what was typed before the convert is its own edit, kept by the Undo', async () => {
    const { id, view } = await setup('- One')
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '\nTyped' } }) })
    fireEvent.click(screen.getByRole('button', { name: /^Convert 1 bullet line to subtasks/ }))
    await waitFor(() => expect(storedNotes(id)).toBe('✓ One\nTyped'))
    await waitFor(() => expect(useUndoStore.getState().snackbar?.description).toBe('Added subtask “One”'))
    expect(useUndoStore.getState().undoStack).toHaveLength(2)
    await act(async () => { await useUndoStore.getState().undo() })
    expect(storedNotes(id)).toBe('- One\nTyped')
    expect(checklist(id)).toEqual([])
  })

  it('Alt+T takes the caret’s line, list line or not, a done box a done subtask', async () => {
    const { id, view } = await setup('A thought\n- [x] Finished')
    act(() => { view.dispatch({ selection: { anchor: view.state.doc.line(1).from } }) })
    fireEvent.keyDown(view.contentDOM, { key: 't', code: 'KeyT', altKey: true })
    await waitFor(() => expect(checklist(id)).toEqual([['A thought', false]]))
    await waitFor(() => expect(storedNotes(id)).toBe('✓ A thought\n- [x] Finished'))
    expect(screen.queryByRole('dialog')).toBeNull()
    // A press is dropped while the last convert settles (it would convert the same line twice).
    await waitFor(() => expect(useUndoStore.getState().groupToken).toBeNull())
    // The group closes synchronously (`endGroup`); all that is left of the
    // convert is promise continuations, so one macrotask has run them all.
    await act(async () => { await new Promise((r) => setTimeout(r)) })

    act(() => { view.dispatch({ selection: { anchor: view.state.doc.line(2).from } }) })
    fireEvent.keyDown(view.contentDOM, { key: 't', code: 'KeyT', altKey: true })
    await waitFor(() => expect(checklist(id)).toEqual([['A thought', false], ['Finished', true]]))
  })

  it('with Remove note lines after converting, the lines and their children go', async () => {
    useSettingsStore.setState({ removeConvertedLines: true })
    const { id } = await setup(NOTE)
    fireEvent.click(screen.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ }))
    await waitFor(() => expect(storedNotes(id)).toBe(['# Plan', 'A thought', '- [x] Already done'].join('\n')))
    expect(checklist(id)).toHaveLength(4)
  })
})
