import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CalendarWidget } from '../../../components/workspace/calendar/CalendarWidget'
import { CalendarDropChooser } from '../../../components/workspace/calendar/CalendarDropChooser'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import type { CalendarTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { dayKey } from '../../../utils/date'

const TODAY = new Date(2026, 9, 14, 10) // Wed 14 Oct 2026
const day = (d: number, m = 9) => new Date(2026, m, d)

function layoutWith(tab: CalendarTab): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return {
    id: 1,
    name: 'Main',
    createdAt: now,
    modifiedAt: now,
    columns: [{ id: 'c1', weight: 1, cells: [{ id: 'x1', weight: 1, tabs: [tab] }] }],
  }
}

function calendarTab(over: Partial<CalendarTab> = {}): CalendarTab {
  return { id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: true } }, ...over }
}

/** Renders the calendar tab as the workspace store holds it (so config / view-state edits show). */
function Host() {
  const tab = useWorkspaceStore((s) => s.working?.columns[0]?.cells[0]?.tabs[0])
  return tab?.kind === 'calendar' ? <CalendarWidget tab={tab} /> : null
}

function setup(tab: CalendarTab = calendarTab()) {
  const layout = layoutWith(tab)
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  render(<DndContext><Host /></DndContext>)
}

const workingTab = () => useWorkspaceStore.getState().working?.columns[0]?.cells[0]?.tabs[0] as CalendarTab
const dayCell = (d: Date) => document.querySelector<HTMLElement>(`[data-day="${dayKey(d)}"]`)
const label = () => screen.getByTestId('calendar-range-label').textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ weekStartsOn: 1 })
  useUIStore.setState({ selectedTodoId: null, editPopupMode: null })
  useWorkspaceStore.setState({ layouts: [], activeLayoutId: null, working: null, saved: null, isDirty: false, hydrated: false })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Both dates', dueDate: day(16), nextFollowupAt: day(20), sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Late due', dueDate: day(12), sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Weekly', dueDate: day(5), recurrenceRule: { type: 'weekly' }, sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Done', dueDate: day(15), isCompleted: true, sortOrder: 4 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CalendarWidget', () => {
  it('month view by default: six weeks from the week start, an entry per shown date', () => {
    setup()
    expect(label()).toBe('October 2026')
    expect(document.querySelectorAll('[data-day]')).toHaveLength(42)
    expect(document.querySelector('[data-day]')?.getAttribute('data-day')).toBe(dayKey(day(28, 8)))
    expect(within(dayCell(day(16))!).getByText('Both dates').closest('[data-cal-entry]')?.getAttribute('data-cal-entry')).toBe('due')
    expect(within(dayCell(day(20))!).getByText('Both dates').closest('[data-cal-entry]')?.getAttribute('data-cal-entry')).toBe('followup')
    // Completed tasks show only with "Show completed".
    expect(within(dayCell(day(15))!).queryByText('Done')).toBeNull()
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(within(dayCell(day(15))!).getByText('Done')).toBeInTheDocument()
  })

  it('marks overdue entries and washes their past day; today gets the pill', () => {
    setup()
    expect(within(dayCell(day(12))!).getByText('Late due').closest('[data-cal-entry]')?.getAttribute('data-state')).toBe('due-overdue')
    expect(dayCell(day(12))!.className).toMatch(/washDue/)
    expect(dayCell(day(14))!.getAttribute('data-today')).toBe('true')
  })

  it('occurrences render but do not drag; the task’s own entry drags', () => {
    setup()
    const own = within(dayCell(day(5))!).getByText('Weekly').closest('[data-cal-entry]')!
    const occurrence = within(dayCell(day(19))!).getByText('Weekly').closest('[data-cal-entry]')!
    expect(own.getAttribute('aria-roledescription')).toBe('draggable')
    expect(occurrence.getAttribute('data-virtual')).toBe('true')
    expect(occurrence.getAttribute('aria-roledescription')).toBeNull()
    expect(occurrence.getAttribute('title')).toContain('Repeats every Monday')
  })

  it('clicking an entry (or an occurrence) opens the task', () => {
    setup()
    fireEvent.click(within(dayCell(day(19))!).getByText('Weekly'))
    expect(useUIStore.getState().selectedTodoId).toBe(3)
    expect(useUIStore.getState().editPopupMode).toBe('edit')
  })

  it('weeks follow the week-start setting', () => {
    useSettingsStore.setState({ weekStartsOn: 0 })
    setup()
    expect(document.querySelector('[data-day]')?.getAttribute('data-day')).toBe(dayKey(day(27, 8)))
  })

  it('date-type toggles are layout config (unsaved); both can be off', () => {
    setup()
    const group = screen.getByRole('group', { name: 'Date types shown' })
    fireEvent.click(within(group).getByRole('button', { name: /Due/ }))
    expect(workingTab().config.dateTypes).toEqual({ due: false, followup: true })
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    expect(within(dayCell(day(16))!).queryByText('Both dates')).toBeNull()
    expect(within(dayCell(day(20))!).getByText('Both dates')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: /Follow-up/ }))
    expect(workingTab().config.dateTypes).toEqual({ due: false, followup: false })
    expect(document.querySelectorAll('[data-cal-entry]')).toHaveLength(0)
    expect(screen.getByTestId('calendar-empty')).toHaveAttribute('data-empty', 'no-types')
    expect(screen.getByText('No date types shown')).toBeInTheDocument()
  })

  it('navigation and the view switch are view state (never unsaved)', async () => {
    setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next month' })) })
    expect(label()).toBe('November 2026')
    expect(workingTab().viewState).toEqual({ view: 'month', offset: 1 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Today' })) })
    expect(label()).toBe('October 2026')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Week' })) })
    expect(workingTab().viewState).toEqual({ view: 'week', offset: 0 })
    expect(label()).toBe('Oct 12 – 18, 2026')
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('an empty view says what it shows nothing of', () => {
    useTodoStore.setState({ todos: [] })
    setup(calendarTab({ config: { dateTypes: { due: false, followup: true } } }))
    expect(screen.getByTestId('calendar-empty').textContent).toContain('Nothing to follow up in October')
  })

  it('a screen filter hiding everything in view: counts them and offers to clear it', () => {
    setup()
    act(() => useFilterStore.getState().setSearchText('no such task'))
    const note = screen.getByTestId('calendar-empty')
    expect(note.textContent).toContain('No tasks match')
    // Both dates, Late due, Weekly (the completed task isn't shown anyway).
    expect(note.textContent).toContain('3 tasks in October are hidden by the screen filter.')
    fireEvent.click(within(note).getByRole('button', { name: 'Clear screen filter' }))
    expect(useFilterStore.getState().isActive).toBe(false)
    expect(screen.queryByTestId('calendar-empty')).toBeNull()
  })
})

describe('CalendarDropChooser', () => {
  function renderChooser(onDone: (t: unknown) => void) {
    const todo = makeTodo({ id: 9, title: 'Draft OKRs', dueDate: day(15) })
    render(<CalendarDropChooser todo={todo} date={day(13)} at={{ x: 100, y: 100 }} onDone={onDone} />)
    return screen.getByRole('menu', { name: 'Set which date' })
  }

  it('names the task and day, shows current values, Due date first and focused', () => {
    const menu = renderChooser(() => {})
    expect(menu.textContent).toContain('Set “Draft OKRs” for Tue 13 Oct')
    const [due, followup] = within(menu).getAllByRole('menuitem')
    expect(due?.textContent).toContain('was Thu 15')
    expect(followup?.textContent).toContain('not set')
    expect(document.activeElement).toBe(due)
  })

  it('D / F pick by key; Esc cancels', () => {
    const picks: unknown[] = []
    const menu = renderChooser((t) => picks.push(t))
    fireEvent.keyDown(menu, { key: 'f' })
    expect(picks[0]).toBe('followup')
    cleanup()
    const picks2: unknown[] = []
    const menu2 = renderChooser((t) => picks2.push(t))
    fireEvent.keyDown(menu2, { key: 'D' })
    expect(picks2[0]).toBe('due')
    cleanup()
    const picks3: unknown[] = []
    renderChooser((t) => picks3.push(t))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(picks3).toEqual([null])
  })
})
