import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef, useRef, useState } from 'react'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { db } from '../../data/database'
import { TaskNotePopover } from '../../components/task/TaskNotePopover'
import { useTodoStore } from '../../stores/todo-store'
import { SAVE_DEBOUNCE_MS, useNoteStore } from '../../stores/note-store'
import { todoRepository } from '../../data'
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

  it('leaves presses and Esc in a layer opened above it (a menu, an editor, a confirm) to that layer', async () => {
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
    // A portal opened later (e.g. the `@ #` popup's person menu, then the
    // People editor it opens) is a later child of <body>.
    const menu = document.createElement('div')
    menu.innerHTML = '<button>Edit…</button>'
    document.body.appendChild(menu)
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    dialog.innerHTML = '<input />'
    document.body.appendChild(dialog)
    try {
      fireEvent.mouseDown(menu.querySelector('button')!)
      fireEvent.keyDown(dialog.querySelector('input')!, { key: 'Escape' })
      // Nothing focused: the Esc belongs to the modal above.
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      menu.remove()
      dialog.remove()
    }
    // With the layers gone, Esc closes it again.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

})

describe('TaskNotePopover: notes are written as one edit session at a time', () => {
  // Only the debounce timer is faked: the database runs on its own scheduler.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
  afterEach(() => { vi.useRealTimers() })

  async function seedStored(notes?: string) {
    const todo = makeTodo({ id: 100, title: 'Task', notes })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    useUndoStore.getState().clear()
  }

  function Harness() {
    const anchor = useRef<HTMLButtonElement>(null)
    const [open, setOpen] = useState(true)
    return (
      <>
        <button ref={anchor} onClick={() => setOpen((v) => !v)}>cell</button>
        {open && <TaskNotePopover todoId={100} anchorRef={anchor} onClose={() => setOpen(false)} />}
      </>
    )
  }

  async function open() {
    render(<Harness />)
    await act(async () => { await Promise.resolve() })
  }

  // CodeMirror's contenteditable doesn't take React's input events: type
  // through the editor's own view, one change per keystroke.
  const view = () => {
    const v = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)
    if (!v) throw new Error('no editor')
    return v
  }
  const type = (text: string) => {
    for (const ch of text) act(() => view().dispatch({ changes: { from: view().state.doc.length, insert: ch } }))
  }
  const editorText = () => view().state.doc.toString()
  const storedNotes = () => useTodoStore.getState().todos[0]?.notes ?? ''
  const undoEntries = () => useUndoStore.getState().undoStack.length
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS) })

  it('keystrokes write nothing until typing stops; then one write and one undo entry', async () => {
    await seedStored('')
    const writes = vi.spyOn(todoRepository, 'update')
    await open()
    type('Hello')
    expect(writes).not.toHaveBeenCalled()
    expect(storedNotes()).toBe('')
    await settle()
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writes).toHaveBeenCalledWith(100, { notes: 'Hello' }, expect.any(Date))
    await vi.waitFor(async () => expect((await db.todos.get(100))?.notes).toBe('Hello'))
    expect(undoEntries()).toBe(1)
  })

  it('closing before typing stops writes what was typed', async () => {
    await seedStored('a')
    await open()
    type('bc')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog', { name: 'Progress and notes' })).toBeNull()
    expect(storedNotes()).toBe('abc')
    await vi.waitFor(async () => expect((await db.todos.get(100))?.notes).toBe('abc'))
    expect(undoEntries()).toBe(1)
  })

  it('leaving the notes (blur) writes what was typed', async () => {
    await seedStored('')
    await open()
    type('x')
    fireEvent.blur(view().contentDOM, { relatedTarget: screen.getByText('cell') })
    expect(storedNotes()).toBe('x')
  })

  it('one Undo takes back the whole edit', async () => {
    await seedStored('start')
    await open()
    type(' and more')
    await settle()
    expect(storedNotes()).toBe('start and more')
    await vi.waitFor(() => expect(undoEntries()).toBe(1))
    await act(async () => { await useUndoStore.getState().undo() })
    expect(storedNotes()).toBe('start')
    // Not typed in since: the popover follows the store.
    expect(editorText()).toBe('start')
    expect((await db.todos.get(100))?.notes).toBe('start')
  })

  it('a change made elsewhere shows while nothing typed waits; the next keystroke edits it', async () => {
    await seedStored('old')
    await open()
    await act(async () => { await useTodoStore.getState().update(100, { notes: 'changed elsewhere' }) })
    expect(editorText()).toBe('changed elsewhere')
    type('!')
    await settle()
    expect(storedNotes()).toBe('changed elsewhere!')
  })

  it('text being typed stays over a change made elsewhere, and is what gets written', async () => {
    await seedStored('old')
    await open()
    type(' mine')
    await act(async () => { await useTodoStore.getState().update(100, { title: 'Renamed' }) })
    expect(editorText()).toBe('old mine')
    await settle()
    expect(useTodoStore.getState().todos[0]).toMatchObject({ title: 'Renamed', notes: 'old mine' })
  })

  it('cleared, it clears the notes field', async () => {
    await seedStored('abc')
    const writes = vi.spyOn(todoRepository, 'update')
    await open()
    act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length } }))
    await settle()
    expect(writes).toHaveBeenCalledWith(100, { notes: undefined }, expect.any(Date))
    expect(useTodoStore.getState().todos[0]?.notes).toBeUndefined()
  })

  it('saving Progress writes the notes typed first, each its own undo step', async () => {
    await seedStored('n')
    await open()
    type('otes')
    fireEvent.change(screen.getByRole('textbox', { name: 'Progress' }), { target: { value: 'half' } })
    await act(async () => { fireEvent.blur(screen.getByRole('textbox', { name: 'Progress' })) })
    await vi.waitFor(() => expect(undoEntries()).toBe(2))
    expect(useTodoStore.getState().todos[0]).toMatchObject({ notes: 'notes', progress: 'half' })
    await act(async () => { await useUndoStore.getState().undo() })
    expect(useTodoStore.getState().todos[0]).toMatchObject({ notes: 'notes', progress: undefined })
  })

  it('a failed write keeps the text and writes it with the next flush', async () => {
    await seedStored('')
    const writes = vi.spyOn(todoRepository, 'update').mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await open()
    type('keep')
    await settle()
    // Rolled back in the store; the editor keeps what was typed.
    expect(storedNotes()).toBe('')
    expect(editorText()).toBe('keep')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(writes).toHaveBeenCalledTimes(2)
    expect(storedNotes()).toBe('keep')
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
