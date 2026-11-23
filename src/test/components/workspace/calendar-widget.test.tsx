import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CalendarWidget } from '../../../components/workspace/calendar/CalendarWidget'
import { CalendarDropChooser } from '../../../components/workspace/calendar/CalendarDropChooser'
import { dropLabel } from '../../../components/workspace/calendar/calendar-day'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import type { CalendarTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { dayKey } from '../../../utils/date'
import { single } from '../../helpers/layout-builders'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { WidgetFace } from '../../../utils/widget-face'
import { layoutSteps } from '../../helpers/layout-steps'

const TODAY = new Date(2026, 9, 14, 10) // Wed 14 Oct 2026
const day = (d: number, m = 9) => new Date(2026, m, d)

function layoutWith(tab: CalendarTab): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return {
    id: 1,
    sortOrder: 0, name: 'Main',
    createdAt: now,
    modifiedAt: now,
    ...single({ id: 'x1', tabs: [tab] }),
  }
}

/** A calendar tab; the month shows bars (titles on) unless `over` says otherwise. */
function calendarTab(over: Partial<CalendarTab> = {}): CalendarTab {
  return { id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: true, plan: false } }, viewState: { titles: true }, ...over }
}

/** Renders the calendar tab as the workspace store holds it (so config / view-state edits show). */
function Host() {
  const tab = useWorkspaceStore((s) => s.working?.cells[0]?.tabs[0])
  return tab?.kind === 'calendar' ? <CalendarWidget tab={tab} /> : null
}

function setup(tab: CalendarTab = calendarTab()) {
  const layout = layoutWith(tab)
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
  render(<DndContext><Host /></DndContext>)
}

const workingTab = () => useWorkspaceStore.getState().working?.cells[0]?.tabs[0] as CalendarTab
const dayCell = (d: Date) => document.querySelector<HTMLElement>(`[data-day="${dayKey(d)}"]`)
const label = () => screen.getByTestId('calendar-range-label').textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ weekStartsOn: 1 })
  useUIStore.setState({ selectedTodoId: null, editPopupMode: null })
  useWorkspaceStore.setState({ layouts: [], activeLayoutId: null, working: null, saved: null, writeFailed: false, hydrated: false })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Both dates', dueDate: day(16), nextFollowupAt: day(20), sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Late due', dueDate: day(12), sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Weekly', dueDate: day(5), recurrenceRule: { every: { count: 1, unit: 'w' as const } }, sortOrder: 3 }),
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

  it('marks overdue entries (their tick) without washing their past day; today gets the pill', () => {
    setup()
    expect(within(dayCell(day(12))!).getByText('Late due').closest('[data-cal-entry]')?.getAttribute('data-state')).toBe('due-overdue')
    expect(dayCell(day(12))!.className).not.toMatch(/washDue/)
    expect(dayCell(day(14))!.getAttribute('data-today')).toBe('true')
  })

  it('entries carry their date type (the bar colour) and their level (its strength)', () => {
    setup()
    const entry = (d: number, title: string) => within(dayCell(day(d))!).getByText(title).closest('[data-cal-entry]')!
    expect(entry(12, 'Late due').getAttribute('data-cal-entry')).toBe('due')
    expect(entry(12, 'Late due').getAttribute('data-level')).toBe('late')
    expect(entry(20, 'Both dates').getAttribute('data-cal-entry')).toBe('followup')
    expect(entry(20, 'Both dates').getAttribute('data-level')).toBe('later')
  })

  it('the week has no past-day wash either', () => {
    setup(calendarTab({ viewState: { view: 'week' } }))
    expect(dayCell(day(12))!.className).not.toMatch(/washDue|washFollowup/)
  })

  it('entries draw no date-type glyph: its bar colour says it', () => {
    setup()
    expect(document.querySelectorAll('[data-cal-entry]').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-cal-entry] [data-cal-entry-glyph]').length).toBe(0)
  })

  it('occurrences render but do not drag; the task’s own entry drags', () => {
    setup()
    const own = within(dayCell(day(5))!).getByText('Weekly').closest('[data-cal-entry]')!
    const occurrence = within(dayCell(day(19))!).getByText('Weekly').closest('[data-cal-entry]')!
    expect(own.getAttribute('aria-roledescription')).toBe('draggable')
    expect(occurrence.getAttribute('data-virtual')).toBe('true')
    expect(occurrence.getAttribute('aria-roledescription')).toBeNull()
    expect(occurrence.getAttribute('data-tooltip')).toContain('Every Mon. Click')
  })

  it('an entry’s tooltip is its title beside its date type’s bar, no Due / Next follow-up words', () => {
    setup()
    const entry = (d: number, title: string) => within(dayCell(day(d))!).getByText(title).closest('[data-cal-entry]')!
    expect(entry(16, 'Both dates')).toHaveAttribute('data-tooltip', 'Both dates')
    expect(entry(16, 'Both dates')).toHaveAttribute('data-tooltip-bar', 'var(--date-bar-due)')
    expect(entry(16, 'Both dates')).toHaveAttribute('data-tooltip-bar-label', 'Due')
    expect(entry(20, 'Both dates')).toHaveAttribute('data-tooltip-bar', 'var(--date-bar-followup)')
    expect(entry(20, 'Both dates')).toHaveAttribute('data-tooltip-bar-label', 'Next follow-up')
    expect(entry(12, 'Late due')).toHaveAttribute('data-tooltip', 'Late due · overdue')
  })

  it('a day’s date opens the day popover, as a full day’s ticks do — month and week; a day with nothing has no button', () => {
    setup()
    const date = within(dayCell(day(12))!).getByRole('button', { name: 'Mon 12 Oct: 2 tasks' })
    expect(date).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(date)
    const popover = screen.getByTestId('calendar-day-popover')
    expect(within(popover).getByText('Late due')).toBeInTheDocument()
    expect(within(popover).getByText('Weekly')).toBeInTheDocument()
    expect(date).toHaveAttribute('aria-expanded', 'true')
    // A second click closes it.
    fireEvent.click(date)
    expect(screen.queryByTestId('calendar-day-popover')).toBeNull()
    expect(within(dayCell(day(13))!).queryByRole('button', { name: /^Tue 13 Oct/ })).toBeNull()
    cleanup()
    setup(calendarTab({ viewState: { view: 'week' } }))
    fireEvent.click(within(dayCell(day(12))!).getByRole('button', { name: 'Mon 12 Oct: 2 tasks' }))
    expect(within(screen.getByTestId('calendar-day-popover')).getByText('Late due')).toBeInTheDocument()
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
    expect(workingTab().config.dateTypes).toEqual({ due: false, followup: true, plan: false })
    expect(layoutSteps()).not.toEqual([])
    expect(within(dayCell(day(16))!).queryByText('Both dates')).toBeNull()
    expect(within(dayCell(day(20))!).getByText('Both dates')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: /Follow-up/ }))
    expect(workingTab().config.dateTypes).toEqual({ due: false, followup: false, plan: false })
    expect(document.querySelectorAll('[data-cal-entry]')).toHaveLength(0)
    expect(screen.getByTestId('calendar-empty')).toHaveAttribute('data-empty', 'no-types')
    expect(screen.getByText('No date types shown')).toBeInTheDocument()
  })

  it('navigation and the view switch are view state (never unsaved)', async () => {
    setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next month' })) })
    expect(label()).toBe('November 2026')
    expect(workingTab().viewState).toEqual({ titles: true, view: 'month', offset: 1 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Today' })) })
    expect(label()).toBe('October 2026')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Week' })) })
    expect(workingTab().viewState).toEqual({ titles: true, view: 'week', offset: 0 })
    expect(label()).toBe('Oct 12 – 18, 2026')
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
    expect(layoutSteps()).toEqual([])
  })

  it('an empty view says what it shows nothing of', () => {
    useTodoStore.setState({ todos: [] })
    setup(calendarTab({ config: { dateTypes: { due: false, followup: true, plan: false } } }))
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

describe('CalendarWidget plans', () => {
  const plansTab = (over: Partial<CalendarTab> = {}) => calendarTab({ config: { dateTypes: { due: true, followup: true, plan: true } }, ...over })

  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        ...useTodoStore.getState().todos,
        makeTodo({ id: 5, title: 'Planned Fri', doDate: day(16), dueDate: day(20), sortOrder: 5 }),
        makeTodo({ id: 6, title: 'Missed plan', doDate: day(13), sortOrder: 6 }),
        makeTodo({ id: 7, title: 'Held', unplanned: true, dueDate: day(22), sortOrder: 7 }),
      ],
    })
  })

  it('a plan entry: a hollow bar after the day’s due and follow-up entries, its tooltip naming it Planned', () => {
    setup(plansTab())
    const entry = within(dayCell(day(16))!).getByText('Planned Fri').closest('[data-cal-entry]')!
    expect(entry).toHaveAttribute('data-cal-entry', 'plan')
    expect(entry).toHaveAttribute('data-state', 'plan')
    expect(entry).toHaveAttribute('data-tooltip', 'Planned Fri')
    expect(entry).toHaveAttribute('data-tooltip-bar', 'hollow')
    expect(entry).toHaveAttribute('data-tooltip-bar-label', 'Planned')
    expect(entry).toHaveAttribute('aria-roledescription', 'draggable')
    const kinds = [...dayCell(day(16))!.querySelectorAll('[data-cal-entry]')].map((e) => e.getAttribute('data-cal-entry'))
    expect(kinds).toEqual(['due', 'plan'])
    // Its due date is its own entry, on its own day.
    expect(within(dayCell(day(20))!).getByText('Planned Fri').closest('[data-cal-entry]')).toHaveAttribute('data-cal-entry', 'due')
    // A held task has no plan entry.
    expect(document.querySelectorAll('[data-cal-entry="plan"]')).toHaveLength(2)
  })

  it('a missed plan is faded on its past day: not overdue, no wash', () => {
    setup(plansTab())
    const entry = within(dayCell(day(13))!).getByText('Missed plan').closest('[data-cal-entry]')!
    expect(entry).toHaveAttribute('data-state', 'plan-missed')
    expect(entry).toHaveAttribute('data-level', 'later')
    expect(entry.className).toMatch(/entryMissed/)
    expect(entry).toHaveAttribute('data-tooltip', 'Missed plan · delayed')
  })

  it('a completed task’s plan shows under Show completed and doesn’t drag', () => {
    useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 8, title: 'Done plan', doDate: day(17), isCompleted: true, sortOrder: 8 })] })
    setup(plansTab())
    expect(within(dayCell(day(17))!).queryByText('Done plan')).toBeNull()
    act(() => useFilterStore.getState().setShowCompleted(true))
    const entry = within(dayCell(day(17))!).getByText('Done plan').closest('[data-cal-entry]')!
    expect(entry.getAttribute('aria-roledescription')).toBeNull()
  })

  it('Plans is a third toggle (the hollow bar): layout config; off, no plan entries', () => {
    setup(plansTab())
    const group = screen.getByRole('group', { name: 'Date types shown' })
    const toggle = within(group).getByRole('button', { name: /Plans/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('data-type'))).toEqual(['due', 'followup', 'plan'])
    fireEvent.click(toggle)
    expect(workingTab().config.dateTypes).toEqual({ due: true, followup: true, plan: false })
    expect(document.querySelectorAll('[data-cal-entry="plan"]')).toHaveLength(0)
    expect(layoutSteps()).not.toEqual([])
  })

  it('plans alone: the empty note and the no-types note name them', () => {
    useTodoStore.setState({ todos: [] })
    setup(plansTab({ config: { dateTypes: { due: false, followup: false, plan: true } } }))
    expect(screen.getByTestId('calendar-empty').textContent).toContain('Nothing planned in October')
    fireEvent.click(within(screen.getByRole('group', { name: 'Date types shown' })).getByRole('button', { name: /Plans/ }))
    expect(screen.getByTestId('calendar-empty').textContent).toContain('Turn on Due, Follow-up or Plans')
  })
})

describe('dropLabel', () => {
  const all = { due: true, followup: true, plan: true }
  const today = day(14)
  it('names what a drop on the day does', () => {
    expect(dropLabel({ entryMove: true, type: 'due' }, all, day(10), today)).toBe('Move here')
    expect(dropLabel({ entryMove: true, type: 'plan' }, all, day(16), today)).toBe('Move here')
    expect(dropLabel({ entryMove: false }, all, day(16), today)).toBe('Set date')
    expect(dropLabel({ entryMove: false }, { due: false, followup: false, plan: true }, day(16), today)).toBe('Set plan')
    expect(dropLabel({ entryMove: false }, { due: true, followup: false, plan: false }, day(10), today)).toBe('Set due')
  })

  it('a plan onto a day before today: Past day (refused)', () => {
    expect(dropLabel({ entryMove: true, type: 'plan' }, all, day(13), today)).toBe('Past day')
    expect(dropLabel({ entryMove: false }, { due: false, followup: false, plan: true }, day(13), today)).toBe('Past day')
    expect(dropLabel({ entryMove: true, type: 'plan' }, all, today, today)).toBe('Move here')
  })
})

describe('CalendarWidget heat map (titles off)', () => {
  const heatTab = (over: Partial<CalendarTab> = {}) => calendarTab({ viewState: undefined, ...over })

  it('tints each month day by its count instead of bars; the count in the corner', () => {
    setup(heatTab())
    expect(document.querySelector('[data-cal-grid="month"]')).toHaveAttribute('data-heat-map', 'true')
    expect(document.querySelectorAll('[data-cal-entry]')).toHaveLength(0)
    // 12 Oct: Late due + a Weekly occurrence; 16: Both dates (due); 20: its follow-up.
    expect(dayCell(day(12))).toHaveAttribute('data-heat', '1')
    expect(dayCell(day(12))!.textContent).toBe('122')
    expect(dayCell(day(16))).toHaveAttribute('aria-label', 'Fri 16 Oct, 1 due')
    expect(dayCell(day(20))).toHaveAttribute('aria-label', 'Tue 20 Oct, 1 follow-up')
    expect(dayCell(day(13))).toHaveAttribute('data-heat', '0')
    expect(dayCell(day(13))!.tagName).toBe('DIV')
    expect(document.querySelector('[data-calendar-widget]')).toHaveAttribute('data-heat-hue', 'due')
  })

  it('a past day still open shows its number in the late colour, not the wash; the legend names one', () => {
    setup(heatTab())
    expect(dayCell(day(12))).toHaveAttribute('data-late', 'due')
    expect(dayCell(day(12))!.className).not.toMatch(/washDue/)
    // A past day holding only an occurrence isn't late.
    expect(dayCell(day(16))).not.toHaveAttribute('data-late')
    const legend = document.querySelector('[data-cal-legend]')!
    expect(legend.textContent).toBe('Due and follow-ups:01–23–56+· 12 still open past its day')
  })

  it('completed tasks count only under Show completed', () => {
    setup(heatTab())
    expect(dayCell(day(15))).toHaveAttribute('data-heat', '0')
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(dayCell(day(15))).toHaveAttribute('aria-label', 'Thu 15 Oct, 1 due · 0 open')
  })

  it('clicking a day opens the day popover with its entries', () => {
    setup(heatTab())
    fireEvent.click(dayCell(day(12))!)
    const popover = screen.getByTestId('calendar-day-popover')
    expect(within(popover).getByText('Late due')).toBeInTheDocument()
    expect(within(popover).getByText('Weekly')).toBeInTheDocument()
    expect(dayCell(day(12))).toHaveAttribute('aria-expanded', 'true')
  })

  it('follow-ups alone tint in the follow-up hue', () => {
    setup(heatTab({ config: { dateTypes: { due: false, followup: true, plan: false } } }))
    expect(document.querySelector('[data-calendar-widget]')).toHaveAttribute('data-heat-hue', 'followup')
    expect(dayCell(day(20))).toHaveAttribute('data-heat', '1')
    expect(document.querySelector('[data-cal-legend]')!.textContent).toMatch(/^Follow-ups:/)
  })

  it('the week keeps its bars and has no Titles toggle', () => {
    setup(heatTab({ viewState: { view: 'week' } }))
    expect(within(dayCell(day(16))!).getByText('Both dates')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Titles' })).toBeNull()
  })

  it('on a phone the compact month: the number over the day’s ticks, titles on or off; a late day washed', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 5, title: 'Planned', doDate: day(12), sortOrder: 5 })] })
    try {
      for (const tab of [heatTab({ config: { dateTypes: { due: true, followup: true, plan: true } } }), calendarTab({ config: { dateTypes: { due: true, followup: true, plan: true } } })]) {
        setup(tab)
        expect(document.querySelector('[data-calendar-widget]')).toHaveAttribute('data-mode', 'compact')
        expect(screen.queryByRole('button', { name: 'Titles' })).toBeNull()
        // 12 Oct: Late due and a Weekly occurrence (two solid ticks), then the plan (a hollow one).
        const marks = [...dayCell(day(12))!.querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark'))
        expect(marks).toEqual(['due', 'due', 'plan'])
        expect(dayCell(day(12))).not.toHaveAttribute('data-heat')
        expect(dayCell(day(12))!.className).toMatch(/washDue/)
        expect(dayCell(day(12))!.textContent).toBe('12')
        expect(dayCell(day(13))!.querySelectorAll('[data-mark]')).toHaveLength(0)
        // The day list is unchanged.
        fireEvent.click(dayCell(day(16))!)
        expect(within(document.querySelector('[data-cal-day-list]')!).getByText('Both dates')).toBeInTheDocument()
        cleanup()
      }
    } finally {
      window.matchMedia = original
    }
  })

  it('the heat counts plans, and the legend says so', () => {
    useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 5, title: 'Planned', doDate: day(16), sortOrder: 5 })] })
    setup(heatTab({ config: { dateTypes: { due: true, followup: true, plan: true } } }))
    expect(dayCell(day(16))).toHaveAttribute('aria-label', 'Fri 16 Oct, 1 due · 1 planned')
    expect(dayCell(day(16))!.textContent).toBe('162')
    expect(document.querySelector('[data-cal-legend]')!.textContent).toMatch(/^Due, follow-ups and plans:/)
  })

  it('Titles (off by default) switches the month to bars and back: view state, never unsaved', async () => {
    setup(heatTab())
    const toggle = screen.getByRole('button', { name: 'Titles' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { fireEvent.click(toggle) })
    expect(workingTab().viewState).toEqual({ titles: true })
    expect(screen.getByRole('button', { name: 'Titles' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dayCell(day(16))!).getByText('Both dates')).toBeInTheDocument()
    expect(document.querySelector('[data-cal-legend]')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Titles' })) })
    expect(workingTab().viewState).toEqual({})
    expect(dayCell(day(16))).toHaveAttribute('data-heat', '1')
    expect(layoutSteps()).toEqual([])
  })
})

describe('CalendarDropChooser', () => {
  function renderChooser(onDone: (t: unknown) => void, dateTypes = { due: true, followup: true, plan: false }, over: Parameters<typeof makeTodo>[0] = {}) {
    const todo = makeTodo({ id: 9, title: 'Draft OKRs', dueDate: day(15), ...over })
    render(<CalendarDropChooser todo={todo} date={day(13)} dateTypes={dateTypes} at={{ x: 100, y: 100 }} onDone={onDone} />)
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

  it('offers the types the calendar shows: Due · Follow-up · Plan, P picks the plan', () => {
    const picks: unknown[] = []
    const menu = renderChooser((t) => picks.push(t), { due: true, followup: true, plan: true }, { doDate: day(20) })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => [i.textContent?.match(/^(Due date|Follow-up|Plan)/)?.[0], i.getAttribute('aria-keyshortcuts')])).toEqual([['Due date', 'D'], ['Follow-up', 'F'], ['Plan', 'P']])
    expect(items[2]?.textContent).toContain('was Tue 20')
    fireEvent.keyDown(menu, { key: 'p' })
    expect(picks[0]).toBe('plan')
    cleanup()
    const menu2 = renderChooser(() => {}, { due: false, followup: true, plan: true }, { unplanned: true })
    const items2 = within(menu2).getAllByRole('menuitem')
    expect(items2).toHaveLength(2)
    expect(items2[0]?.textContent).toContain('Follow-up')
    expect(items2[1]?.textContent).toContain('held in Unplanned')
  })
})

describe('CalendarWidget faces (D25 R)', () => {
  function setupAt(face: WidgetFace, tab: CalendarTab = calendarTab()) {
    const layout = layoutWith(tab)
    useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
    render(<DndContext><WidgetFaceContext.Provider value={{ forced: face }}><Host /></WidgetFaceContext.Provider></DndContext>)
  }

  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Due today', dueDate: day(14), sortOrder: 1 }),
        makeTodo({ id: 2, title: 'Follow up today', nextFollowupAt: day(14), sortOrder: 2 }),
        makeTodo({ id: 3, title: 'Late due', dueDate: day(12), sortOrder: 3 }),
        makeTodo({ id: 4, title: 'Friday', dueDate: day(16), sortOrder: 4 }),
        makeTodo({ id: 5, title: 'Next week', dueDate: day(21), sortOrder: 5 }),
      ],
    })
  })

  it('small: today’s count of the tab’s date types and this week’s ticks, today marked', () => {
    setupAt('small')
    expect(screen.getByTestId('calendar-face-today')).toHaveTextContent('2')
    expect(document.querySelector('[data-calendar-face]')!.textContent).toContain('due or to follow up today')
    const strip = [...document.querySelectorAll<HTMLElement>('[data-calendar-face] [data-day]')]
    // Mon 12 – Sun 18 (the week starts on Monday): a due date; nothing; a due date and a follow-up; nothing; a due date.
    const marks = strip.map((d) => [...d.querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark')).join(' '))
    expect(marks).toEqual(['due', '', 'due followup', '', 'due', '', ''])
    expect(strip.findIndex((d) => d.dataset.today === 'true')).toBe(2)
    expect(strip[0]!.dataset.late).toBe('due')
    expect(document.querySelectorAll('[data-calendar-face] [data-heat]')).toHaveLength(0)
    expect(document.querySelector('[data-calendar-widget]')).toBeNull()
  })

  it('small and medium: a plan is a hollow tick; past eight, +N', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeTodo({ id: 20 + i, title: `Plan ${i}`, doDate: day(15), sortOrder: 20 + i }))
    useTodoStore.setState({ todos: [...useTodoStore.getState().todos, ...many] })
    const all = calendarTab({ config: { dateTypes: { due: true, followup: true, plan: true } } })
    for (const face of ['small', 'medium'] as const) {
      setupAt(face, all)
      const thu = dayCell(day(15))!
      expect([...thu.querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark'))).toEqual(Array.from({ length: 8 }, () => 'plan'))
      expect(thu.querySelector('[data-day-ticks-more]')).toHaveTextContent('+2')
      cleanup()
    }
  })

  it('small, plans shown: today’s words name them', () => {
    setupAt('small', calendarTab({ config: { dateTypes: { due: true, followup: true, plan: true } } }))
    expect(document.querySelector('[data-calendar-face]')!.textContent).toContain('due, to follow up or planned today')
  })

  it('small, due only: today’s due tasks', () => {
    setupAt('small', calendarTab({ config: { dateTypes: { due: true, followup: false, plan: false } } }))
    expect(screen.getByTestId('calendar-face-today')).toHaveTextContent('1')
    expect(document.querySelector('[data-calendar-face]')!.textContent).toContain('due today')
  })

  it('medium: this week as seven day cells with their counts; a day opens its entries', () => {
    setupAt('medium')
    const days = [...document.querySelectorAll<HTMLElement>('[data-calendar-face] [data-day]')]
    expect(days.map((d) => d.dataset.day)).toEqual([12, 13, 14, 15, 16, 17, 18].map((n) => dayKey(day(n))))
    expect(days.map((d) => within(d).getByTestId('calendar-face-count').textContent)).toEqual(['1', '–', '2', '–', '1', '–', '–'])
    // Each day's ticks under its count, no heat tint.
    expect([...dayCell(day(14))!.querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark'))).toEqual(['due', 'followup'])
    expect(dayCell(day(14))).not.toHaveAttribute('data-heat')
    expect(dayCell(day(14))!.getAttribute('aria-label')).toBe('Wed 14 Oct, today: 2 tasks')
    fireEvent.click(dayCell(day(14))!)
    const popover = screen.getByTestId('calendar-day-popover')
    expect(popover.textContent).toContain('Due today')
    expect(popover.textContent).toContain('Follow up today')
  })

  it('large: the calendar itself', () => {
    setupAt('large')
    expect(document.querySelector('[data-calendar-face]')).toBeNull()
    expect(document.querySelector('[data-calendar-widget]')).not.toBeNull()
  })
})
