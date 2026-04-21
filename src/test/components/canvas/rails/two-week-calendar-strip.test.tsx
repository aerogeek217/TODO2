import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import {
  TwoWeekCalendarStrip,
  STRIP_DAY_COUNT,
} from '../../../../components/canvas/rails/TwoWeekCalendarStrip'
import { makeTodo } from '../../../helpers'

function dayKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

describe('TwoWeekCalendarStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 19))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders 15 day rows from -2 to +12 offset', () => {
    const today = new Date(2026, 3, 19)
    render(<TwoWeekCalendarStrip todos={[]} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} />)
    const rows = document.querySelectorAll('[data-day]')
    expect(rows).toHaveLength(STRIP_DAY_COUNT)
    expect(STRIP_DAY_COUNT).toBe(15)
    // First row: today - 2 = Apr 17
    expect((rows[0] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 3, 17)))
    // Last row: today + 12 = May 1
    expect((rows[14] as HTMLElement).dataset.day).toBe(dayKey(new Date(2026, 4, 1)))
  })

  it('marks the today row with data-today and highlight class', () => {
    const today = new Date(2026, 3, 19)
    render(<TwoWeekCalendarStrip todos={[]} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} />)
    const todayRow = document.querySelector('[data-today="true"]') as HTMLElement | null
    expect(todayRow).toBeTruthy()
    expect(todayRow?.dataset.day).toBe(dayKey(today))
    expect(todayRow?.className).toMatch(/rowToday/)
  })

  it('places tasks on the day matching effectiveDate', () => {
    const today = new Date(2026, 3, 19)
    const todos = [
      makeTodo({ id: 1, title: 'Due Friday', dueDate: new Date(2026, 3, 24) }),
      makeTodo({ id: 2, title: 'Scheduled today', scheduledDate: { kind: 'date', value: today } }),
      makeTodo({ id: 3, title: 'Out of range', dueDate: new Date(2026, 5, 1) }),
    ]
    render(<TwoWeekCalendarStrip todos={todos} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} />)
    const fridayRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 24))}"]`)
    const todayRow = document.querySelector(`[data-day="${dayKey(today)}"]`)
    expect(fridayRow?.textContent).toContain('Due Friday')
    expect(todayRow?.textContent).toContain('Scheduled today')
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument()
  })

  it('shows virtual recurring instances in their future slots', () => {
    const today = new Date(2026, 3, 19)
    const todos = [
      makeTodo({
        id: 4,
        title: 'Weekly sync',
        dueDate: new Date(2026, 3, 20),
        recurrenceRule: { type: 'weekly' },
      }),
    ]
    render(<TwoWeekCalendarStrip todos={todos} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} />)
    // Primary (Apr 20) + next occurrence (Apr 27)
    const primaryRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 20))}"]`)
    const virtualRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 27))}"]`)
    expect(primaryRow?.textContent).toContain('Weekly sync')
    expect(virtualRow?.textContent).toContain('Weekly sync')
    const virtualEvent = virtualRow?.querySelector('[class*="eventVirtual"]')
    expect(virtualEvent).toBeTruthy()
  })

  it('shows a dash for empty days', () => {
    const today = new Date(2026, 3, 19)
    render(<TwoWeekCalendarStrip todos={[]} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} />)
    const dashes = document.querySelectorAll('[class*="emptyDash"]')
    expect(dashes.length).toBe(STRIP_DAY_COUNT)
  })

  it('invokes onOpenTodo when a task is clicked', () => {
    const today = new Date(2026, 3, 19)
    const onOpenTodo = vi.fn()
    const todos = [makeTodo({ id: 7, title: 'Clickable', dueDate: new Date(2026, 3, 20) })]
    render(<TwoWeekCalendarStrip todos={todos} today={today} assignedPeopleMap={new Map()} assignedOrgsMap={new Map()} statuses={[]} onOpenTodo={onOpenTodo} />)
    fireEvent.click(screen.getByText('Clickable'))
    expect(onOpenTodo).toHaveBeenCalledWith(7)
  })
})
