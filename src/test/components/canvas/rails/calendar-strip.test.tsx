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

  it('places tasks with both scheduled + deadline on the scheduled day (not min)', () => {
    // Regression: previously used effectiveDate = min(sched, due), which
    // clamped the card back to the deadline after a drag-past-deadline
    // (making the reschedule look like it didn't happen). Now matches
    // CalendarView: scheduled ?? deadline.
    const today = new Date(2026, 3, 19)
    const todos = [
      makeTodo({
        id: 20,
        title: 'Slips past deadline',
        scheduledDate: { kind: 'date', value: new Date(2026, 3, 17) }, // Fri
        dueDate: new Date(2026, 3, 15), // Wed — earlier than scheduled
      }),
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
    const friRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 17))}"]`)
    const wedRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 15))}"]`)
    expect(friRow?.textContent).toContain('Slips past deadline')
    expect(wedRow?.textContent).not.toContain('Slips past deadline')
  })

  it('places tasks on the scheduled day when only scheduledDate is set, deadline day when only dueDate', () => {
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

  it('renders the range bar only when onWeekOffsetChange is provided', () => {
    const today = new Date(2026, 3, 19)
    const { rerender } = render(
      <CalendarStrip
        todos={[]}
        today={today}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(document.querySelector('[data-testid="calendar-range-bar"]')).toBeNull()
    rerender(
      <CalendarStrip
        todos={[]}
        today={today}
        onWeekOffsetChange={() => {}}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(document.querySelector('[data-testid="calendar-range-bar"]')).toBeTruthy()
  })

  it('range bar nav buttons call onWeekOffsetChange with the new offset', () => {
    const today = new Date(2026, 3, 19)
    const onChange = vi.fn()
    render(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={2}
        onWeekOffsetChange={onChange}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    fireEvent.click(screen.getByLabelText('Previous week'))
    fireEvent.click(screen.getByLabelText('Next week'))
    fireEvent.click(screen.getByText('Today'))
    expect(onChange).toHaveBeenNthCalledWith(1, 1)
    expect(onChange).toHaveBeenNthCalledWith(2, 3)
    expect(onChange).toHaveBeenNthCalledWith(3, 0)
  })

  it('Today button appears only off-week; This wk hint appears only on-week', () => {
    const today = new Date(2026, 3, 19)
    const { rerender } = render(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={0}
        onWeekOffsetChange={() => {}}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(screen.queryByText('Today')).toBeNull()
    expect(screen.getByText('This wk')).toBeTruthy()
    rerender(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={-1}
        onWeekOffsetChange={() => {}}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.queryByText('This wk')).toBeNull()
  })

  it('range label formats same-month and cross-month ranges', () => {
    // Sunday 2026-04-19 → Monday of week = Apr 13; weekOffset 0 = Apr 13–19.
    const today = new Date(2026, 3, 19)
    const { rerender } = render(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={0}
        onWeekOffsetChange={() => {}}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(screen.getByText('Apr 13 – 19')).toBeTruthy()
    // weekOffset 2 from today's week: Mon Apr 27 – Sun May 3.
    rerender(
      <CalendarStrip
        todos={[]}
        today={today}
        weekOffset={2}
        onWeekOffsetChange={() => {}}
        assignedPeopleMap={new Map()}
        assignedOrgsMap={new Map()}
        statuses={[]}
      />,
    )
    expect(screen.getByText('Apr 27 – May 3')).toBeTruthy()
  })

  describe('drag-to-reschedule', () => {
    function makeDataTransfer(): DataTransfer {
      const store = new Map<string, string>()
      return {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: (format: string, data: string) => { store.set(format, data) },
        getData: (format: string) => store.get(format) ?? '',
        clearData: () => store.clear(),
        items: [] as unknown as DataTransferItemList,
        files: [] as unknown as FileList,
        types: [] as unknown as readonly string[],
        setDragImage: () => {},
      } as unknown as DataTransfer
    }

    it('is inert (non-draggable, no drop handlers) when no onReschedule is provided', () => {
      const today = new Date(2026, 3, 19)
      const todos = [makeTodo({ id: 10, title: 'T', dueDate: new Date(2026, 3, 17) })]
      render(
        <CalendarStrip
          todos={todos}
          today={today}
          assignedPeopleMap={new Map()}
          assignedOrgsMap={new Map()}
          statuses={[]}
        />,
      )
      const evt = document.querySelector('[class*="event"]:not([class*="emptyDash"])') as HTMLElement | null
      expect(evt?.getAttribute('draggable')).toBeFalsy()
    })

    it('forwards todoId + target day to onReschedule when an event is dragged to another row', () => {
      const today = new Date(2026, 3, 19)
      const todos = [makeTodo({ id: 11, title: 'Drag me', dueDate: new Date(2026, 3, 17) })]
      const onReschedule = vi.fn()
      render(
        <CalendarStrip
          todos={todos}
          today={today}
          assignedPeopleMap={new Map()}
          assignedOrgsMap={new Map()}
          statuses={[]}
          onReschedule={onReschedule}
        />,
      )
      const sourceEvent = screen.getByText('Drag me').closest('[class*="event"]') as HTMLElement
      expect(sourceEvent.getAttribute('draggable')).toBe('true')
      const targetRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 15))}"]`) as HTMLElement
      const dt = makeDataTransfer()
      fireEvent.dragStart(sourceEvent, { dataTransfer: dt })
      fireEvent.dragOver(targetRow, { dataTransfer: dt })
      expect(targetRow.getAttribute('data-drop-target')).toBe('true')
      fireEvent.drop(targetRow, { dataTransfer: dt })
      expect(onReschedule).toHaveBeenCalledTimes(1)
      const [todoId, day] = onReschedule.mock.calls[0]
      expect(todoId).toBe(11)
      expect(dayKey(day as Date)).toBe(dayKey(new Date(2026, 3, 15)))
    })

    it('virtual recurring rows drag their parent todo id', () => {
      const today = new Date(2026, 3, 19)
      // Monday Apr 13 parent due; weekly recurrence → Apr 20 virtual at weekOffset=1.
      const todos = [
        makeTodo({
          id: 42,
          title: 'Weekly sync',
          dueDate: new Date(2026, 3, 13),
          recurrenceRule: { type: 'weekly' },
        }),
      ]
      const onReschedule = vi.fn()
      render(
        <CalendarStrip
          todos={todos}
          today={today}
          weekOffset={1}
          assignedPeopleMap={new Map()}
          assignedOrgsMap={new Map()}
          statuses={[]}
          onReschedule={onReschedule}
        />,
      )
      const virtualRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 20))}"]`) as HTMLElement
      const virtualEvent = virtualRow.querySelector('[class*="eventVirtual"]') as HTMLElement
      expect(virtualEvent.getAttribute('draggable')).toBe('true')
      const targetRow = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 22))}"]`) as HTMLElement
      const dt = makeDataTransfer()
      fireEvent.dragStart(virtualEvent, { dataTransfer: dt })
      fireEvent.dragOver(targetRow, { dataTransfer: dt })
      fireEvent.drop(targetRow, { dataTransfer: dt })
      expect(onReschedule).toHaveBeenCalledWith(42, expect.any(Date))
    })

    it('horizontal mode columns also accept drops', () => {
      const today = new Date(2026, 3, 19)
      const todos = [makeTodo({ id: 12, title: 'H-drag', dueDate: new Date(2026, 3, 17) })]
      const onReschedule = vi.fn()
      render(
        <CalendarStrip
          todos={todos}
          today={today}
          orientation="horizontal"
          assignedPeopleMap={new Map()}
          assignedOrgsMap={new Map()}
          statuses={[]}
          onReschedule={onReschedule}
        />,
      )
      const sourceEvent = screen.getByText('H-drag').closest('[class*="event"]') as HTMLElement
      const targetCol = document.querySelector(`[data-day="${dayKey(new Date(2026, 3, 14))}"]`) as HTMLElement
      const dt = makeDataTransfer()
      fireEvent.dragStart(sourceEvent, { dataTransfer: dt })
      fireEvent.dragOver(targetCol, { dataTransfer: dt })
      expect(targetCol.getAttribute('data-drop-target')).toBe('true')
      fireEvent.drop(targetCol, { dataTransfer: dt })
      expect(onReschedule).toHaveBeenCalledWith(12, expect.any(Date))
    })
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
