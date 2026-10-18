import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef, useRef, useState } from 'react'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { db } from '../../data/database'
import { TaskNotePopover } from '../../components/task/TaskNotePopover'
import { useTodoStore } from '../../stores/todo-store'
import { useNoteStore } from '../../stores/note-store'
import { useUndoStore } from '../../stores/undo-store'
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

describe('TaskNotePopover: Progress', () => {
  function seed(progress?: string, notes?: string) {
    useTodoStore.setState({ todos: [makeTodo({ id: 100, title: 'Task', progress, notes })] })
  }

  /** The popover over its trigger, closed by its own onClose (as the row does). */
  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null)
    const [open, setOpen] = useState(true)
    return (
      <>
        <button ref={anchor} onClick={() => setOpen((v) => !v)}>cell</button>
        <div data-testid="elsewhere">elsewhere</div>
        {open && <TaskNotePopover todoId={100} anchorRef={anchor} onClose={() => setOpen(false)} />}
      </>
    )
  }

  async function renderHarness() {
    render(<Harness />)
    await act(async () => { await Promise.resolve() })
  }

  const progressField = () => screen.getByRole('textbox', { name: 'Progress' })
  const dialog = () => screen.queryByRole('dialog', { name: 'Progress and notes' })

  it('is one dialog with the Progress field (seeded, focused) above the notes', async () => {
    seed('50% done', 'Some notes')
    await renderHarness()
    expect(dialog()).toBeInTheDocument()
    expect(progressField()).toHaveValue('50% done')
    expect(progressField()).toHaveFocus()
    expect(progressField()).toHaveAttribute('maxLength', '500')
    expect(document.querySelector('.cm-content')?.textContent).toContain('Some notes')
  })

  it('a changed value saves on blur as just the progress field', async () => {
    seed('50%', 'keep these')
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: '80%' } })
    expect(updateSpy).not.toHaveBeenCalled()
    fireEvent.blur(progressField())
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(100, { progress: '80%' })
  })

  it('an unchanged value writes nothing (blur, Enter, close)', async () => {
    seed('50%')
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.blur(progressField())
    fireEvent.change(progressField(), { target: { value: '60%' } })
    fireEvent.change(progressField(), { target: { value: '50%' } })
    fireEvent.keyDown(progressField(), { key: 'Enter' })
    expect(dialog()).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('cleared, it clears the field', async () => {
    seed('50%')
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: '' } })
    fireEvent.blur(progressField())
    expect(updateSpy).toHaveBeenCalledWith(100, { progress: undefined })
  })

  it('Enter saves and closes, handing the focus back to the cell', async () => {
    seed()
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: 'Waiting on Sam' } })
    fireEvent.keyDown(progressField(), { key: 'Enter' })
    expect(dialog()).toBeNull()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(100, { progress: 'Waiting on Sam' })
    expect(screen.getByText('cell')).toHaveFocus()
  })

  it('Esc closes keeping what was typed (as the notes are kept), focus back on the cell', async () => {
    seed('a')
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: 'b' } })
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(dialog()).toBeNull()
    expect(updateSpy).toHaveBeenCalledWith(100, { progress: 'b' })
    expect(screen.getByText('cell')).toHaveFocus()
  })

  it('an outside click closes it keeping what was typed', async () => {
    seed()
    const updateSpy = vi.spyOn(useTodoStore.getState(), 'update').mockResolvedValue(true)
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: 'typed' } })
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('elsewhere')) })
    expect(dialog()).toBeNull()
    expect(updateSpy).toHaveBeenCalledWith(100, { progress: 'typed' })
  })

  it('a change made elsewhere shows until the field is typed in; then the typed text stays', async () => {
    seed('one')
    await renderHarness()
    act(() => useTodoStore.setState({ todos: [makeTodo({ id: 100, title: 'Task', progress: 'two' })] }))
    expect(progressField()).toHaveValue('two')
    fireEvent.change(progressField(), { target: { value: 'mine' } })
    act(() => useTodoStore.setState({ todos: [makeTodo({ id: 100, title: 'Task', progress: 'three' })] }))
    expect(progressField()).toHaveValue('mine')
  })

  it('saves through the todo store as one undoable edit', async () => {
    const todo = makeTodo({ id: 100, title: 'Task', progress: 'old' })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    await renderHarness()
    fireEvent.change(progressField(), { target: { value: 'new' } })
    await act(async () => { fireEvent.blur(progressField()) })
    await act(async () => { await Promise.resolve() })
    expect(useTodoStore.getState().todos[0]?.progress).toBe('new')
    expect((await db.todos.get(100))?.progress).toBe('new')
    await act(async () => { await useUndoStore.getState().undo() })
    expect(useTodoStore.getState().todos[0]?.progress).toBe('old')
  })
})
