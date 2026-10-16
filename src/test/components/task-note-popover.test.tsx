import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { db } from '../../data/database'
import { TaskNotePopover } from '../../components/task/TaskNotePopover'
import { useTodoStore } from '../../stores/todo-store'
import { useNoteStore } from '../../stores/note-store'
import { makeTodo } from '../helpers'
import { EditorView } from '@codemirror/view'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useTodoStore.setState({ todos: [] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function seedTodo(notes?: string) {
  const todo = makeTodo({ id: 100, title: 'Task with notes', notes })
  useTodoStore.setState({ todos: [todo] })
  return todo
}

describe('TaskNotePopover', () => {
  it('renders the NotesBody editor seeded from the todo', async () => {
    seedTodo('HELLO NOTES')
    const anchor = createRef<HTMLButtonElement>()
    render(
      <>
        <button ref={anchor}>anchor</button>
        <TaskNotePopover todoId={100} anchorRef={anchor} onClose={() => {}} />
      </>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    const container = document.querySelector('.cm-content')
    expect(container).toBeTruthy()
    expect(container!.textContent).toContain('HELLO NOTES')
  })

  it('closes on Escape', async () => {
    seedTodo('x')
    const anchor = createRef<HTMLButtonElement>()
    const onClose = vi.fn()
    render(
      <>
        <button ref={anchor}>anchor</button>
        <TaskNotePopover todoId={100} anchorRef={anchor} onClose={onClose} />
      </>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a mousedown outside, but not on the notes icon (its toggle)', async () => {
    seedTodo('x')
    const anchor = createRef<HTMLButtonElement>()
    const onClose = vi.fn()
    render(
      <>
        <button ref={anchor}>anchor</button>
        <div data-testid="elsewhere">elsewhere</div>
        <TaskNotePopover todoId={100} anchorRef={anchor} onClose={onClose} />
      </>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.mouseDown(anchor.current!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.querySelector('[data-testid="elsewhere"]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('persists edits to the todo-store through the source adapter', async () => {
    seedTodo('')
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    const anchor = createRef<HTMLButtonElement>()
    render(
      <>
        <button ref={anchor}>anchor</button>
        <TaskNotePopover todoId={100} anchorRef={anchor} onClose={() => {}} />
      </>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    // CodeMirror's contenteditable doesn't take React's input events: type
    // through the editor's own view.
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)
    if (!view) throw new Error('no editor')
    act(() => view.dispatch({ changes: { from: 0, insert: 'X' } }))
    expect(updateSpy).toHaveBeenLastCalledWith(100, { notes: 'X' })

    // Clearing the text clears the notes field.
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length } }))
    expect(updateSpy).toHaveBeenLastCalledWith(100, { notes: undefined })
  })
})
