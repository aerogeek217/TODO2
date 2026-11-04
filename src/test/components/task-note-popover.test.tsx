import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef, useRef, useState } from 'react'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { db } from '../../data/database'
import { TaskNotePopover } from '../../components/task/TaskNotePopover'
import { useTodoStore } from '../../stores/todo-store'
import { SAVE_DEBOUNCE_MS, useNoteStore } from '../../stores/note-store'
import { todoRepository } from '../../data'
import { useUndoStore } from '../../stores/undo-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useUIStore } from '../../stores/ui-store'
import { addDays, formatDateNumeric, startOfToday } from '../../utils/date'
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
    expect(screen.queryByRole('dialog', { name: 'Status and notes' })).toBeNull()
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

  it.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    ['visibilitychange to hidden', () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    }],
  ])('%s starts writing what was typed in the handler, before the debounce', async (_name, hide) => {
    await seedStored('')
    const writes = vi.spyOn(todoRepository, 'update')
    await open()
    type('closing the tab')
    act(() => hide())
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writes).toHaveBeenCalledWith(100, { notes: 'closing the tab' }, expect.any(Date))
    await vi.waitFor(async () => expect((await db.todos.get(100))?.notes).toBe('closing the tab'))
    await settle()
    expect(writes).toHaveBeenCalledTimes(1)
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

  it('adding a status update writes the notes typed first, each its own undo step', async () => {
    await seedStored('n')
    await open()
    type('otes')
    const line = screen.getByRole('textbox', { name: 'Status' })
    fireEvent.change(line, { target: { value: 'half' } })
    await act(async () => { fireEvent.keyDown(line, { key: 'Enter' }) })
    await vi.waitFor(() => expect(undoEntries()).toBe(2))
    expect(useTodoStore.getState().todos[0]).toMatchObject({ notes: 'notes' })
    expect(useStatusUpdateStore.getState().byTodo.get(100)?.map((u) => u.text)).toEqual(['half'])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(useStatusUpdateStore.getState().byTodo.get(100)).toBeUndefined()
    expect(useTodoStore.getState().todos[0]).toMatchObject({ notes: 'notes' })
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

describe('TaskNotePopover: Status', () => {
  async function seed(updates: { date: Date; text: string }[] = [], notes?: string) {
    const todo = makeTodo({ id: 100, title: 'Task', notes })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    const now = Date.now()
    await db.statusUpdates.bulkAdd(updates.map((u, i) => ({ todoId: 100, ...u, createdAt: new Date(now - i * 1000) })))
    await useStatusUpdateStore.getState().load()
    useUndoStore.getState().clear()
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

  const line = () => screen.getByRole('textbox', { name: 'Status' })
  const dialog = () => screen.queryByRole('dialog', { name: 'Status and notes' })
  const texts = () => (useStatusUpdateStore.getState().byTodo.get(100) ?? []).map((u) => u.text)
  const today = () => startOfToday()

  it('is one dialog: Status (the newest update, History (N), a focused add line) above the notes', async () => {
    await seed([{ date: addDays(today(), -1), text: '50% done' }, { date: addDays(today(), -4), text: 'started' }], 'Some notes')
    await renderHarness()
    expect(dialog()).toBeInTheDocument()
    expect(document.querySelector('[data-newest-update]')).toHaveTextContent(`${formatDateNumeric(addDays(today(), -1))} 50% done`)
    expect(screen.getByRole('button', { name: 'History (2) →' })).toBeInTheDocument()
    expect(line()).toHaveValue('')
    expect(line()).toHaveFocus()
    expect(line()).toHaveAttribute('maxLength', '500')
    expect(screen.getByText('Today · ⏎')).toBeInTheDocument()
    expect(document.querySelector('.cm-content')?.textContent).toContain('Some notes')
  })

  it('without updates: no newest line, no History', async () => {
    await seed()
    await renderHarness()
    expect(document.querySelector('[data-newest-update]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^History/ })).toBeNull()
  })

  it('⏎ adds the update dated today, clears the line and stays open; it becomes the newest', async () => {
    await seed([{ date: addDays(today(), -3), text: 'old' }])
    await renderHarness()
    fireEvent.change(line(), { target: { value: '  Waiting on Sam ' } })
    await act(async () => { fireEvent.keyDown(line(), { key: 'Enter' }) })
    await vi.waitFor(() => expect(texts()).toEqual(['Waiting on Sam', 'old']))
    expect(useStatusUpdateStore.getState().byTodo.get(100)?.[0]?.date).toEqual(today())
    expect(dialog()).toBeInTheDocument()
    expect(line()).toHaveValue('')
    expect(line()).toHaveFocus()
    expect(document.querySelector('[data-newest-update]')).toHaveTextContent(`${formatDateNumeric(today())} Waiting on Sam`)
    expect(screen.getByRole('button', { name: 'History (2) →' })).toBeInTheDocument()
    // Blank adds nothing.
    fireEvent.change(line(), { target: { value: '   ' } })
    await act(async () => { fireEvent.keyDown(line(), { key: 'Enter' }) })
    expect(await db.statusUpdates.count()).toBe(2)
  })

  it('Esc closes keeping what was typed (added, as the notes are kept), focus back on the cell', async () => {
    await seed()
    await renderHarness()
    fireEvent.change(line(), { target: { value: 'b' } })
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(dialog()).toBeNull()
    await vi.waitFor(() => expect(texts()).toEqual(['b']))
    expect(screen.getByText('cell')).toHaveFocus()
  })

  it('an outside click closes it keeping what was typed; an empty line adds nothing', async () => {
    await seed()
    await renderHarness()
    fireEvent.change(line(), { target: { value: 'typed' } })
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('elsewhere')) })
    expect(dialog()).toBeNull()
    await vi.waitFor(() => expect(texts()).toEqual(['typed']))

    await renderHarness()
    await act(async () => { fireEvent.mouseDown(screen.getAllByTestId('elsewhere')[0]!) })
    expect(await db.statusUpdates.count()).toBe(1)
  })

  it('History (N) → closes it and opens the task’s editor', async () => {
    await seed([{ date: today(), text: 'one' }])
    await renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'History (1) →' }))
    expect(dialog()).toBeNull()
    expect(useUIStore.getState()).toMatchObject({ selectedTodoId: 100, editPopupMode: 'edit' })
  })

  it('a change made elsewhere shows as the newest', async () => {
    await seed([{ date: addDays(today(), -2), text: 'one' }])
    await renderHarness()
    await act(async () => { await useStatusUpdateStore.getState().add(100, { date: today(), text: 'two' }) })
    expect(document.querySelector('[data-newest-update]')).toHaveTextContent(`${formatDateNumeric(today())} two`)
  })
})
