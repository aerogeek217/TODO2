import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TaskEditPopup } from '../../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../../components/task/TaskEditPopupHost'
import { ReviewCard } from '../../../components/review/ReviewCard'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import { createReviewSession } from '../../../stores/review-session'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { db } from '../../../data/database'
import type { PersistedTodoItem } from '../../../models'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { makeTodo, resetDb } from '../../helpers'

/**
 * **Planned**, the task layout's last fact (`task/PlannedFacts`): its
 * states (not planned, a planned day, after a real date, missed) in
 * a typed date field like the follow-ups' — a day typed or picked plans it
 * outright, the due day too, as the plan write (no stamp, one undo step);
 * a day before today refused —, the fixes, × Clear plan, an open editor
 * following a plan changed elsewhere, the create mode's plan held until
 * Create, and the review card sharing the cell and the Due field.
 */

// Fri 20 Nov 2026.
const day = (n: number) => new Date(2026, 10, 20 + n)
const STAMP = new Date(2026, 9, 1, 12)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 20, 9))
  HTMLInputElement.prototype.showPicker = vi.fn()
  useSettingsStore.setState({ rowDates: 'numeric' })
  await resetDb()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function openStored(over: Partial<PersistedTodoItem> = {}) {
  const todo = makeTodo({ id: 7, uid: 'u7', title: 'Vendor contract renewal', modifiedAt: STAMP, ...over })
  await db.todos.add(todo)
  useTodoStore.setState({ todos: [todo] })
  act(() => useUIStore.getState().openEditPopup(todo.id))
  render(<TaskEditPopupHost />)
  await act(async () => { await Promise.resolve() })
  const dialog = screen.getByRole('dialog', { name: 'Edit task' })
  return { dialog, cell: () => dialog.querySelector('[data-fact="planned"]') as HTMLElement }
}

const stored = async () => (await db.todos.get(7))!
/** The cell's two lines: the field (or a completed task's words) and the words under it. */
const lines = (cell: HTMLElement) => {
  const value = cell.querySelector('[data-planned-state]') as HTMLElement
  return { first: value.firstElementChild as HTMLElement, under: value.lastElementChild as HTMLElement }
}
const field = (cell: HTMLElement) => within(cell).getByRole('textbox', { name: 'Planned' })
/** The field's words at rest (drawn over it). */
const words = (cell: HTMLElement) => cell.querySelector('[data-fact-date-field] > span[aria-hidden="true"]') as HTMLElement
const picker = (cell: HTMLElement) => cell.querySelector<HTMLInputElement>('input[type="date"]')!
const type = (cell: HTMLElement, text: string) => {
  fireEvent.focus(field(cell))
  fireEvent.change(field(cell), { target: { value: text } })
}

describe('the Planned cell’s states', () => {
  it('sits after Due, the band’s last cell, headed PLANNED', async () => {
    const { dialog, cell } = await openStored()
    const facts = Array.from(dialog.querySelectorAll('[data-task-facts] [data-fact]')).map((f) => f.getAttribute('data-fact'))
    expect(facts.slice(-2)).toEqual(['due', 'planned'])
    expect(cell()).toHaveAccessibleName('Planned')
  })

  it('not planned: a date field reading `Not planned`, its calendar; no ×', async () => {
    const { cell } = await openStored()
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'none')
    expect(words(cell())).toHaveTextContent(/^Not planned$/)
    expect(field(cell())).toHaveValue('')
    expect(within(cell()).getByRole('button', { name: 'Pick planned day' })).toBeInTheDocument()
    expect(within(cell()).queryByRole('button', { name: 'Clear plan' })).toBeNull()
    expect(cell().querySelector('[data-planned-flag]')).toBeNull()
    expect(lines(cell()).under).toBeEmptyDOMElement()
  })

  it('× only while the field holds a day: emptied, it goes', async () => {
    const { cell } = await openStored({ doDate: day(2) })
    expect(within(lines(cell()).first).getByRole('button', { name: 'Clear plan' })).toBeInTheDocument()
    type(cell(), '')
    expect(within(cell()).queryByRole('button', { name: 'Clear plan' })).toBeNull()
    expect(cell().querySelector('[data-planned-flag]')).toBeNull()
  })

  it('a planned day: the hollow bar and the day in the rows’ words with ×; how far it is under the field', async () => {
    const { cell } = await openStored({ doDate: day(3), dueDate: day(4) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'planned')
    expect(words(cell())).toHaveTextContent(/^11\/23$/)
    expect(words(cell()).querySelector('[class*="planBar"]')).not.toBeNull()
    expect(cell().querySelector('[data-fact-date-field]')).toHaveAttribute('data-tooltip', 'Monday, November 23, 2026')
    expect(field(cell())).toHaveValue('Mon 23 Nov')
    const { first, under } = lines(cell())
    expect(within(first).getByRole('button', { name: 'Clear plan' })).toBeInTheDocument()
    expect(under).toHaveTextContent(/^in 3 days$/)
    expect(under).toHaveAttribute('data-tooltip', 'in 3 days')
  })

  it('tomorrow: its words under the day', async () => {
    const { cell } = await openStored({ doDate: day(1) })
    expect(lines(cell()).under).toHaveTextContent(/^tomorrow$/)
  })

  it('after a real date: `N days after due` in the deadline color, opening the fixes', async () => {
    const { cell } = await openStored({ doDate: day(5), dueDate: day(3) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'late')
    const conflict = within(cell()).getByRole('button', { name: /^2 days after due/ })
    // Under the field, in place of its words; the day and × in the field.
    const { first, under } = lines(cell())
    expect(under).toContainElement(conflict)
    expect(under).toHaveTextContent(/^2 days after due▾$/)
    expect(words(cell())).toHaveTextContent(/^11\/25$/)
    expect(within(first).getByRole('button', { name: 'Clear plan' })).toBeInTheDocument()
    fireEvent.click(conflict)
    const menu = screen.getByRole('menu', { name: 'Fix the plan' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))).toEqual(['Move due date to Wed, Nov 25', 'Plan for Mon, Nov 23'])
  })

  it('missed: a day passed, muted, `N days ago · Delayed`', async () => {
    const { cell } = await openStored({ doDate: day(-3) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'missed')
    expect(words(cell())).toHaveTextContent(/^11\/17$/)
    expect(lines(cell()).under).toHaveTextContent(/^3 days ago · Delayed$/)
    expect(within(cell()).queryByRole('button', { name: /after due/ })).toBeNull()
  })

  it('a completed task’s plan shows, with nothing to set', async () => {
    const { cell } = await openStored({ doDate: day(2), isCompleted: true })
    expect(within(cell()).queryByRole('textbox')).toBeNull()
    expect(within(cell()).queryByRole('button')).toBeNull()
    expect(within(cell()).getByRole('img', { name: 'Planned: Sunday, November 22, 2026' })).toHaveTextContent('11/22')
  })
})

describe('setting the plan', () => {
  it('a typed day plans it outright — the due day too — with no stamp and one undo step', async () => {
    const { cell } = await openStored({ dueDate: day(4) })
    const steps = useUndoStore.getState().undoStack.length
    type(cell(), 'tue')
    expect(lines(cell()).under).toHaveTextContent('→ Tue 24 Nov · in 4 days')
    fireEvent.keyDown(field(cell()), { key: 'Enter' })
    fireEvent.blur(field(cell()))
    await waitFor(async () => expect((await stored()).doDate).toEqual(day(4)))
    expect(await stored()).toMatchObject({ dueDate: day(4), modifiedAt: STAMP })
    expect(useUndoStore.getState().undoStack).toHaveLength(steps + 1)
    // The cell shows it at once (the task as stored).
    await waitFor(() => expect(words(cell())).toHaveTextContent('11/24'))
    await act(async () => { await useUndoStore.getState().undo() })
    expect((await stored()).doDate).toBeUndefined()
    await waitFor(() => expect(words(cell())).toHaveTextContent('Not planned'))
  })

  it('a day before today is refused with a message and never written', async () => {
    const { cell } = await openStored({ doDate: day(2) })
    type(cell(), 'yesterday')
    expect(field(cell())).toHaveAttribute('aria-invalid', 'true')
    expect(lines(cell()).under).toHaveTextContent('Plan a day from today on')
    fireEvent.blur(field(cell()))
    await act(async () => { await Promise.resolve() })
    expect((await stored()).doDate).toEqual(day(2))
    expect(field(cell())).toHaveValue('yesterday')
  })

  it('the calendar opens the browser’s picker from today on; a pick plans that day', async () => {
    const { cell } = await openStored()
    fireEvent.click(within(cell()).getByRole('button', { name: 'Pick planned day' }))
    expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalledTimes(1)
    expect(picker(cell()).min).toBe('2026-11-20')
    fireEvent.change(picker(cell()), { target: { value: '2027-01-15' } })
    await waitFor(async () => expect((await stored()).doDate).toEqual(new Date(2027, 0, 15)))
    expect((await stored()).modifiedAt).toEqual(STAMP)
  })

  it('× clears a planned day with no stamp, and goes with it', async () => {
    const { cell } = await openStored({ doDate: day(2) })
    fireEvent.click(within(cell()).getByRole('button', { name: 'Clear plan' }))
    await waitFor(async () => expect((await stored()).doDate).toBeUndefined())
    await waitFor(() => expect(words(cell())).toHaveTextContent('Not planned'))
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'none')
    expect(within(cell()).queryByRole('button', { name: 'Clear plan' })).toBeNull()
    expect((await stored()).modifiedAt).toEqual(STAMP)
  })

  it('an emptied field clears the plan', async () => {
    const { cell } = await openStored({ doDate: day(2) })
    type(cell(), '')
    fireEvent.blur(field(cell()))
    await waitFor(async () => expect((await stored()).doDate).toBeUndefined())
  })

  it('a fix: Plan for the due day plans it there; Move due date is a real edit', async () => {
    const { cell } = await openStored({ doDate: day(5), dueDate: day(3) })
    fireEvent.click(within(cell()).getByRole('button', { name: /^2 days after due/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plan for Mon, Nov 23' }))
    await waitFor(async () => expect((await stored()).doDate).toEqual(day(3)))
    expect((await stored()).modifiedAt).toEqual(STAMP)
    await waitFor(() => expect(within(cell()).queryByRole('button', { name: /after due/ })).toBeNull())
  })

  it('an open editor shows a plan changed elsewhere', async () => {
    const { cell } = await openStored()
    await act(async () => { await useTodoStore.getState().setPlan([7], { day: day(2) }) })
    await waitFor(() => expect(words(cell())).toHaveTextContent('11/22'))
    await waitFor(() => expect(field(cell())).toHaveValue('Sun 22 Nov'))
    await act(async () => { await useTodoStore.getState().setPlan([7], null) })
    await waitFor(() => expect(words(cell())).toHaveTextContent(/^Not planned$/))
    expect(field(cell())).toHaveValue('')
  })
})

describe('create mode', () => {
  const renderCreate = (onCreate = vi.fn()) => {
    render(
      <TaskEditPopup mode="create" assignedPeople={[]} allPeople={[]} onClose={vi.fn()} onCreate={onCreate} onAssignPerson={vi.fn()} onUnassignPerson={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    return { dialog, cell: dialog.querySelector('[data-fact="planned"]') as HTMLElement }
  }

  it('holds a typed day until Create, which writes it with the task', async () => {
    const onCreate = vi.fn().mockResolvedValue(1)
    const { dialog, cell } = renderCreate(onCreate)
    type(cell, 'mon')
    fireEvent.blur(field(cell))
    expect(words(cell)).toHaveTextContent('11/23')
    expect(await db.todos.count()).toBe(0)
    fireEvent.change(within(dialog).getByPlaceholderText(/^New task/), { target: { value: 'Book the venue' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Book the venue', doDate: day(3) })
  })

  it('a pick sets the held plan; × clears it', () => {
    const { cell } = renderCreate()
    fireEvent.change(picker(cell), { target: { value: '2026-11-25' } })
    expect(words(cell)).toHaveTextContent('11/25')
    fireEvent.click(within(cell).getByRole('button', { name: 'Clear plan' }))
    expect(words(cell)).toHaveTextContent('Not planned')
    expect(within(cell).queryByRole('button', { name: 'Clear plan' })).toBeNull()
  })

  it('a Quick Add `/plan` handed to the editor seeds its Planned cell; the title drops the command', () => {
    useUIStore.setState({ quickAddDraft: { rawTitle: 'Book the venue /plan 11/24' } })
    const { dialog, cell } = renderCreate()
    expect(within(dialog).getByPlaceholderText(/^New task/)).toHaveValue('Book the venue')
    expect(words(cell)).toHaveTextContent('11/24')
  })
})

describe('the review card', () => {
  const renderCard = async (over: Partial<PersistedTodoItem> = {}) => {
    const todo = makeTodo({ id: 7, uid: 'u7', title: 'Vendor contract renewal', modifiedAt: STAMP, dueDate: day(4), ...over })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    useStatusUpdateStore.setState({ byTodo: new Map(), loaded: true })
    render(
      <ReviewSessionContext.Provider value={createReviewSession({ ids: [7], order: [7] })}>
        <ReviewCard todo={todo} />
      </ReviewSessionContext.Provider>,
    )
    return document.querySelector('[data-review-card]') as HTMLElement
  }

  it('shares the band: Planned after Due, a typed day planning the task', async () => {
    const card = await renderCard()
    const facts = Array.from(card.querySelectorAll('[data-task-facts] [data-fact]')).map((f) => f.getAttribute('data-fact'))
    expect(facts.slice(-2)).toEqual(['due', 'planned'])
    const cell = card.querySelector('[data-fact="planned"]') as HTMLElement
    type(cell, 'tue')
    fireEvent.blur(field(cell))
    await waitFor(async () => expect((await stored()).doDate).toEqual(day(4)))
    expect((await stored()).modifiedAt).toEqual(STAMP)
  })

  it('shares the Due field: its ↻ opens the repeat popover, whose repeat writes the task, one undo step', async () => {
    const card = await renderCard()
    const due = card.querySelector('[data-fact="due"]') as HTMLElement
    expect(due.querySelector('[data-date-under]')).toHaveTextContent('in 4 days')
    expect(due.querySelector('[data-repeat-field]')).toBeNull()
    const steps = useUndoStore.getState().undoStack.length
    fireEvent.click(within(due).getByRole('button', { name: 'Repeat' }))
    const repeat = within(screen.getByRole('dialog', { name: 'Repeat' })).getByRole('textbox', { name: 'Repeat every' })
    fireEvent.change(repeat, { target: { value: '1w' } })
    fireEvent.keyDown(repeat, { key: 'Enter' })
    await waitFor(async () => expect((await stored()).recurrenceRule?.every).toEqual({ count: 1, unit: 'w' }))
    expect(useUndoStore.getState().undoStack.length).toBe(steps + 1)
    expect(document.querySelector('[data-repeat-popover]')).toBeNull()
  })

  it('shares the Due field: a typed date is written to the task', async () => {
    const card = await renderCard()
    const due = card.querySelector('[data-fact="due"]') as HTMLElement
    const input = within(due).getByRole('textbox', { name: 'Due date' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '11/30' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await stored()).dueDate).toEqual(new Date(2026, 10, 30)))
  })
})
