import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { db } from '../../../data/database'
import { NotesBody, type NotesSource } from '../../../components/task/notes/NotesBody'
import { useTodoStore } from '../../../stores/todo-store'
import { useUndoStore } from '../../../stores/undo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useTagStore.setState(useTagStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useStatusStore.setState(useStatusStore.getInitialState(), true)
  useFilterStore.setState(useFilterStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** NotesBody over a plain in-memory note. */
function Harness({ initial }: { initial: string }) {
  const ref = useRef(initial)
  const [, rerender] = useState(0)
  const source = useMemo<NotesSource>(() => ({
    get: () => ref.current,
    set: (next) => { ref.current = next; rerender((n) => n + 1) },
  }), [])
  return <NotesBody source={source} />
}

function setup(initial: string) {
  const utils = render(<Harness initial={initial} />)
  const view = EditorView.findFromDOM(utils.container.querySelector('.cm-editor') as HTMLElement)
  if (!view) throw new Error('no editor')
  return { ...utils, view, doc: () => view.state.doc.toString() }
}

/** Offset of the start of 1-based `line`. */
function lineStart(view: EditorView, line: number) {
  return view.state.doc.line(line).from
}

function pressAltT(view: EditorView) {
  fireEvent.keyDown(view.contentDOM, { key: 't', code: 'KeyT', altKey: true })
}

const titles = () => useTodoStore.getState().todos.map((t) => t.title)

const NOTE = [
  '# Weekly sync',
  '- Draft homepage copy #planning',
  'Random thought: maybe switch CDN?',
  '- Book venue for team dinner /important',
  '- [ ] Renew domain /urgent',
  '- [x] Send recap email',
].join('\n')

describe('Convert button', () => {
  it('counts the bullet lines of the note and names them', () => {
    setup(NOTE)
    const btn = screen.getByRole('button', { name: 'Convert 3 bullet lines to tasks' })
    expect(btn).toHaveAttribute('aria-disabled', 'false')
    expect(within(btn).getByText('3')).toBeInTheDocument()
  })

  it('is disabled with no bullet lines', () => {
    setup('Just a thought\n# Heading\n- [x] done')
    const btn = screen.getByRole('button', { name: 'No bullet lines to convert' })
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a selection scopes it to the bullet lines it touches', () => {
    const { view } = setup(NOTE)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 2) + 3, head: lineStart(view, 4) + 2 } }))
    const btn = screen.getByRole('button', { name: 'Convert 2 selected lines to tasks' })
    expect(btn).toHaveAttribute('data-selection', 'true')
  })

  it.each([
    ['Win32', /Alt\+T converts the current line/],
    ['MacIntel', /⌥T converts the current line/],
  ])('its tooltip names the Alt+T shortcut (%s)', async (platform, text) => {
    vi.stubGlobal('navigator', { ...navigator, platform } as Navigator)
    vi.useFakeTimers()
    try {
      setup(NOTE)
      fireEvent.pointerEnter(screen.getByRole('button', { name: /Convert 3/ }), { pointerType: 'mouse' })
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('tooltip')).toHaveTextContent(text)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hovering marks the lines in scope', () => {
    const { container } = setup(NOTE)
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Convert 3/ }), { pointerType: 'mouse' })
    expect(container.querySelectorAll('.cm-convert-scope')).toHaveLength(3)
    fireEvent.pointerLeave(screen.getByRole('button', { name: /Convert 3/ }))
    expect(container.querySelectorAll('.cm-convert-scope')).toHaveLength(0)
  })
})

describe('Alt+T: one line through Quick Add', () => {
  it('opens Quick Add prefilled from the line; Enter makes the task and marks the line', async () => {
    const { view, doc } = setup(NOTE)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 4) + 5 } }))
    pressAltT(view)
    const title = await screen.findByDisplayValue('Book venue for team dinner /important')
    expect(screen.getByRole('group', { name: 'What the task gets' })).toHaveTextContent('Important')
    expect(titles()).toEqual([])
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() => expect(titles()).toEqual(['Book venue for team dinner']))
    expect(useTodoStore.getState().todos[0]?.important).toBe(true)
    await waitFor(() => expect(doc().split('\n')[3]).toBe('✓ Book venue for team dinner'))
    await waitFor(() => expect(screen.queryByDisplayValue('Book venue for team dinner /important')).toBeNull())
  })

  it('Esc on the text it opened with creates nothing, asks nothing and leaves the note unchanged', async () => {
    const { view, doc } = setup(NOTE)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 3) } }))
    pressAltT(view) // a plain line: Alt+T takes any line
    const input = await screen.findByDisplayValue('Random thought: maybe switch CDN?')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('Random thought: maybe switch CDN?')).toBeNull()
    expect(useUIStore.getState().confirmPrompts).toEqual([])
    expect(titles()).toEqual([])
    expect(doc()).toBe(NOTE)
  })

  it('text edited in Quick Add, then Details: Esc in the editor asks before dropping it; unedited, it closes (cr31 N3)', async () => {
    for (const edited of [true, false]) {
      const { view } = setup(NOTE)
      act(() => view.dispatch({ selection: { anchor: lineStart(view, 3) } }))
      pressAltT(view)
      const input = await screen.findByDisplayValue('Random thought: maybe switch CDN?')
      if (edited) fireEvent.change(input, { target: { value: 'Switch the CDN' } })
      fireEvent.click(screen.getByRole('button', { name: /Details/ }))
      const editor = await screen.findByRole('dialog', { name: 'New task' })
      fireEvent.keyDown(editor, { key: 'Escape' })
      if (edited) {
        await waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
        expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument()
      } else {
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull())
        expect(useUIStore.getState().confirmPrompts).toEqual([])
      }
      cleanup()
      useUIStore.setState({ confirmPrompts: [] })
    }
  })

  it('does nothing on a blank or already converted line', () => {
    const { view } = setup('✓ Done\n\n- x')
    act(() => view.dispatch({ selection: { anchor: 0 } }))
    pressAltT(view)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 2) } }))
    pressAltT(view)
    expect(screen.queryByRole('dialog', { name: 'Quick add task' })).toBeNull()
  })

  it('a Convert scope of exactly one line opens Quick Add too', async () => {
    setup('Plain\n- Only bullet /focus\nPlain')
    fireEvent.click(screen.getByRole('button', { name: 'Convert 1 bullet line to tasks' }))
    expect(await screen.findByDisplayValue('Only bullet /focus')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Convert to tasks' })).toBeNull()
  })
})

describe('Remove note lines after converting (the setting)', () => {
  beforeEach(() => { useSettingsStore.setState({ removeConvertedLines: true }) })

  it('one line: the task is made and its line, with the lines under it, goes; one undo brings them back', async () => {
    const text = 'keep\n- Book venue\n  - call them\nlast'
    const { view, doc } = setup(text)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 2) + 3 } }))
    pressAltT(view)
    fireEvent.keyDown(await screen.findByDisplayValue('Book venue'), { key: 'Enter' })
    await waitFor(() => expect(titles()).toEqual(['Book venue']))
    await waitFor(() => expect(doc()).toBe('keep\nlast'))
    act(() => { undo(view) })
    expect(doc()).toBe(text)
  })

  it('the preview: its button says the lines go; no remove / keep prompt; lines left out stay', async () => {
    const { doc } = setup('- a\n- b\n- c\nplain')
    fireEvent.click(screen.getByRole('button', { name: /^Convert 3 / }))
    const dialog = await screen.findByRole('dialog', { name: 'Convert to tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove "c"' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Done: remove "b" from the note' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 1 task, remove 2 lines' }))
    await waitFor(() => expect(titles()).toEqual(['a']))
    await waitFor(() => expect(doc()).toBe('- c\nplain'))
    expect(screen.queryByRole('dialog', { name: /Remove .* from the note/ })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Convert to tasks' })).toBeNull()
  })

  it('off, nothing changes: the line is marked ✓', async () => {
    useSettingsStore.setState({ removeConvertedLines: false })
    const { view, doc } = setup('- only')
    act(() => view.dispatch({ selection: { anchor: 3 } }))
    pressAltT(view)
    fireEvent.keyDown(await screen.findByDisplayValue('only'), { key: 'Enter' })
    await waitFor(() => expect(doc()).toBe('✓ only'))
  })
})

describe('Convert preview', () => {
  async function openPreview(initial = NOTE) {
    const s = setup(initial)
    fireEvent.click(screen.getByRole('button', { name: /^Convert \d+ / }))
    const dialog = await screen.findByRole('dialog', { name: 'Convert to tasks' })
    return { ...s, dialog }
  }

  it('lists one parsed draft per bullet line; nothing is stored', async () => {
    const { dialog } = await openPreview()
    expect(within(dialog).getByText('3 drafts')).toBeInTheDocument()
    expect(within(dialog).getByText(/From the note "Weekly sync"/)).toBeInTheDocument()
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Draft homepage copy', 'Book venue for team dinner', 'Renew domain',
    ])
    expect(within(rows[0]!).getByText('#planning')).toBeInTheDocument()
    expect(titles()).toEqual([])
    expect(await db.todos.count()).toBe(0)
  })

  it('Cancel / Esc closes it without touching tasks or the note', async () => {
    const { dialog, doc } = await openPreview()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Convert to tasks' })).toBeNull()
    expect(doc()).toBe(NOTE)
    expect(titles()).toEqual([])
  })

  it('edit a row in draft mode, remove one, create, then Remove the converted lines', async () => {
    const { dialog, doc } = await openPreview()
    fireEvent.doubleClick(within(within(dialog).getByRole('listitem', { name: 'Renew domain' })).getByText('Renew domain'))
    // Draft mode: the badge, Save draft, no Last follow-up.
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Nothing is saved until you create the tasks')).toBeInTheDocument()
    expect(screen.queryByLabelText('Last follow-up')).toBeNull()
    expect(screen.queryByRole('button', { name: /Mark followed up/ })).toBeNull()
    const title = screen.getByDisplayValue('Renew domain')
    fireEvent.change(title, { target: { value: 'Renew the domain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await within(dialog).findByRole('listitem', { name: 'Renew the domain' })
    expect(titles()).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove "Draft homepage copy"' }))
    expect(within(dialog).getByText('1 line left out')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))

    const prompt = await screen.findByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    expect(titles().sort()).toEqual(['Book venue for team dinner', 'Renew the domain'])
    expect(useTodoStore.getState().todos.find((t) => t.title === 'Renew the domain')?.urgent).toBe(true)
    expect(useUndoStore.getState().snackbar?.description).toBe('Created 2 tasks')
    expect(within(prompt).getByText(/The line you left out stays as it is/)).toBeInTheDocument()
    fireEvent.click(within(prompt).getByRole('button', { name: 'Remove 2 lines' }))
    expect(doc()).toBe([
      '# Weekly sync',
      '- Draft homepage copy #planning',
      'Random thought: maybe switch CDN?',
      '- [x] Send recap email',
    ].join('\n'))
  })

  it('Keep (or Esc) marks each converted line ✓ <title>', async () => {
    const { dialog, doc } = await openPreview('- One /urgent\n- Two @Marco\nplain')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    const prompt = await screen.findByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    // The new person was created with the tasks.
    expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Marco'])
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep' }))
    expect(doc()).toBe('✓ One\n✓ Two\nplain')
  })

  it('indented list lines under a bullet are its task’s subtasks (cr28): shown under the draft, stored with the task; Remove takes them with the line', async () => {
    const { dialog, doc } = await openPreview('- Q4 budget\n  - Send the template @Marco\n  - [x] Headcount\n- Other\nplain')
    expect(within(dialog).getByText('2 drafts')).toBeInTheDocument()
    const row = within(dialog).getByRole('listitem', { name: 'Q4 budget' })
    expect(within(row).getByRole('list', { name: 'Subtasks of Q4 budget' })).toHaveTextContent('☐ Send the template @Marco☑ Headcount')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    const prompt = await screen.findByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    // A subtask's words are plain text: no person was created.
    expect(usePersonStore.getState().people).toEqual([])
    const budget = useTodoStore.getState().todos.find((t) => t.title === 'Q4 budget')!
    expect((await db.subtasks.where('todoId').equals(budget.id).sortBy('sortOrder')).map((s) => [s.title, s.isCompleted]))
      .toEqual([['Send the template @Marco', false], ['Headcount', true]])
    fireEvent.click(within(prompt).getByRole('button', { name: 'Remove 2 lines' }))
    expect(doc()).toBe('plain')
  })

  it('Keep marks the bullet ✓ and drops its subtask lines, whose text now lives in the task', async () => {
    const { dialog, doc } = await openPreview('- Q4 budget\n  - Send the template\n- Other')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    const prompt = await screen.findByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep' }))
    expect(doc()).toBe('✓ Q4 budget\n✓ Other')
  })

  it('a line’s !status gives its task the status; an unknown one stays in the title', async () => {
    useStatusStore.setState({ statuses: [{ id: 50, name: 'Waiting', color: '#fa0', sortOrder: 0 }] })
    const { dialog } = await openPreview('- Call vendor !wa\n- Ship !nope')
    expect(within(dialog).getAllByRole('listitem').map((r) => r.getAttribute('aria-label'))).toEqual(['Call vendor', 'Ship !nope'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    await screen.findByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    const todos = useTodoStore.getState().todos
    expect(todos.find((t) => t.title === 'Call vendor')?.statusId).toBe(50)
    expect(todos.find((t) => t.title === 'Ship !nope')?.statusId).toBeUndefined()
  })

  it('finds the lines again when the note changed before the answer', async () => {
    const { dialog, view, doc } = await openPreview('- a\n- b\nkeep me')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    const prompt = await screen.findByRole('dialog', { name: /Remove 2 converted lines/ })
    // Elsewhere, the note gains a line on top and line `- b` is edited.
    act(() => view.dispatch({ changes: [{ from: 0, insert: 'new top\n' }, { from: 4, to: 7, insert: '- b edited' }] }))
    expect(doc()).toBe('new top\n- a\n- b edited\nkeep me')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Remove 2 lines' }))
    expect(doc()).toBe('new top\n- b edited\nkeep me')
  })

  it('undoing the create (snackbar) deletes the tasks; the prompt then leaves the note alone', async () => {
    const { dialog, doc } = await openPreview('- a\n- b')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }))
    const prompt = await screen.findByRole('dialog', { name: /Remove 2 converted lines/ })
    await act(async () => { await useUndoStore.getState().undo() })
    expect(titles()).toEqual([])
    fireEvent.click(within(prompt).getByRole('button', { name: 'Remove 2 lines' }))
    expect(doc()).toBe('- a\n- b')
  })

  it('removing every draft leaves "No drafts left" and disables Create', async () => {
    const { dialog } = await openPreview('- a\n- b')
    const first = within(dialog).getByRole('listitem', { name: 'a' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Delete' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove "b"' }))
    expect(within(dialog).getByText('No drafts left')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create 0 tasks' })).toBeDisabled()
  })

  it('keys: ↓ moves, ⏎ edits the focused row, Ctrl+⏎ creates', async () => {
    const { dialog } = await openPreview('- a\n- b\n- c')
    const rows = within(dialog).getAllByRole('listitem')
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'Enter' })
    expect(await screen.findByDisplayValue('b')).toBeInTheDocument()
    // The draft editor's Cancel (the preview's own is under it).
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel Esc' }).at(-1)!)
    expect(screen.queryByDisplayValue('b')).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    await screen.findByRole('dialog', { name: /Remove 3 converted lines/ })
    expect(titles().sort()).toEqual(['a', 'b', 'c'])
  })

  it('a selection-scoped convert says so', async () => {
    const s = setup(NOTE)
    act(() => s.view.dispatch({ selection: { anchor: lineStart(s.view, 2), head: lineStart(s.view, 5) + 3 } }))
    fireEvent.click(screen.getByRole('button', { name: 'Convert 3 selected lines to tasks' }))
    const dialog = await screen.findByRole('dialog', { name: 'Convert to tasks' })
    expect(within(dialog).getByText(/From your selection in "Weekly sync"/)).toBeInTheDocument()
  })
})

describe('a create that fails (the task store refuses the write)', () => {
  async function failInserts() {
    const { todoRepository } = await import('../../../data/todo-repository')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return vi.spyOn(todoRepository, 'insertManyWithAssignments').mockRejectedValue(new Error('disk full'))
  }
  afterEach(() => { vi.restoreAllMocks() })

  it('one line: Quick Add stays open as typed, the line is not marked; Enter again works', async () => {
    const insert = await failInserts()
    const { view, doc } = setup(NOTE)
    act(() => view.dispatch({ selection: { anchor: lineStart(view, 4) + 5 } }))
    pressAltT(view)
    const title = await screen.findByDisplayValue('Book venue for team dinner /important')
    fireEvent.change(title, { target: { value: 'Book the venue' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() => expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t add "Book the venue".'))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(screen.getByDisplayValue('Book the venue')).toBeInTheDocument()
    expect(doc()).toBe(NOTE)
    expect(titles()).toEqual([])

    insert.mockRestore()
    await act(async () => { await Promise.resolve() })
    fireEvent.keyDown(screen.getByDisplayValue('Book the venue'), { key: 'Enter' })
    await waitFor(() => expect(titles()).toEqual(['Book the venue']))
    await waitFor(() => expect(doc().split('\n')[3]).toBe('✓ Book the venue'))
    await waitFor(() => expect(screen.queryByDisplayValue('Book the venue')).toBeNull())
  })

  it('the preview: the drafts stay and no remove / keep prompt shows; Create again works', async () => {
    const insert = await failInserts()
    const { doc } = setup(NOTE)
    fireEvent.click(screen.getByRole('button', { name: /^Convert 3 / }))
    const dialog = await screen.findByRole('dialog', { name: 'Convert to tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 3 tasks' }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create 3 tasks' })).not.toBeDisabled())
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('dialog', { name: /Remove 3 converted lines/ })).toBeNull()
    expect(titles()).toEqual([])
    expect(doc()).toBe(NOTE)

    insert.mockRestore()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 3 tasks' }))
    expect(await screen.findByRole('dialog', { name: 'Remove 3 converted lines from the note?' })).toBeInTheDocument()
    expect(titles()).toHaveLength(3)
  })
  it('the preview: a draft checked off while the create runs stays checked when it fails (cr31)', async () => {
    const insert = await failInserts()
    let fail: (e: Error) => void = () => {}
    insert.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    setup(NOTE)
    fireEvent.click(screen.getByRole('button', { name: /^Convert 3 / }))
    const dialog = await screen.findByRole('dialog', { name: 'Convert to tasks' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 3 tasks' }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    const box = within(dialog).getAllByRole('checkbox')[0]!
    fireEvent.click(box)
    expect(box).toBeChecked()
    await act(async () => { fail(new Error('disk full')) })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Create 2 tasks/ })).not.toBeDisabled())
    expect(within(dialog).getAllByRole('checkbox')[0]).toBeChecked()
    expect(titles()).toEqual([])
  })
})
