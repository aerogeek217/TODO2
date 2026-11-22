import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TaskEditPopup } from '../../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../../components/task/TaskEditPopupHost'
import { ReviewCard } from '../../../components/review/ReviewCard'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import { PICK_DATE_ATTR } from '../../../components/shared/pick-date'
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
 * states (not planned, held, a planned day, after a real date, missed),
 * its Plan for day menu — a pick plans the day outright, the due day too,
 * as the plan write (no stamp, one undo step) —, Pick a date…, the fixes,
 * × Clear plan, an open editor following a plan changed elsewhere, and the
 * create mode's plan held until Create.
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
const openMenu = (cell: HTMLElement) => {
  fireEvent.click(within(cell).getByRole('button', { name: /^Planned:/ }))
  return screen.getByRole('menu', { name: 'Plan for day' })
}

describe('the Planned cell’s states', () => {
  it('sits after Due, the band’s last cell, headed PLANNED', async () => {
    const { dialog, cell } = await openStored()
    const facts = Array.from(dialog.querySelectorAll('[data-task-facts] [data-fact]')).map((f) => f.getAttribute('data-fact'))
    expect(facts.slice(-2)).toEqual(['due', 'planned'])
    expect(cell()).toHaveAccessibleName('Planned')
  })

  it('not planned: `Not planned`, a button opening the menu; no ×', async () => {
    const { cell } = await openStored()
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'none')
    expect(within(cell()).getByRole('button', { name: 'Planned: not planned' })).toHaveTextContent('Not planned')
    expect(within(cell()).queryByRole('button', { name: 'Clear plan' })).toBeNull()
    expect(cell().querySelector('[data-planned-flag]')).toBeNull()
  })

  it('held: `Held in Unplanned` with the corner flag', async () => {
    const { cell } = await openStored({ unplanned: true })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'held')
    expect(within(cell()).getByRole('button', { name: 'Planned: held in Unplanned' })).toHaveTextContent('Held in Unplanned')
    expect(cell().querySelector('[data-planned-flag]')).not.toBeNull()
    expect(within(cell()).getByRole('button', { name: 'Clear plan' })).toBeInTheDocument()
  })

  it('a planned day: the hollow bar, the day in the rows’ words and how far it is', async () => {
    const { cell } = await openStored({ doDate: day(3), dueDate: day(4) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'planned')
    const value = within(cell()).getByRole('button', { name: 'Planned: Monday, November 23, 2026' })
    expect(value).toHaveTextContent('11/23in 3 days')
    expect(value.querySelector('[class*="planBar"]')).not.toBeNull()
    expect(within(cell()).getByRole('button', { name: 'Clear plan' })).toBeInTheDocument()
  })

  it('after a real date: `N days after due` in the deadline color, opening the fixes', async () => {
    const { cell } = await openStored({ doDate: day(5), dueDate: day(3) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'late')
    const conflict = within(cell()).getByRole('button', { name: /^2 days after due/ })
    fireEvent.click(conflict)
    const menu = screen.getByRole('menu', { name: 'Fix the plan' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))).toEqual(['Move due date to Wed, Nov 25', 'Plan for Mon, Nov 23'])
  })

  it('missed: a day passed, muted, `N days ago · Delayed`', async () => {
    const { cell } = await openStored({ doDate: day(-3) })
    expect(cell().querySelector('[data-planned-state]')).toHaveAttribute('data-planned-state', 'missed')
    expect(within(cell()).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('11/173 days ago · Delayed')
    expect(within(cell()).queryByRole('button', { name: /after due/ })).toBeNull()
  })

  it('a completed task’s plan shows, with nothing to open', async () => {
    const { cell } = await openStored({ doDate: day(2), isCompleted: true })
    expect(within(cell()).queryByRole('button', { name: /^Planned:/ })).toBeNull()
    expect(cell()).toHaveTextContent('11/22')
  })
})

describe('the Plan for day menu', () => {
  it('lists the week’s days as today, then Pick a date…, Unplanned and Clear plan', async () => {
    const { cell } = await openStored({ doDate: day(1), dueDate: day(4) })
    const menu = openMenu(cell())
    expect(within(menu).getByText('Plans it for that day')).toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitemradio').map((m) => m.getAttribute('data-menu-label'))).toEqual([
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Unplanned',
    ])
    expect(within(menu).getByRole('menuitemradio', { name: /^Sat, Nov 21/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: /^Tue, Nov 24/ })).toHaveTextContent('due')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))).toEqual(['Pick a date…', 'Clear plan'])
  })

  it('a pick plans the day outright — the due day too — with no stamp and one undo step', async () => {
    const { cell } = await openStored({ dueDate: day(4) })
    const steps = useUndoStore.getState().undoStack.length
    fireEvent.click(within(openMenu(cell())).getByRole('menuitemradio', { name: /^Tue, Nov 24/ }))
    await waitFor(async () => expect((await stored()).doDate).toEqual(day(4)))
    expect(await stored()).toMatchObject({ dueDate: day(4), modifiedAt: STAMP })
    expect(useUndoStore.getState().undoStack).toHaveLength(steps + 1)
    // The cell shows it at once (the task as stored).
    await waitFor(() => expect(within(cell()).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('11/24'))
    await act(async () => { await useUndoStore.getState().undo() })
    expect((await stored()).doDate).toBeUndefined()
    await waitFor(() => expect(within(cell()).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('Not planned'))
  })

  it('Pick a date… plans any day from today on', async () => {
    const { cell } = await openStored()
    fireEvent.click(within(openMenu(cell())).getByRole('menuitem', { name: 'Pick a date…' }))
    const input = document.querySelector<HTMLInputElement>(`[${PICK_DATE_ATTR}]`)!
    expect(input.min).toBe('2026-11-20')
    fireEvent.change(input, { target: { value: '2027-01-15' } })
    await waitFor(async () => expect((await stored()).doDate).toEqual(new Date(2027, 0, 15)))
    expect((await stored()).modifiedAt).toEqual(STAMP)
  })

  it('Unplanned holds it; × clears the plan', async () => {
    const { cell } = await openStored({ dueDate: day(2) })
    fireEvent.click(within(openMenu(cell())).getByRole('menuitemradio', { name: 'Unplanned' }))
    await waitFor(async () => expect((await stored()).unplanned).toBe(true))
    await waitFor(() => expect(cell().querySelector('[data-planned-flag]')).not.toBeNull())
    fireEvent.click(within(cell()).getByRole('button', { name: 'Clear plan' }))
    await waitFor(async () => expect((await stored()).unplanned).toBeUndefined())
    expect((await stored()).modifiedAt).toEqual(STAMP)
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
    await waitFor(() => expect(within(cell()).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('11/22'))
    await act(async () => { await useTodoStore.getState().setPlan([7], 'unplanned') })
    await waitFor(() => expect(within(cell()).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('Held in Unplanned'))
  })
})

describe('create mode', () => {
  it('holds the plan until Create, which writes it with the task', async () => {
    const onCreate = vi.fn().mockResolvedValue(1)
    render(
      <TaskEditPopup mode="create" assignedPeople={[]} allPeople={[]} onClose={vi.fn()} onCreate={onCreate} onAssignPerson={vi.fn()} onUnassignPerson={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    const cell = dialog.querySelector('[data-fact="planned"]') as HTMLElement
    fireEvent.click(within(openMenu(cell)).getByRole('menuitemradio', { name: /^Mon, Nov 23/ }))
    expect(within(cell).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('11/23')
    fireEvent.change(within(dialog).getByPlaceholderText(/^New task/), { target: { value: 'Book the venue' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Book the venue', doDate: day(3) })
  })

  it('a Quick Add `/plan` handed to the editor seeds its Planned cell; the title drops the command', () => {
    useUIStore.setState({ quickAddDraft: { rawTitle: 'Book the venue /plan 11/24' } })
    render(
      <TaskEditPopup mode="create" assignedPeople={[]} allPeople={[]} onClose={vi.fn()} onCreate={vi.fn()} onAssignPerson={vi.fn()} onUnassignPerson={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByPlaceholderText(/^New task/)).toHaveValue('Book the venue')
    const cell = dialog.querySelector('[data-fact="planned"]') as HTMLElement
    expect(within(cell).getByRole('button', { name: /^Planned:/ })).toHaveTextContent('11/24')
  })
})

describe('the review card', () => {
  it('shares the band: Planned after Due, its menu planning the task', async () => {
    const todo = makeTodo({ id: 7, uid: 'u7', title: 'Vendor contract renewal', modifiedAt: STAMP, dueDate: day(4) })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    useStatusUpdateStore.setState({ byTodo: new Map(), loaded: true })
    render(
      <ReviewSessionContext.Provider value={createReviewSession({ ids: [7], order: [7] })}>
        <ReviewCard todo={todo} />
      </ReviewSessionContext.Provider>,
    )
    const card = document.querySelector('[data-review-card]') as HTMLElement
    const facts = Array.from(card.querySelectorAll('[data-task-facts] [data-fact]')).map((f) => f.getAttribute('data-fact'))
    expect(facts.slice(-2)).toEqual(['due', 'planned'])
    const cell = card.querySelector('[data-fact="planned"]') as HTMLElement
    fireEvent.click(within(openMenu(cell)).getByRole('menuitemradio', { name: /^Tue, Nov 24/ }))
    await waitFor(async () => expect((await stored()).doDate).toEqual(day(4)))
    expect((await stored()).modifiedAt).toEqual(STAMP)
  })
})
