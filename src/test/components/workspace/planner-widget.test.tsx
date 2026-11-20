import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { PlannerWidget } from '../../../components/workspace/planner/PlannerWidget'
import { WidgetFaceContext, type WidgetFaceHost } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem } from '../../../models'
import type { PlannerTab } from '../../../models/workspace-layout'
import { plannerWindowKey, usePlannerStore } from '../../../stores/planner-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { LIST_WIDGET_ATTR } from '../../../utils/dom-contract'
import { clearFilterStore, getByTooltip, makeTodo, patchScreenFilter, resetEntityStores } from '../../helpers'

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20, 10)
const day = (offset: number, hour = 0, minute = 0) => new Date(2026, 10, 20 + offset, hour, minute)
const PLANNER: PlannerTab = { id: 'plan', kind: 'planner', config: {} }

let width = 1100
let height = 700

const TODOS = (): PersistedTodoItem[] => [
  makeTodo({ id: 1, uid: 'late', title: 'Late invoice', dueDate: day(-3), sortOrder: 1 }),
  makeTodo({ id: 2, uid: 'chase', title: 'Chase legal', nextFollowupAt: day(0), sortOrder: 2 }),
  makeTodo({ id: 3, uid: 'plan', title: 'Planned for today', doDate: day(0), dueDate: day(9), sortOrder: 3 }),
  makeTodo({ id: 4, uid: 'mon-due', title: 'Monday deadline', dueDate: day(3), sortOrder: 4 }),
  makeTodo({ id: 5, uid: 'mon-do', title: 'Monday plan', doDate: day(3), sortOrder: 5 }),
  makeTodo({ id: 6, uid: 'thu', title: 'Thursday call', nextFollowupAt: day(6), dueDate: day(20), sortOrder: 6 }),
  makeTodo({ id: 7, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 7 }),
  makeTodo({ id: 8, uid: 'next', title: 'Next week deadline', dueDate: day(8), sortOrder: 8 }),
  makeTodo({ id: 9, uid: 'plain', title: 'Not in the planner', sortOrder: 9 }),
  makeTodo({ id: 10, uid: 'done', title: 'Shipped the report', isCompleted: true, completedAt: day(0, 9), dueDate: day(0), sortOrder: 10 }),
  makeTodo({ id: 11, uid: 'done-before', title: 'Done yesterday', isCompleted: true, completedAt: day(-1, 9), sortOrder: 11 }),
]

function show(host: WidgetFaceHost = {}, tab: PlannerTab = PLANNER) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={host}>
        <PlannerWidget tab={tab} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const root = () => document.querySelector<HTMLElement>('[data-planner="plan"]')!
const group = (name: string) => within(root()).getByRole('group', { name })
const groupNames = () => [...root().querySelectorAll('[data-planner-group]')].map((g) => g.getAttribute('aria-label'))
const titlesIn = (el: Element) => [...el.querySelectorAll('[data-task-title]')].map((r) => r.getAttribute('data-task-title'))
const tile = (key: string) => root().querySelector<HTMLButtonElement>(`[data-planner-tile="${key}"]`)!
const tileNames = () => [...root().querySelectorAll('[data-planner-tile]')].map((t) => t.getAttribute('aria-label'))

beforeEach(() => {
  width = 1100
  height = 700
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useTodoStore.setState({ todos: TODOS() })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Planner — large', () => {
  it('draws the strip over two panes: Today, a group per day ahead, Focus, no day', () => {
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'large')
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'panes')
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Focus, no day'])
    // Today on the left; the days ahead on the right, Focus, no day pinned under them.
    expect(root().querySelector('[data-planner-pane="today"]')).toContainElement(group('Today'))
    expect(root().querySelector('[data-planner-pane="ahead"]')).toContainElement(group('Mon, Nov 23'))
    expect(root().querySelector('[data-planner-pane="noday"]')).toContainElement(group('Focus, no day'))
    // A late date sits in Today; deadlines first, then follow-ups, then plans.
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(titlesIn(group('Mon, Nov 23'))).toEqual(['Monday deadline', 'Monday plan'])
    expect(titlesIn(group('Thu, Nov 26'))).toEqual(['Thursday call'])
    expect(titlesIn(group('Focus, no day'))).toEqual(['Someday focus'])
    expect(root()).not.toHaveTextContent('Not in the planner')
    expect(root()).not.toHaveTextContent('Next week deadline')
  })

  it('heads each group with its name and count; an empty day has no count', () => {
    show()
    const count = (name: string) => within(group(name)).queryByTestId('planner-group-count')?.textContent ?? null
    expect(count('Today')).toBe('3')
    expect(count('Mon, Nov 23')).toBe('2')
    expect(count('Sat, Nov 21')).toBeNull()
    expect(titlesIn(group('Sat, Nov 21'))).toEqual([])
    expect(count('Focus, no day')).toBe('1')
  })

  it('shows the app’s task rows, as the list’s draggable occurrences — and is no list widget', () => {
    show()
    const row = group('Mon, Nov 23').querySelector('[data-row-key]')!
    expect(row).toHaveAttribute('data-row-key', '2026-11-23|4')
    expect(row).toHaveAttribute('data-row-todo', '4')
    expect(row).toHaveAttribute('data-drag-id')
    expect(group('Mon, Nov 23')).toHaveAttribute('data-list-section', '2026-11-23')
    expect(group('Focus, no day')).toHaveAttribute('data-list-section', 'none')
    expect(group('Today')).toHaveAttribute('data-row-group')
    // No Do-day words on a row, and the list zoom never finds it.
    expect(root()).not.toHaveTextContent(/do day/i)
    expect(document.querySelector(`[${LIST_WIDGET_ATTR}]`)).toBeNull()
  })

  it('a click on a row opens the task', () => {
    const open = vi.spyOn(useUIStore.getState(), 'openEditPopup')
    show()
    fireEvent.click(within(group('Today')).getByText('Chase legal'))
    expect(open).toHaveBeenCalledWith(2)
  })

  it('applies the tab’s hand order inside each group', () => {
    show({}, { ...PLANNER, viewState: { order: ['mon-do', 'plan', 'gone', 'late'] } })
    expect(titlesIn(group('Today'))).toEqual(['Planned for today', 'Late invoice', 'Chase legal'])
    expect(titlesIn(group('Mon, Nov 23'))).toEqual(['Monday plan', 'Monday deadline'])
  })

  it('holds only what the screen filter shows', () => {
    show()
    act(() => patchScreenFilter({ searchText: 'monday' }))
    expect(titlesIn(root())).toEqual(['Monday deadline', 'Monday plan'])
    expect(within(group('Today')).getByRole('status')).toHaveTextContent('Nothing for today')
    expect(tile('2026-11-20')).toHaveAccessibleName('Today, Nov 20: no tasks')
  })
})

describe('the Planner — the strip', () => {
  it('has seven day tiles between the arrows, each named with its day and count', () => {
    show()
    const strip = within(root()).getByRole('group', { name: 'Days' })
    expect([...strip.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Previous week',
      'Today, Nov 20: 3 tasks', 'Sat, Nov 21: no tasks', 'Sun, Nov 22: no tasks', 'Mon, Nov 23: 2 tasks',
      'Tue, Nov 24: no tasks', 'Wed, Nov 25: no tasks', 'Thu, Nov 26: 1 task',
      'Next week',
    ])
    expect(tile('2026-11-20')).toHaveAttribute('data-today', 'true')
    expect(tile('2026-11-21')).toHaveAttribute('data-weekend', 'true')
    expect(tile('2026-11-23')).not.toHaveAttribute('data-today')
    expect(getByTooltip(strip, 'Next week')).toBeInTheDocument()
    // No native title anywhere.
    expect(root().querySelector('[title]')).toBeNull()
  })

  it('draws a tick per task by why it is on the day: deadlines, follow-ups, plans', () => {
    show()
    const ticks = (key: string) => [...tile(key).querySelectorAll('[data-reason]')].map((t) => t.getAttribute('data-reason'))
    expect(ticks('2026-11-20')).toEqual(['due', 'followup', 'do'])
    expect(ticks('2026-11-23')).toEqual(['due', 'do'])
    expect(ticks('2026-11-26')).toEqual(['followup'])
    expect(ticks('2026-11-21')).toEqual([])
    expect(within(tile('2026-11-23')).getByTestId('planner-tile-count')).toHaveTextContent('2')
    expect(within(tile('2026-11-21')).getByTestId('planner-tile-count')).toBeEmptyDOMElement()
  })

  it('stops at eight ticks and says how many more', () => {
    useTodoStore.setState({ todos: Array.from({ length: 11 }, (_, i) => makeTodo({ id: i + 1, doDate: day(1), sortOrder: i })) })
    show()
    expect(tile('2026-11-21').querySelectorAll('[data-reason]')).toHaveLength(8)
    expect(tile('2026-11-21')).toHaveTextContent('+3')
  })

  it('a click on a tile starts the days ahead at that day; again, or on today, at tomorrow', () => {
    show()
    fireEvent.click(tile('2026-11-23'))
    expect(groupNames()).toEqual(['Today', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Focus, no day'])
    expect(tile('2026-11-23')).toHaveAttribute('aria-pressed', 'true')
    expect(tile('2026-11-23')).toHaveAttribute('data-picked', 'true')
    expect(tile('2026-11-24')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(tile('2026-11-25'))
    expect(groupNames()).toEqual(['Today', 'Wed, Nov 25', 'Thu, Nov 26', 'Focus, no day'])
    fireEvent.click(tile('2026-11-25'))
    expect(groupNames()).toHaveLength(8)
    fireEvent.click(tile('2026-11-24'))
    fireEvent.click(tile('2026-11-20'))
    expect(groupNames()).toHaveLength(8)
    expect(root().querySelector('[data-picked]')).toBeNull()
  })

  it('the arrows move the window a week; Today stays, and there is no week before this one', () => {
    show()
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(tileNames()).toEqual([
      'Fri, Nov 27: no tasks', 'Sat, Nov 28: 1 task', 'Sun, Nov 29: no tasks', 'Mon, Nov 30: no tasks',
      'Tue, Dec 1: no tasks', 'Wed, Dec 2: no tasks', 'Thu, Dec 3: no tasks',
    ])
    expect(root().querySelector('[data-today]')).toBeNull()
    // Today is still today's; the days ahead are the window's, from its first day.
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(groupNames()).toEqual(['Today', 'Fri, Nov 27', 'Sat, Nov 28', 'Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3', 'Focus, no day'])
    expect(titlesIn(group('Sat, Nov 28'))).toEqual(['Next week deadline'])
    // Planned for today is due on the 29th, but its Do day keeps it on today.
    expect(titlesIn(group('Sun, Nov 29'))).toEqual([])
    // This week's later days have no group while the window is shifted.
    expect(root()).not.toHaveTextContent('Monday deadline')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(tile('2026-11-20')).toHaveAttribute('data-today', 'true')
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
  })

  it('keeps the window and the picked day by tab, across a remount (Open larger)', () => {
    const first = show()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    fireEvent.click(tile('2026-11-30'))
    first.unmount()
    show({ forced: 'large' })
    expect(tile('2026-11-30')).toHaveAttribute('aria-pressed', 'true')
    expect(groupNames()).toEqual(['Today', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3', 'Focus, no day'])
    expect(usePlannerStore.getState().windows).toEqual({ [plannerWindowKey(null, 'plan')]: { offset: 7, picked: new Date(2026, 10, 30).getTime() } })
  })
})

describe('the Planner — its top line, alone in its cell', () => {
  const controls: CellControlsValue = {
    cellId: 'c', tabs: [PLANNER], tabId: 'plan', title: 'Planner', touch: false, setMoreButton: () => undefined, menuOpen: false,
    onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
  }
  const alone = () => render(<DndContext><CellControlsContext.Provider value={controls}><PlannerWidget tab={PLANNER} /></CellControlsContext.Provider></DndContext>)

  it('names the widget, its range, and what is due and due for a follow-up in Settings’ ranges', () => {
    useSettingsStore.setState({ tabBadges: { due: 3, followup: 0 } })
    alone()
    expect(screen.getByTestId('top-line-name')).toHaveTextContent('Planner')
    expect(screen.getByTestId('planner-range')).toHaveTextContent('Nov 20 – 26')
    // Due within three days: the late invoice and Monday's deadline; a follow-up today: Chase legal.
    const badge = screen.getByRole('img', { name: '2 due: 1 overdue, 1 within 3 days; 1 follow-up: today' })
    expect([...badge.querySelectorAll('[data-badge-part]')].map((p) => p.textContent)).toEqual(['2', '1'])
  })

  it('has no badge with nothing to count', () => {
    useSettingsStore.setState({ tabBadges: { due: 'off', followup: 'off' } })
    alone()
    expect(screen.queryByTestId('planner-badge')).toBeNull()
  })

  it('shifted, the range is the way back to this week', () => {
    alone()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.queryByTestId('planner-range')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nov 27 – Dec 3. Back to this week' }))
    expect(screen.getByTestId('planner-range')).toHaveTextContent('Nov 20 – 26')
    expect(tile('2026-11-20')).toHaveAttribute('data-today', 'true')
  })

  it('shares a cell without a top line: the strip’s arrows are there all the same', () => {
    show()
    expect(screen.queryByTestId('top-line-name')).toBeNull()
    expect(screen.queryByTestId('planner-range')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument()
  })
})

describe('the Planner — Today’s foot', () => {
  it('lists the tasks completed today, struck, on one line', () => {
    show()
    const done = within(group('Today')).getByTestId('planner-done')
    expect(done).toHaveTextContent('1 done')
    expect(done).toHaveTextContent('Shipped the report')
    expect(done).not.toHaveTextContent('Done yesterday')
  })

  it('counts every task completed today, the last first', () => {
    useTodoStore.setState({
      todos: [
        ...TODOS(),
        makeTodo({ id: 20, title: 'Latest one', isCompleted: true, completedAt: day(0, 9, 30), sortOrder: 20 }),
        makeTodo({ id: 21, title: 'Earliest one', isCompleted: true, completedAt: day(0, 1), sortOrder: 21 }),
      ],
    })
    show()
    expect(within(group('Today')).getByTestId('planner-done')).toHaveTextContent(/^3 doneLatest one · Shipped the report · Earliest one$/)
  })

  it('has no done line with none', () => {
    useTodoStore.setState({ todos: TODOS().filter((t) => !t.isCompleted) })
    show()
    expect(screen.queryByTestId('planner-done')).toBeNull()
  })

  it('Add task is Today’s last row and seeds the new task’s Do day with today, beside the screen filter’s seeds', () => {
    show()
    const add = within(group('Today')).getByRole('button', { name: 'Add task' })
    expect(group('Today').querySelector('[data-planner-group-body]')?.lastElementChild).toBe(add)
    act(() => patchScreenFilter({ personIds: new Set([4]) }))
    fireEvent.click(add)
    const ui = useUIStore.getState()
    expect(ui.quickAddOpen).toBe(true)
    expect(ui.quickAddDraft?.defaults).toEqual({ personIds: [4], tagIds: [], statusId: undefined, doDate: new Date(2026, 10, 20) })
  })
})

describe('the Planner — a completed row leaves', () => {
  const complete = (id: number) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, isCompleted: true, completedAt: new Date() } : t)) })
  })
  const leavingOf = (title: string) => root().querySelector(`[data-task-title="${title}"]`)?.closest('[data-leaving]')?.getAttribute('data-leaving') ?? null

  it('stays in place, completed, then folds, then drops out — and joins the done line', () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    show()
    complete(2)
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(leavingOf('Chase legal')).toBe('stay')
    expect(within(group('Today')).getByRole('checkbox', { name: /Mark incomplete/ })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(500) })
    expect(leavingOf('Chase legal')).toBe('fold')
    act(() => { vi.advanceTimersByTime(180) })
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Planned for today'])
    expect(within(group('Today')).getByTestId('planner-group-count')).toHaveTextContent('2')
    expect(within(group('Today')).getByTestId('planner-done')).toHaveTextContent('2 done')
  })

  it('a task completed in a day ahead lingers in its own group', () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    show()
    complete(5)
    expect(titlesIn(group('Mon, Nov 23'))).toEqual(['Monday deadline', 'Monday plan'])
    expect(leavingOf('Monday plan')).toBe('stay')
    act(() => { vi.advanceTimersByTime(680) })
    expect(titlesIn(group('Mon, Nov 23'))).toEqual(['Monday deadline'])
  })

  it('a repeating task’s occurrence done lingers as that occurrence, then the next one takes its day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    useTodoStore.setState({
      todos: [
        ...TODOS(),
        makeTodo({ id: 30, uid: 'weekly', title: 'Weekly report', dueDate: day(0), doDate: day(0), recurrenceRule: { every: { count: 3, unit: 'd' } }, sortOrder: 30 }),
      ],
    })
    show()
    expect(titlesIn(group('Today'))).toContain('Weekly report')
    // The store's advance: the next due date, the Do day cleared, the task still open.
    act(() => {
      useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 30 ? { ...t, dueDate: day(3), doDate: undefined } : t)) })
    })
    expect(titlesIn(group('Today'))).toContain('Weekly report')
    expect(leavingOf('Weekly report')).toBe('stay')
    expect(titlesIn(group('Mon, Nov 23'))).not.toContain('Weekly report')
    act(() => { vi.advanceTimersByTime(680) })
    expect(titlesIn(group('Today'))).not.toContain('Weekly report')
    expect(titlesIn(group('Mon, Nov 23'))).toContain('Weekly report')
  })
})

describe('the Planner — its rows’ zoom', () => {
  const zooms = () => [...new Set([...root().querySelectorAll('[data-planner-pane] > [data-zoom]')].map((el) => el.getAttribute('data-zoom')))]

  it('follows Default list zoom’s Auto: Rows in a wide pane, Stacked in a narrow one', () => {
    show()
    expect(zooms()).toEqual(['rows'])
    cleanup()
    width = 400
    show({ forced: 'large' })
    expect(zooms()).toEqual(['stacked'])
  })

  it('shows a picked level whatever the width', () => {
    useSettingsStore.setState({ listZoom: 'rows' })
    width = 400
    show({ forced: 'large' })
    expect(zooms()).toEqual(['rows'])
    cleanup()
    useSettingsStore.setState({ listZoom: 'lines' })
    show({ forced: 'large' })
    expect(zooms()).toEqual(['lines'])
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(group('Today').querySelectorAll('[data-row-key]')).toHaveLength(3)
  })
})

describe('the Planner — medium and small', () => {
  it('a narrow cell shows the strip over one column: Today, the days ahead, Focus, no day', () => {
    width = 500
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'medium')
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'column')
    expect(root().querySelector('[data-planner-pane]')).toBeNull()
    expect(root().querySelector('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'tiles')
    expect(root().querySelectorAll('[data-planner-tile]')).toHaveLength(7)
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Focus, no day'])
    expect(within(group('Today')).getByRole('button', { name: 'Add task' })).toBeInTheDocument()
  })

  it('a short cell is one column too', () => {
    height = 280
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'medium')
  })

  it('too narrow for seven tiles, the arrows sit around the range', () => {
    width = 260
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'medium')
    expect(root().querySelector('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'range')
    expect(root().querySelector('[data-planner-tile]')).toBeNull()
    expect(within(root()).getByRole('group', { name: 'Days' })).toHaveTextContent('Nov 20 – 26')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(within(root()).getByRole('group', { name: 'Days' })).toHaveTextContent('Nov 27 – Dec 3')
  })

  it('a small cell shows its name and today’s count', () => {
    height = 80
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'small')
    expect(screen.getByRole('group', { name: 'Planner: 3 today' })).toHaveTextContent('PlannerToday3')
    expect(screen.getByTestId('planner-face-count')).toHaveTextContent('3')
    expect(root().querySelector('[data-planner-strip], [data-planner-group]')).toBeNull()
  })

  it('a small face names the tab as it was renamed', () => {
    show({ forced: 'small' }, { ...PLANNER, name: 'My week' })
    expect(screen.getByRole('group', { name: 'My week: 3 today' })).toBeInTheDocument()
  })

  it('the widget popup draws the large face whatever the size', () => {
    width = 400
    show({ forced: 'large' })
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'panes')
  })
})

describe('the Planner — on the phone', () => {
  let original: typeof window.matchMedia

  beforeEach(() => {
    original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    width = 359
  })

  afterEach(() => {
    window.matchMedia = original
  })

  it('is one column of the phone’s rows under the strip, without the empty days', () => {
    show({ heightFree: true })
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'column')
    expect(root().querySelectorAll('[data-planner-tile]')).toHaveLength(7)
    expect(groupNames()).toEqual(['Today', 'Mon, Nov 23', 'Thu, Nov 26', 'Focus, no day'])
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    // The phone's rows: no draggable occurrence.
    expect(root().querySelector('[data-row-key], [data-drag-id]')).toBeNull()
    expect(within(group('Today')).getByRole('button', { name: 'Add task' })).toBeInTheDocument()
  })

  it('has no Focus, no day group with nothing in it', () => {
    useTodoStore.setState({ todos: TODOS().filter((t) => !t.focus) })
    show({ heightFree: true })
    expect(groupNames()).toEqual(['Today', 'Mon, Nov 23', 'Thu, Nov 26'])
  })

  it('a completed row leaves at once (no fold)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    show({ heightFree: true })
    act(() => {
      useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 2 ? { ...t, isCompleted: true, completedAt: new Date() } : t)) })
    })
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Planned for today'])
  })
})
