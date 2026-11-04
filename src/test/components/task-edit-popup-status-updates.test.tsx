// The task editor's Status updates section: the Add update popover (text + day), the
// entries newest first with three shown and the rest behind the older
// disclosure, editing in place (⏎ saves, Esc cancels without closing the
// editor), delete with the undo snackbar, and create mode's pending entries.
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
const addButton = () => screen.getByRole('button', { name: '+ Add update' })
/** The Add update popover's text field, the popover opened first when it is closed. */
const addField = () => {
  if (!screen.queryByRole('textbox', { name: 'New status update' })) fireEvent.click(addButton())
  return screen.getByRole('textbox', { name: 'New status update' }) as HTMLInputElement
}
const addDayField = () => {
  addField()
  return screen.getByRole('textbox', { name: 'New status update’s day' }) as HTMLInputElement
}
/** The entries' lines, newest first, as shown (`MM/DD text`). */
const shownLines = () => within(section()).queryAllByRole('listitem')
  .filter((li) => li.hasAttribute('data-status-update'))
  .map((li) => li.textContent ?? '')

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
  it('⏎ in the text adds an update dated today; ⏎ in the day field adds it on that day', async () => {
    await openStored()
    expect(screen.queryByPlaceholderText('e.g. 50% done, Waiting on review...')).toBeNull()

    fireEvent.change(addField(), { target: { value: '  waiting on legal  ' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(today()), 'waiting on legal']]))
    expect(addField().value).toBe('')

    fireEvent.change(addField(), { target: { value: 'sent the draft' } })
    fireEvent.change(addDayField(), { target: { value: 'yesterday' } })
    await act(async () => { fireEvent.keyDown(addDayField(), { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await storedTexts()).toHaveLength(2))
    expect(shownLines()).toEqual([
      `${formatDateNumeric(today())}waiting on legal`,
      `${formatDateNumeric(daysAgo(1))}sent the draft`,
    ])
    // The count beside the label.
    expect(section().querySelector('[id]')?.textContent).toBe('Status updates2')
  })

  it('a day after today is refused in the field; a blank text adds nothing', async () => {
    await openStored()
    fireEvent.change(addField(), { target: { value: 'later' } })
    fireEvent.change(addDayField(), { target: { value: 'tomorrow' } })
    expect(addDayField()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog', { name: 'Add a status update' })).toHaveTextContent("A status update can't be in the future")
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    fireEvent.change(addField(), { target: { value: '   ' } })
    fireEvent.change(addDayField(), { target: { value: '' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    expect(await db.statusUpdates.count()).toBe(0)
  })

  it('shows three, the rest behind “N older updates” (opened under an Older rule, closed on the next open)', async () => {
    await openStored([
      { daysAgo: 1, text: 'one' }, { daysAgo: 2, text: 'two' }, { daysAgo: 3, text: 'three' },
      { daysAgo: 4, text: 'four' }, { daysAgo: 5, text: 'five' },
    ])
    expect(shownLines().map((l) => l.slice(5))).toEqual(['one', 'two', 'three'])
    const newest = within(section()).getAllByRole('listitem')[0]
    expect(newest).toHaveAttribute('data-newest', 'true')

    fireEvent.click(screen.getByRole('button', { name: '▸ 2 older updates' }))
    expect(shownLines().map((l) => l.slice(5))).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(section()).toHaveTextContent('Older')
    fireEvent.click(screen.getByRole('button', { name: '▾ Hide older' }))
    expect(shownLines()).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: '▸ 2 older updates' }))
    act(() => useUIStore.getState().closeEditPopup())
    act(() => useUIStore.getState().openEditPopup(100))
    expect(shownLines()).toHaveLength(3)
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

  it('delete asks nothing: the snackbar’s undo puts it back', async () => {
    await openStored([{ daysAgo: 1, text: 'keep' }, { daysAgo: 2, text: 'gone' }])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Delete status update: ${formatDateNumeric(daysAgo(2))} gone` }))
    })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(daysAgo(1)), 'keep']]))
    expect(useUndoStore.getState().snackbar?.description).toBe('Status update removed')
    await act(async () => { await useUndoStore.getState().undo() })
    expect(shownLines().map((l) => l.slice(5))).toEqual(['keep', 'gone'])
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
    fireEvent.change(addField(), { target: { value: 'outline done' } })
    fireEvent.change(addDayField(), { target: { value: 'yesterday' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    expect(last().value).not.toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Delete status update/ }))
    expect(last().value).toBe('')
    fireEvent.change(addField(), { target: { value: 'first draft' } })
    fireEvent.change(addDayField(), { target: { value: 'yesterday' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    await act(async () => { fireEvent.click(screen.getByText('Create task')) })
    expect(onCreate.mock.calls[0]?.[0].lastFollowupAt).toEqual(daysAgo(1))
  })

  it('updates added before Create wait in the list and go with the task; nothing is written before', async () => {
    const { onCreate } = renderCreate()
    fireEvent.change(screen.getByPlaceholderText(/New task/), { target: { value: 'Write the report' } })
    fireEvent.change(addField(), { target: { value: 'outline done' } })
    fireEvent.change(addDayField(), { target: { value: 'yesterday' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    fireEvent.change(addField(), { target: { value: 'first draft' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    expect(shownLines()).toEqual([
      `${formatDateNumeric(today())}first draft`,
      `${formatDateNumeric(daysAgo(1))}outline done`,
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

  it('a draft’s status updates show as pending (a converted note line’s Details)', () => {
    const update = { date: daysAgo(3), text: 'asked finance', createdAt: new Date() }
    renderCreate({ title: 'Budget', urgent: false, important: false, focus: false, personIds: [], newPeople: [], tagIds: [], newTags: [], statusUpdates: [update] })
    expect(shownLines()).toEqual([`${formatDateNumeric(daysAgo(3))}asked finance`])
  })
})

describe('TaskEditPopup — the Add update popover', () => {
  it('opens from the button, Esc closes it — not the editor — and hands the focus back', async () => {
    await openStored()
    expect(screen.queryByRole('textbox', { name: 'New status update' })).toBeNull()
    fireEvent.click(addButton())
    expect(addButton()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(addField(), { target: { value: 'not this one' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Escape' }) })
    expect(screen.queryByRole('dialog', { name: 'Add a status update' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(undefined))) })
    expect(addButton()).toHaveFocus()
    expect(await db.statusUpdates.count()).toBe(0)
  })

  it('Add writes the update and closes the popover; Cancel writes nothing', async () => {
    await openStored()
    fireEvent.change(addField(), { target: { value: 'via the button' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    await vi.waitFor(async () => expect(await storedTexts()).toEqual([[formatDateNumeric(today()), 'via the button']]))
    expect(screen.queryByRole('dialog', { name: 'Add a status update' })).toBeNull()

    fireEvent.change(addField(), { target: { value: 'never mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Add a status update' })).toBeNull()
    expect(await db.statusUpdates.count()).toBe(1)
  })

  it('no ⏎ hint under the day field', async () => {
    await openStored()
    addField()
    expect(screen.getByRole('dialog', { name: 'Add a status update' })).not.toHaveTextContent('adds the update')
  })
})
