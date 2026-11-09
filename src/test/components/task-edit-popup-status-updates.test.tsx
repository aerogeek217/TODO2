// The task editor's Status updates section (D26 BB / BG): the entries oldest
// first, the add line last (⏎ adds the update dated today; what was typed
// sticks when the editor closes), editing in place (⏎ saves, Esc cancels
// without closing the editor), delete with the undo snackbar, and create
// mode's pending entries.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { addDays, formatDateNumeric, startOfToday } from '../../utils/date'
import { makeTodo, resetDb } from '../helpers'
import type { TaskDraft } from '../../services/task-draft'

const today = () => startOfToday()
const daysAgo = (n: number) => addDays(startOfToday(), -n)

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const section = () => screen.getByRole('region', { name: /Status updates/ })
/** The add line, last in the section. */
const addField = () => screen.getByRole('textbox', { name: 'New status update' }) as HTMLInputElement
/** The entries' lines as shown, oldest first (`MM/DD text`). */
const shownLines = () => within(section()).queryAllByRole('listitem')
  .filter((li) => li.hasAttribute('data-status-update'))
  .map((li) => li.textContent ?? '')

/** Types `text` in the add line and adds it (⏎); with `day`, then sets the new entry's day by editing it. */
function addUpdate(text: string, day?: string) {
  fireEvent.change(addField(), { target: { value: text } })
  fireEvent.keyDown(addField(), { key: 'Enter' })
  if (day === undefined) return
  fireEvent.click(screen.getByRole('button', { name: `Edit status update: ${formatDateNumeric(today())} ${text}` }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Status update’s day' }), { target: { value: day } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Status update' }), { key: 'Enter' })
}

async function openStored(updates: { daysAgo: number; text: string }[] = []) {
  const todo = makeTodo({ id: 100, title: 'Task' })
  await db.todos.add(todo)
  const base = Date.now()
  await db.statusUpdates.bulkAdd(updates.map((u, i) => ({
    todoId: 100, date: daysAgo(u.daysAgo), text: u.text, createdAt: new Date(base - (updates.length - i) * 1000),
  })))
  useTodoStore.setState({ todos: [todo] })
  await useStatusUpdateStore.getState().load()
  act(() => useUIStore.getState().openEditPopup(100))
  render(<TaskEditPopupHost />)
  await act(async () => { await Promise.resolve() })
}

const storedTexts = async () => (await db.statusUpdates.where('todoId').equals(100).toArray())
  .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
  .map((u) => [formatDateNumeric(u.date), u.text])

describe('TaskEditPopup — Status updates (edit mode)', () => {
  it('⏎ in the add line adds an update dated today and clears the line; a blank line adds nothing', async () => {
    await openStored()
    expect(screen.queryByRole('button', { name: '+ Add update' })).toBeNull()
    expect(addField()).toHaveAttribute('placeholder', 'What’s the latest?')

    fireEvent.change(addField(), { target: { value: '  waiting on legal  ' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(today()), 'waiting on legal']]))
    expect(addField().value).toBe('')
    await vi.waitFor(() => expect(shownLines()).toEqual([`${formatDateNumeric(today())}waiting on legal`]))
    // The count beside the label.
    expect(section().querySelector('[id]')?.textContent).toBe('Status updates1')

    fireEvent.change(addField(), { target: { value: '   ' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    expect(await db.statusUpdates.count()).toBe(1)
  })

  it('reads oldest first, the newest last in the primary colour; every entry shows (the list scrolls inside); the add line comes after', async () => {
    await openStored([
      { daysAgo: 1, text: 'one' }, { daysAgo: 2, text: 'two' }, { daysAgo: 3, text: 'three' },
      { daysAgo: 4, text: 'four' }, { daysAgo: 5, text: 'five' },
    ])
    expect(shownLines().map((l) => l.slice(5))).toEqual(['five', 'four', 'three', 'two', 'one'])
    const items = within(section()).getAllByRole('listitem')
    expect(items.at(-1)).toHaveAttribute('data-newest', 'true')
    expect(items.filter((li) => li.hasAttribute('data-newest'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /older update/ })).toBeNull()
    const list = within(section()).getByRole('list', { name: 'Status updates' })
    expect(list.compareDocumentPosition(addField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the add line’s text sticks: Esc leaves the line (the editor stays), closing the editor adds it', async () => {
    await openStored()
    fireEvent.change(addField(), { target: { value: 'this one' } })
    fireEvent.keyDown(addField(), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(addField().value).toBe('this one')
    expect(await db.statusUpdates.count()).toBe(0)
    await act(async () => { useUIStore.getState().closeEditPopup() })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(today()), 'this one']]))
  })

  it('edit in place: ⏎ saves the day and text; Esc cancels and the editor stays open', async () => {
    await openStored([{ daysAgo: 2, text: 'drafted' }])
    fireEvent.click(screen.getByRole('button', { name: `Edit status update: ${formatDateNumeric(daysAgo(2))} drafted` }))
    const text = screen.getByRole('textbox', { name: 'Status update' }) as HTMLInputElement
    expect(text).toHaveValue('drafted')
    expect(text).toHaveFocus()

    fireEvent.change(text, { target: { value: 'scrapped' } })
    fireEvent.keyDown(text, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Status update' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(await storedTexts()).toEqual([[formatDateNumeric(daysAgo(2)), 'drafted']])
    // Focus back on the entry's edit button.
    expect(screen.getByRole('button', { name: /^Edit status update/ })).toHaveFocus()

    // A click on the text edits too.
    fireEvent.click(within(section()).getByText('drafted'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Status update' }), { target: { value: 'reviewed' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Status update’s day' }), { target: { value: 'yesterday' } })
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Status update' }), { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(daysAgo(1)), 'reviewed']]))
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Edit status update')
  })

  it('a day after today is refused when editing an entry', async () => {
    await openStored([{ daysAgo: 2, text: 'drafted' }])
    fireEvent.click(screen.getByRole('button', { name: /^Edit status update/ }))
    const day = screen.getByRole('textbox', { name: 'Status update’s day' })
    fireEvent.change(day, { target: { value: 'tomorrow' } })
    expect(day).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('delete asks nothing: the snackbar’s undo puts it back', async () => {
    await openStored([{ daysAgo: 1, text: 'keep' }, { daysAgo: 2, text: 'gone' }])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Delete status update: ${formatDateNumeric(daysAgo(2))} gone` }))
    })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(daysAgo(1)), 'keep']]))
    expect(useUndoStore.getState().snackbar?.description).toBe('Status update removed')
    await act(async () => { await useUndoStore.getState().undo() })
    await vi.waitFor(() => expect(shownLines().map((l) => l.slice(5))).toEqual(['gone', 'keep']))
  })
})

describe('TaskEditPopup — Status updates (create mode)', () => {
  function renderCreate(seed?: TaskDraft) {
    const onCreate = vi.fn().mockResolvedValue(42)
    render(
      <TaskEditPopup
        mode="create"
        seed={seed}
        assignedPeople={[]}
        allPeople={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
        onAssignPerson={vi.fn()}
        onUnassignPerson={vi.fn()}
      />,
    )
    return { onCreate }
  }

  it('a new task’s updates count as following up: Last shows the newest’s day and goes with the task; taking it out takes that back', async () => {
    const { onCreate } = renderCreate()
    const last = () => screen.getByRole('textbox', { name: 'Last follow-up' }) as HTMLInputElement
    fireEvent.change(screen.getByPlaceholderText(/New task/), { target: { value: 'Write the report' } })
    expect(last().value).toBe('')
    addUpdate('outline done', 'yesterday')
    expect(last().value).not.toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Delete status update/ }))
    expect(last().value).toBe('')
    addUpdate('first draft', 'yesterday')
    await act(async () => { fireEvent.click(screen.getByText('Create task')) })
    expect(onCreate.mock.calls[0]?.[0].lastFollowupAt).toEqual(daysAgo(1))
  })

  it('a Last follow-up later than the newest pending update stays: an older update doesn’t move it back', async () => {
    const { onCreate } = renderCreate()
    const last = () => screen.getByRole('textbox', { name: 'Last follow-up' }) as HTMLInputElement
    fireEvent.change(screen.getByPlaceholderText(/New task/), { target: { value: 'Write the report' } })
    fireEvent.change(last(), { target: { value: 'yesterday' } })
    fireEvent.blur(last())
    const shown = last().value
    expect(shown).not.toBe('')
    addUpdate('outline done', formatDateNumeric(daysAgo(3)))
    expect(shownLines()).toEqual([`${formatDateNumeric(daysAgo(3))}outline done`])
    expect(last().value).toBe(shown)
    await act(async () => { fireEvent.click(screen.getByText('Create task')) })
    expect(onCreate.mock.calls[0]?.[0].lastFollowupAt).toEqual(daysAgo(1))
  })

  it('updates added before Create wait in the list (oldest first) and go with the task; nothing is written before', async () => {
    const { onCreate } = renderCreate()
    fireEvent.change(screen.getByPlaceholderText(/New task/), { target: { value: 'Write the report' } })
    addUpdate('outline done', 'yesterday')
    addUpdate('first draft')
    expect(shownLines()).toEqual([
      `${formatDateNumeric(daysAgo(1))}outline done`,
      `${formatDateNumeric(today())}first draft`,
    ])
    // A pending one is edited and deleted in place, too.
    fireEvent.click(screen.getByRole('button', { name: `Delete status update: ${formatDateNumeric(today())} first draft` }))
    expect(shownLines()).toHaveLength(1)
    expect(await db.statusUpdates.count()).toBe(0)

    await act(async () => { fireEvent.click(screen.getByText('Create task')) })
    expect(onCreate).toHaveBeenCalledTimes(1)
    const partial = onCreate.mock.calls[0]?.[0] as { statusUpdates?: { date: Date; text: string }[]; progress?: string }
    expect(partial.statusUpdates?.map((u) => [u.date, u.text])).toEqual([[daysAgo(1), 'outline done']])
    expect(partial).not.toHaveProperty('progress')
  })

  it('an entry still being edited goes with the task as edited: Create task, ⏎ in the title (cr31 T3)', async () => {
    for (const how of ['button', 'enter'] as const) {
      const { onCreate } = renderCreate()
      const titleField = screen.getByPlaceholderText(/New task/)
      fireEvent.change(titleField, { target: { value: 'Write the report' } })
      addUpdate('outline done')
      fireEvent.click(screen.getByRole('button', { name: /^Edit status update/ }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Status update' }), { target: { value: 'outline signed off' } })
      // The edit is still open: no ⏎, no Save.
      await act(async () => {
        if (how === 'button') fireEvent.click(screen.getByText('Create task'))
        else fireEvent.keyDown(titleField, { key: 'Enter' })
      })
      expect(onCreate).toHaveBeenCalledTimes(1)
      const partial = onCreate.mock.calls[0]?.[0] as { statusUpdates?: { text: string }[] }
      expect(partial.statusUpdates?.map((u) => u.text)).toEqual(['outline signed off'])
      cleanup()
    }
  })

  it('an update still being typed in the add line goes with the task, dated today (cr31 T3)', async () => {
    for (const how of ['button', 'enter'] as const) {
      const { onCreate } = renderCreate()
      const titleField = screen.getByPlaceholderText(/New task/)
      fireEvent.change(titleField, { target: { value: 'Write the report' } })
      fireEvent.change(addField(), { target: { value: 'kicked off' } })
      await act(async () => {
        if (how === 'button') fireEvent.click(screen.getByText('Create task'))
        else fireEvent.keyDown(titleField, { key: 'Enter' })
      })
      const partial = onCreate.mock.calls[0]?.[0] as { statusUpdates?: { date: Date; text: string }[] }
      expect(partial.statusUpdates?.map((u) => [u.date, u.text])).toEqual([[today(), 'kicked off']])
      cleanup()
    }
  })

  it('an edit to a draft’s entry counts as a change: the backdrop asks before closing (cr31 T3)', async () => {
    const update = { date: daysAgo(3), text: 'asked finance', createdAt: new Date() }
    const onClose = vi.fn()
    render(
      <TaskEditPopup
        mode="create"
        seed={{ title: 'Budget', urgent: false, important: false, focus: false, personIds: [], newPeople: [], tagIds: [], newTags: [], statusUpdates: [update] }}
        assignedPeople={[]}
        allPeople={[]}
        onClose={onClose}
        onCreate={vi.fn().mockResolvedValue(42)}
        onAssignPerson={vi.fn()}
        onUnassignPerson={vi.fn()}
      />,
    )
    const ask = vi.spyOn(useUIStore.getState(), 'askChoice').mockResolvedValue('cancel')
    fireEvent.click(screen.getByRole('button', { name: /^Edit status update/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Status update' }), { target: { value: 'finance said yes' } })
    // The backdrop's close, with the edit still open.
    const backdrop = document.querySelector('[data-testid="task-edit-backdrop"], [data-modal-backdrop]')
    expect(backdrop).not.toBeNull()
    fireEvent.mouseDown(backdrop!)
    fireEvent.click(backdrop!)
    await act(async () => {})
    expect(ask).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a draft’s status updates show as pending (a converted note line’s Details)', () => {
    const update = { date: daysAgo(3), text: 'asked finance', createdAt: new Date() }
    renderCreate({ title: 'Budget', urgent: false, important: false, focus: false, personIds: [], newPeople: [], tagIds: [], newTags: [], statusUpdates: [update] })
    expect(shownLines()).toEqual([`${formatDateNumeric(daysAgo(3))}asked finance`])
  })
})
