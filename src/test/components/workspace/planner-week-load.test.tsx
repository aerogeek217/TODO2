import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import type { MenuItemEntry } from '../../../components/shared/MenuPopover'
import { usePlannerMenuEntries } from '../../../components/workspace/planner/planner-reset'
import { PlannerWidget } from '../../../components/workspace/planner/PlannerWidget'
import { WeekLoadMeter } from '../../../components/workspace/planner/WeekLoadMeter'
import { WeekLoadHost } from '../../../components/workspace/planner/WeekLoadPopover'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../../models'
import type { PlannerTab } from '../../../models/workspace-layout'
import { usePlannerStore } from '../../../stores/planner-store'
import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useTodoStore } from '../../../stores/todo-store'
import { trendEventsKey, useTrendEventsStore } from '../../../stores/trend-events-store'
import { getByTooltip, makeTodo } from '../../helpers'

/**
 * The week load's meter and popover in JSDOM: the meter's numbers and name;
 * the popover's header, pills, words and day columns for a past week, this
 * week and a week ahead; stepping to either end; Week load… in the widget's
 * ⋯ menu where there is no top line. Weeks start on Monday; now is
 * Wednesday Nov 25, 2026, 14:00 — this week Nov 23 – 29.
 *
 * The data: 4 completions (no dates) every one of the 8 weeks before this
 * one — the usual week is 4. Last week: one due date done, one moved on its
 * day to Dec 1. This week: Monday's due date late, Tuesday's done, Friday's
 * due date, Thursday's follow-up and Saturday's plan ahead. Next week: the
 * moved due date and a plan.
 */

const NOW = new Date(2026, 10, 25, 14, 0)
const TODAY = new Date(2026, 10, 25)
const OLD = new Date(2026, 8, 1, 9, 0)
const nov = (d: number, h = 0) => new Date(2026, 10, d, h)
const iso = (d: Date) => d.toISOString()
const PLANNER: PlannerTab = { id: 'plan', kind: 'planner', config: {} }

let seq = 0
const ev = (todoId: number, type: TodoEventType, at: Date, fromValue: string | null = null, toValue: string | null = null): TodoEvent =>
  ({ id: ++seq, todoId, type, fromValue, toValue, timestamp: iso(at) })
const task = (o: Partial<PersistedTodoItem> & { id: number }) => makeTodo({ createdAt: OLD, modifiedAt: OLD, ...o })

function data(): { tasks: PersistedTodoItem[]; events: TodoEvent[] } {
  const tasks: PersistedTodoItem[] = []
  const events: TodoEvent[] = []
  // The usual week: 4 completions in each of the 8 weeks before this one (Sep 28 – Nov 22), Mondays and Tuesdays.
  let id = 100
  for (let w = 0; w < 8; w++) {
    for (let i = 0; i < 4; i++) {
      const at = new Date(2026, 8, 28 + w * 7 + (i % 2), 10)
      tasks.push(task({ id: ++id, isCompleted: true, completedAt: at }))
      events.push(ev(id, 'completed', at))
    }
  }
  // Last week.
  tasks.push(task({ id: 1, title: 'Done Wed', dueDate: nov(18), isCompleted: true, completedAt: nov(18, 9) }))
  events.push(ev(1, 'completed', nov(18, 9)))
  tasks.push(task({ id: 2, title: 'Moved to Dec 1', dueDate: new Date(2026, 11, 1) }))
  events.push(ev(2, 'deadline', nov(19, 12), iso(nov(19)), iso(new Date(2026, 11, 1))))
  // This week.
  tasks.push(task({ id: 3, title: 'Late Monday', dueDate: nov(23) }))
  tasks.push(task({ id: 4, title: 'Done Tuesday', dueDate: nov(24), isCompleted: true, completedAt: nov(24, 10) }))
  events.push(ev(4, 'completed', nov(24, 10)))
  tasks.push(task({ id: 5, title: 'Due Friday', dueDate: nov(27) }))
  tasks.push(task({ id: 6, title: 'Chase Thursday', nextFollowupAt: nov(26) }))
  tasks.push(task({ id: 7, title: 'Planned Saturday', doDate: nov(28) }))
  // Next week.
  tasks.push(task({ id: 8, title: 'Planned Wednesday', doDate: new Date(2026, 11, 2) }))
  return { tasks, events }
}

function seed(): void {
  const { tasks, events } = data()
  useTodoStore.setState({ todos: tasks })
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('week-load', TODAY, 1), { events, stale: false, loading: false }]]),
    generation: 0,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // Planned days recorded from today: every week before it carries the note.
  useSettingsStore.setState({ weekStartsOn: 1, planLogSince: nov(25, 8), historyLogSince: OLD })
  useStatusUpdateStore.setState({ loaded: true, byTodo: new Map() })
  seed()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const popover = () => screen.getByRole('dialog', { name: 'Week load' })
const title = () => within(popover()).getByTestId('week-load-title').textContent
const pills = () => [...popover().querySelectorAll('[data-testid="week-load-slip"], [data-testid="week-load-pill"]')].map((p) => p.textContent)
const words = () => within(popover()).getByTestId('week-load-words').textContent
const notes = () => within(popover()).queryAllByTestId('week-load-note').map((n) => n.textContent)
const dayNames = () => within(popover()).getAllByRole('group').map((d) => d.getAttribute('aria-label'))
const step = (name: 'Previous week' | 'Next week', times = 1) => {
  for (let i = 0; i < times; i++) fireEvent.click(within(popover()).getByRole('button', { name }))
}

describe('the meter', () => {
  it('shows this week’s dates against the usual week: the bar in the kinds’ colors, `5 / 4`, named in words', () => {
    render(<WeekLoadMeter />)
    const meter = screen.getByRole('button', { name: 'This week: 5 dates, usual 4' })
    expect(meter).toHaveTextContent('5 / 4')
    expect(getByTooltip(document.body, 'This week: 5 dates, usual 4')).toBe(meter)
    expect(meter).toHaveAttribute('aria-expanded', 'false')
    // Three due dates, a follow-up and a plan; the scale is the larger of 5 and 1.5 × 4 = 6.
    const parts = [...meter.querySelectorAll<HTMLElement>('[style*="width"]')].map((p) => p.style.width)
    expect(parts.map((w) => Number.parseFloat(w).toFixed(1))).toEqual(['50.0', '16.7', '16.7'])
    const mark = meter.querySelector<HTMLElement>('[style*="left"]')!
    expect(Number.parseFloat(mark.style.left)).toBeCloseTo((100 * 4) / 6)
  })

  it('draws nothing until the events are read', () => {
    useTrendEventsStore.setState({ entries: new Map([[trendEventsKey('week-load', TODAY, 1), { events: null, stale: false, loading: true }]]), generation: 0 })
    const { container } = render(<WeekLoadMeter />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a click opens the popover on this week and closes it again; Esc closes it and hands the focus back', () => {
    render(<WeekLoadMeter />)
    const meter = screen.getByRole('button', { name: /^This week/ })
    fireEvent.click(meter)
    expect(meter).toHaveAttribute('aria-expanded', 'true')
    expect(title()).toBe('This week · Nov 23 – 29')
    expect(popover()).toHaveFocus()
    fireEvent.click(meter)
    expect(screen.queryByRole('dialog', { name: 'Week load' })).toBeNull()
    fireEvent.click(meter)
    step('Previous week')
    fireEvent.keyDown(popover(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Week load' })).toBeNull()
    expect(meter).toHaveFocus()
    // It opens on this week again.
    fireEvent.click(meter)
    expect(title()).toBe('This week · Nov 23 – 29')
  })
})

describe('the popover', () => {
  const open = () => {
    render(<WeekLoadMeter />)
    fireEvent.click(screen.getByRole('button', { name: /^This week/ }))
  }

  it('this week: done so far filled, the rest still ahead; the slipped share of what has closed', () => {
    open()
    expect(within(popover()).getByTestId('week-load-count')).toHaveTextContent('5')
    expect(popover()).toHaveTextContent('dates · usual 4')
    expect(pills()).toEqual(['50% slipped', '1 over usual'])
    expect(words()).toBe('3 still ahead this week; 1 slipped so far (1 late).')
    expect(dayNames()).toEqual([
      'Mon, Nov 23: 1 due (1 late)',
      'Tue, Nov 24: 1 due (1 done)',
      'Wed, Nov 25: nothing',
      'Thu, Nov 26: 1 follow-up (1 ahead)',
      'Fri, Nov 27: 1 due (1 ahead)',
      'Sat, Nov 28: 1 planned (1 ahead)',
      'Sun, Nov 29: nothing',
    ])
    expect(popover()).toHaveTextContent('Slipped or ahead')
    expect(notes()).toEqual(['Planned days are recorded from Nov 25'])
    // Today's weekday and date in the accent.
    expect(popover().querySelector('[data-today][aria-hidden="true"]')).toHaveTextContent('We25')
    // A box per kind, its two parts as tall as their shares: Tuesday's due box all done, Monday's all slipped.
    const parts = (day: number) => [...within(popover()).getAllByRole('group')[day]!.querySelectorAll<HTMLElement>('[data-kind="due"] [data-week-load-part]')]
      .map((b) => [b.dataset.weekLoadPart, b.style.flexBasis])
    expect(parts(1)).toEqual([['done', '100%']])
    expect(parts(0)).toEqual([['rest', '100%']])
  })

  it('a box’s part, named in words, opens the task dialog on its tasks and closes the popover', () => {
    const showTaskDialog = vi.fn()
    useUIStore.setState({ showTaskDialog })
    open()
    const monday = within(popover()).getAllByRole('group')[0]!
    const slipped = within(monday).getByRole('button', { name: 'Mon, Nov 23 · 1 due: 1 late. Show the tasks' })
    fireEvent.click(slipped)
    expect(screen.queryByRole('dialog', { name: 'Week load' })).toBeNull()
    const payload = showTaskDialog.mock.calls[0]![0] as TaskDialogPayload
    expect(payload.title).toBe('Due · Mon, Nov 23')
    expect(payload.description).toBe('Tasks whose due dates on Mon, Nov 23 slipped.')
    expect(payload.source).toEqual({ kind: 'groups', groups: [{ key: 'late', label: 'Late', todoIds: [expect.any(Number)] }] })
    // The done part: its tasks as they are.
    fireEvent.click(screen.getByRole('button', { name: /^This week/ }))
    const tuesday = within(popover()).getAllByRole('group')[1]!
    fireEvent.click(within(tuesday).getByRole('button', { name: 'Tue, Nov 24 · 1 due done. Show the tasks' }))
    const done = showTaskDialog.mock.calls[1]![0] as TaskDialogPayload
    expect(done.title).toBe('Due · Tue, Nov 24')
    expect(done.source).toEqual({ kind: 'todos', todoIds: [expect.any(Number)] })
    // A day to come: what is still ahead.
    fireEvent.click(screen.getByRole('button', { name: /^This week/ }))
    const friday = within(popover()).getAllByRole('group')[4]!
    expect(within(friday).getByRole('button', { name: 'Fri, Nov 27 · 1 due ahead. Show the tasks' })).toBeInTheDocument()
  })

  it('a past week: its record, what slipped and how', () => {
    open()
    step('Previous week')
    expect(title()).toBe('Last week · Nov 16 – 22')
    expect(pills()).toEqual(['50% slipped', 'Room for 2'])
    expect(words()).toBe('1 of 2 slipped: 1 moved.')
    expect(dayNames()[2]).toBe('Wed, Nov 18: 1 due (1 done)')
    expect(dayNames()[3]).toBe('Thu, Nov 19: 1 due (1 moved)')
    expect(popover()).toHaveTextContent('Slipped')
    expect(popover()).not.toHaveTextContent('Slipped or ahead')
    expect(notes()).toEqual(['Planned days are recorded from Nov 25'])
  })

  it('a week ahead: what is set, no slipped share', () => {
    open()
    step('Next week')
    expect(title()).toBe('Next week · Nov 30 – Dec 6')
    expect(pills()).toEqual(['Room for 2'])
    expect(words()).toBe('Room for 2 more before your usual week.')
    expect(dayNames()[1]).toBe('Tue, Dec 1: 1 due (1 ahead)')
    expect(dayNames()[2]).toBe('Wed, Dec 2: 1 planned (1 ahead)')
    expect(popover()).toHaveTextContent('Ahead')
    expect(notes()).toEqual([])
    step('Next week')
    expect(title()).toBe('In 2 weeks · Dec 7 – 13')
  })

  it('steps back 8 weeks and ahead 6, its arrows inert at either end', () => {
    open()
    step('Previous week', 8)
    expect(title()).toBe('8 weeks ago · Sep 28 – Oct 4')
    expect(within(popover()).getByRole('button', { name: 'Previous week' })).toBeDisabled()
    expect(words()).toBe('Nothing slipped.')
    step('Previous week')
    expect(title()).toBe('8 weeks ago · Sep 28 – Oct 4')
    step('Next week', 14)
    expect(title()).toBe('In 6 weeks · Jan 4 – 10')
    expect(within(popover()).getByRole('button', { name: 'Next week' })).toBeDisabled()
    expect(within(popover()).getByRole('button', { name: 'Previous week' })).toBeEnabled()
    // The arrow gone inert keeps the focus in the popover.
    expect(popover()).toHaveFocus()
    step('Previous week', 3)
    expect(title()).toBe('In 3 weeks · Dec 14 – 20')
  })

  it('reads the usual week whole: a half rounds up, the words agree with the shown number', () => {
    // A ninth completion in one week: weeks of 4, 4, 4, 4, 5, 5, 5, 5 → median 4.5, shown as 5.
    const { tasks, events } = data()
    for (const w of [4, 5, 6, 7]) {
      const at = new Date(2026, 8, 28 + w * 7 + 3, 10)
      tasks.push(task({ id: 900 + w, isCompleted: true, completedAt: at }))
      events.push(ev(900 + w, 'completed', at))
    }
    useTodoStore.setState({ todos: tasks })
    useTrendEventsStore.setState({ entries: new Map([[trendEventsKey('week-load', TODAY, 1), { events, stale: false, loading: false }]]), generation: 0 })
    open()
    expect(screen.getByRole('button', { name: 'This week: 5 dates, usual 5' })).toBeInTheDocument()
    expect(pills()).toEqual(['50% slipped', 'At usual'])
  })
})

describe('Week load… in the widget’s ⋯ menu', () => {
  const tabs = () => render(
    <DndContext>
      <WidgetFaceContext.Provider value={{ forced: 'large' }}>
        <PlannerWidget tab={PLANNER} />
      </WidgetFaceContext.Provider>
      <WeekLoadHost />
    </DndContext>,
  )

  it('is next to Reset plan ›; with no top line (a cell of tabs) the meter is a bar across the top, and it opens the popover beside the widget', () => {
    tabs()
    expect(document.querySelector('[data-week-load-meter]')).toBeNull()
    const bar = document.querySelector<HTMLElement>('[data-week-load-bar]')!
    expect(bar).toHaveAccessibleName('This week: 5 dates, usual 4')
    expect(bar).not.toHaveAttribute('data-alone')
    fireEvent.click(bar)
    expect(title()).toBe('This week · Nov 23 – 29')
    fireEvent.click(bar)
    expect(screen.queryByRole('dialog', { name: 'Week load' })).toBeNull()
    const { result } = renderHook(() => usePlannerMenuEntries(PLANNER))
    expect(result.current.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['Unplanned filter…', 'Week load…', 'Reset plan'])
    const entry = result.current.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === 'Week load…')!
    act(() => { entry.onSelect!() })
    expect(usePlannerStore.getState().weekLoadTabId).toBe('plan')
    expect(title()).toBe('This week · Nov 23 – 29')
    expect(popover()).toHaveFocus()
    fireEvent.keyDown(popover(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Week load' })).toBeNull()
    expect(usePlannerStore.getState().weekLoadTabId).toBeNull()
  })

  it('alone in its cell the meter sits in the top line, before Reset plan', () => {
    const controls: CellControlsValue = {
      cellId: 'c', tabs: [PLANNER], tabId: 'plan', title: 'Planner', touch: false, setMoreButton: () => undefined, menuOpen: false,
      onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
    }
    render(<DndContext><CellControlsContext.Provider value={controls}><PlannerWidget tab={PLANNER} /></CellControlsContext.Provider></DndContext>)
    const meter = document.querySelector<HTMLElement>('[data-week-load-meter]')!
    expect(meter).toHaveAccessibleName('This week: 5 dates, usual 4')
    const reset = screen.getByRole('button', { name: 'Reset plan' })
    expect(meter.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The bar is there for a narrow widget only (`data-alone`: the stylesheet shows it at 540px or less).
    expect(document.querySelector('[data-week-load-bar]')).toHaveAttribute('data-alone')
  })
})
