import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import {
  CalendarStrip,
  STRIP_DAY_COUNT,
} from '../../../../components/canvas/rails/CalendarStrip'
import { makeTodo } from '../../../helpers'

function dayKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

describe('CalendarStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Sunday — good stress test for Monday-anchoring (Sun rolls back to prior Mon).
    vi.setSystemTime(new Date(2026, 3, 19))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders 7 day cells anchored to Monday of today\'s week', () => {
    // 2026-04-19 is a Sunday; Monday of its week = 2026-04-13.
    const today = new Date(2026, 3, 19)
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const cells = document.querySelectorAll('[data-day]')
    expect(cells).toHaveLength(STRIP_DAY_COUNT)
    expect(STRIP_DAY_COUNT).toBe(7)
    expect((cells[0] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 3, 13)))
    expect((cells[6] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 3, 19)))
  })

  it('shifts the 7-day window by weekOffset', () => {
    const today = new Date(2026, 3, 19)
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={1}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const cells = document.querySelectorAll('[data-day]')
    expect((cells[0] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 3, 20)))
    expect((cells[6] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 3, 26)))
  })

  it('marks the today cell with data-today in vertical mode', () => {
    const today = new Date(2026, 3, 19)
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const todayCell = document.querySelector('[data-today="true"]') as HTMLElement | null
    expect(todayCell).toBeTruthy()
    expect(todayCell?.dataset.day).toBe(dayKey(today))
    expect(todayCell?.className).toMatch(/rowToday/)
  })

  it('renders 7 columns in horizontal mode with data-orientation set', () => {
    const today = new Date(2026, 3, 19)
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        orientation="horizontal"
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const root = document.querySelector('[data-orientation="horizontal"]')
    expect(root).toBeTruthy()
    const cols = root!.querySelectorAll('[data-day]')
    expect(cols).toHaveLength(STRIP_DAY_COUNT)
    const todayCol = root!.querySelector('[data-today="true"]') as HTMLElement | null
    expect(todayCol?.className).toMatch(/hColToday/)
  })

  it('places tasks on the day matching effectiveDate', () => {
    const today = new Date(2026, 3, 19)
    const todos = [
      // This week (Mon Apr 13 – Sun Apr 19): dueDate Apr 17 is visible.
      makeTodo({ id: 1, title: 'Due Friday', dueDate: new Date(2026, 3, 17) }),
      makeTodo({ id: 2, title: 'Scheduled today', scheduledDate: { kind: 'date', value: today } }),
      makeTodo({ id: 3, title: 'Out of range', dueDate: new Date(2026, 5, 1) }),
    ]
    render(
      <CalendarStrip
        todos={todos}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const fridayRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 17))}"]`)
    const todayRow = document.querySelector(`[data-day="${dayKey(today)}"]`)
    expect(fridayRow?.textContent).toContain('Due Friday')
    expect(todayRow?.textContent).toContain('Scheduled today')
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument()
  })

  it('shows virtual recurring instances in their future slots (within the window)', () => {
    const today = new Date(2026, 3, 19)
    // Parent due Mon Apr 13; weekly recurrence → next occurrences Apr 20, 27, ...
    // With weekOffset=1 we span Apr 20 – Apr 26, so the Apr 20 virtual should render.
    const todos = [
      makeTodo({
        id: 4,
        title: 'Weekly sync',
        dueDate: new Date(2026, 3, 13),
        recurrenceRule: { type: 'weekly' },
      }),
    ]
    render(
      <CalendarStrip
        todos={todos}
        today={today}
        weekOffset={1}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const virtualRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 20))}"]`)
    expect(virtualRow?.textContent).toContain('Weekly sync')
    const virtualEvent = virtualRow?.querySelector('[class*="eventVirtual"]')
    expect(virtualEvent).toBeTruthy()
  })

  it('shows a dash for empty days', () => {
    const today = new Date(2026, 3, 19)
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    const dashes = document.querySelectorAll('[class*="emptyDash"]')
    expect(dashes.length).toBe(STRIP_DAY_COUNT)
  })

  it('invokes onOpenTodo when a task is clicked', () => {
    const today = new Date(2026, 3, 19)
    const onOpenTodo = vi.fn()
    const todos = [makeTodo({ id: 7, title: 'Clickable', dueDate: new Date(2026, 3, 17) })]
    render(
      <CalendarStrip
        todos={todos}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
        onOpenTodo={onOpenTodo}
      />,
    )
    fireEvent.click(screen.getByText('Clickable'))
    expect(onOpenTodo).toHaveBeenCalledWith(7)
  })
})
