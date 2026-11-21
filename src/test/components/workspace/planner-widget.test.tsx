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
  it('draws the strip over two panes: the days in one list on the left — Today, then every later day —, the trays on the right', () => {
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'large')
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'panes')
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Unplanned'])
    // Two panes, in this order: the days, then the trays (Delayed and its Unplan button only while Delayed holds a task).
    expect([...root().querySelectorAll('[data-planner-pane]')].map((p) => p.getAttribute('data-planner-pane'))).toEqual(['days', 'trays'])
    const days = root().querySelector<HTMLElement>('[data-planner-pane="days"]')!
    expect([...days.querySelectorAll('[data-planner-group]')].map((g) => g.getAttribute('aria-label')))
      .toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26'])
    const trays = root().querySelector<HTMLElement>('[data-planner-pane="trays"]')!
    expect([...trays.querySelectorAll('[data-planner-group]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Unplanned'])
    expect(within(root()).queryByRole('group', { name: 'Delayed' })).toBeNull()
    expect(within(root()).queryByRole('button', { name: 'Unplan all Delayed tasks' })).toBeNull()
    // A late date sits in Today; deadlines first, then follow-ups, then plans.
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(titlesIn(group('Mon, Nov 23'))).toEqual(['Monday deadline', 'Monday plan'])
    expect(titlesIn(group('Thu, Nov 26'))).toEqual(['Thursday call'])
    expect(titlesIn(group('Unplanned'))).toEqual(['Someday focus'])
    expect(root()).not.toHaveTextContent('Not in the planner')
    expect(root()).not.toHaveTextContent('Next week deadline')
  })

  it('heads each group with its name and count; a day with nothing on it is a quiet heading with no count', () => {
    show()
    const count = (name: string) => within(group(name)).queryByTestId('planner-group-count')?.textContent ?? null
    expect(count('Today')).toBe('3')
    expect(count('Mon, Nov 23')).toBe('2')
    expect(count('Sat, Nov 21')).toBeNull()
    expect(titlesIn(group('Sat, Nov 21'))).toEqual([])
    expect(count('Unplanned')).toBe('1')
    const quiet = [...root().querySelectorAll('[data-planner-empty]')].map((g) => g.getAttribute('aria-label'))
    expect(quiet).toEqual(['Sat, Nov 21', 'Sun, Nov 22', 'Tue, Nov 24', 'Wed, Nov 25'])
    // Still a drop target: the day's group, its section and all.
    expect(group('Sat, Nov 21')).toHaveAttribute('data-list-section', '2026-11-21')
  })

  it('Today with nothing, and Unplanned with nothing, keep their headings and say so', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Monday only', dueDate: day(3) })] })
    show()
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Unplanned'])
    expect(within(group('Today')).getByRole('status')).toHaveTextContent('Nothing for today')
    expect(within(group('Unplanned')).getByRole('status')).toHaveTextContent('Nothing unplanned')
    expect(group('Today')).not.toHaveAttribute('data-planner-empty')
    expect(group('Unplanned')).not.toHaveAttribute('data-planner-empty')
  })

  it('shows the app’s task rows, as the list’s draggable occurrences — and is no list widget', () => {
    show()
    const row = group('Mon, Nov 23').querySelector('[data-row-key]')!
    expect(row).toHaveAttribute('data-row-key', '2026-11-23|4')
    expect(row).toHaveAttribute('data-row-todo', '4')
    expect(row).toHaveAttribute('data-drag-id')
    expect(group('Mon, Nov 23')).toHaveAttribute('data-list-section', '2026-11-23')
    expect(group('Unplanned')).toHaveAttribute('data-list-section', 'unplanned')
    expect(group('Today')).toHaveAttribute('data-row-group')
    // No plan words on a row, and the list zoom never finds it.
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

describe('the Planner — the trays', () => {
  const withTrays = (): PersistedTodoItem[] => [
    ...TODOS(),
    makeTodo({ id: 40, uid: 'missed', title: 'Missed plan', doDate: day(-1), dueDate: day(0), sortOrder: 40 }),
    makeTodo({ id: 41, uid: 'missed-old', title: 'Older missed plan', doDate: day(-6), sortOrder: 41 }),
    makeTodo({ id: 42, uid: 'held', title: 'Held call', unplanned: true, nextFollowupAt: day(2), sortOrder: 42 }),
  ]

  it('a plan whose day has passed is in Delayed, above Unplanned — never in Today', () => {
    useTodoStore.setState({ todos: withTrays() })
    show()
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Delayed', 'Unplanned'])
    // Due today, but planned for yesterday: it waits in Delayed.
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(titlesIn(group('Delayed'))).toEqual(['Older missed plan', 'Missed plan'])
    const trays = root().querySelector('[data-planner-pane="trays"]')!
    expect(trays).toContainElement(group('Delayed'))
    expect(trays).toContainElement(group('Unplanned'))
    // Between them, the Unplan button on its rule.
    // Named with its visible word first; its tooltip says what it does.
    const button = within(root()).getByRole('button', { name: 'Unplan all Delayed tasks' })
    expect([...trays.querySelectorAll('[data-planner-group], [data-planner-unplan-all]')].map((el) => el.getAttribute('aria-label') ?? 'unplan'))
      .toEqual(['Delayed', 'unplan', 'Unplanned'])
    expect(button).toHaveTextContent('Unplan')
    expect(getByTooltip(trays as HTMLElement, 'Move all Delayed tasks to Unplanned')).toBe(button)
    expect(group('Delayed')).toHaveAttribute('data-list-section', 'delayed')
    expect(group('Delayed')).toHaveAttribute('data-planner-group-kind', 'delayed')
    expect(within(group('Delayed')).getByTestId('planner-group-count')).toHaveTextContent('2')
    expect(tile('2026-11-20')).toHaveAccessibleName('Today, Nov 20: 3 tasks, 2 due, 1 follow-up, 1 planned')
  })

  it('a dated task held in Unplanned sits there, before the Focus tasks, and on no day', () => {
    useTodoStore.setState({ todos: withTrays() })
    show()
    expect(titlesIn(group('Unplanned'))).toEqual(['Held call', 'Someday focus'])
    expect(titlesIn(group('Sun, Nov 22'))).toEqual([])
    expect(group('Unplanned')).toHaveAttribute('data-planner-group-kind', 'unplanned')
    expect(tile('2026-11-22')).toHaveAccessibleName('Sun, Nov 22: no tasks, 1 follow-up')
  })

  it('the trays stay while the window is shifted', () => {
    useTodoStore.setState({ todos: withTrays() })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(titlesIn(group('Delayed'))).toEqual(['Older missed plan', 'Missed plan'])
    expect(titlesIn(group('Unplanned'))).toEqual(['Held call', 'Someday focus'])
  })

  it('one column keeps the order: Today, the days, Delayed, the Unplan button, Unplanned', () => {
    useTodoStore.setState({ todos: withTrays() })
    width = 500
    show()
    const column = root().querySelector('[data-planner-layout="column"]')!
    expect([...column.querySelectorAll('[data-planner-group], [data-planner-unplan-all]')].map((el) => el.getAttribute('aria-label') ?? 'unplan'))
      .toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Delayed', 'unplan', 'Unplanned'])
  })

  it('the Unplan button moves every Delayed task to Unplanned in one write', () => {
    useTodoStore.setState({ todos: withTrays() })
    const setPlans = vi.fn(() => Promise.resolve(true))
    useTodoStore.setState({ setPlans })
    show()
    fireEvent.click(within(root()).getByRole('button', { name: 'Unplan all Delayed tasks' }))
    // Each as its own Unplan would: held — dated or not —, one undo step with the snackbar.
    expect(setPlans).toHaveBeenCalledTimes(1)
    expect(setPlans).toHaveBeenCalledWith([{ id: 41, plan: 'unplanned' }, { id: 40, plan: 'unplanned' }], 'Unplanned 2 tasks from Delayed', true)
  })
})

describe('the Planner — the strip', () => {
  it('has seven day tiles between the arrows, each named with its day, its count and what its marks say', () => {
    show()
    const strip = within(root()).getByRole('group', { name: 'Days' })
    expect([...strip.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Previous week',
      'Today, Nov 20: 3 tasks, 1 due, 1 follow-up, 1 planned', 'Sat, Nov 21: no tasks', 'Sun, Nov 22: no tasks', 'Mon, Nov 23: 2 tasks, 1 due, 1 planned',
      'Tue, Nov 24: no tasks', 'Wed, Nov 25: no tasks', 'Thu, Nov 26: 1 task, 1 follow-up',
      'Next week',
    ])
    expect(tile('2026-11-20')).toHaveAttribute('data-today', 'true')
    expect(tile('2026-11-21')).toHaveAttribute('data-weekend', 'true')
    expect(tile('2026-11-23')).not.toHaveAttribute('data-today')
    expect(getByTooltip(strip, 'Next week')).toBeInTheDocument()
    // No native title anywhere.
    expect(root().querySelector('[title]')).toBeNull()
  })

  const marks = (key: string) => [...tile(key).querySelectorAll('[data-mark]')].map((t) => t.getAttribute('data-mark'))

  it('marks each day: a solid tick per real date on it — due dates, then follow-ups —, then a hollow one per plan', () => {
    show()
    // Today: the late invoice's due date and Chase legal's follow-up count on today; one plan.
    expect(marks('2026-11-20')).toEqual(['due', 'followup', 'plan'])
    expect(marks('2026-11-23')).toEqual(['due', 'plan'])
    expect(marks('2026-11-26')).toEqual(['followup'])
    expect(marks('2026-11-21')).toEqual([])
    // The count stays the rows sitting on the day.
    expect(within(tile('2026-11-23')).getByTestId('planner-tile-count')).toHaveTextContent('2')
    expect(within(tile('2026-11-21')).getByTestId('planner-tile-count')).toBeEmptyDOMElement()
  })

  it('a real date marks its own day wherever the task is planned or held; its plan marks the planned day', () => {
    useTodoStore.setState({
      todos: [
        // Due Sun, planned Tue: a solid tick on Sun (no row there), a hollow one on Tue (its row).
        makeTodo({ id: 1, title: 'Moved', dueDate: day(2), doDate: day(4) }),
        // Held in Unplanned, a follow-up on Mon: its tick stays on Mon.
        makeTodo({ id: 2, title: 'Held', nextFollowupAt: day(3), unplanned: true }),
      ],
    })
    show()
    expect(marks('2026-11-22')).toEqual(['due'])
    expect(within(tile('2026-11-22')).getByTestId('planner-tile-count')).toBeEmptyDOMElement()
    expect(marks('2026-11-24')).toEqual(['plan'])
    expect(within(tile('2026-11-24')).getByTestId('planner-tile-count')).toHaveTextContent('1')
    expect(marks('2026-11-23')).toEqual(['followup'])
  })

  it('stops at eight marks and says how many more', () => {
    useTodoStore.setState({ todos: Array.from({ length: 11 }, (_, i) => makeTodo({ id: i + 1, doDate: day(1), sortOrder: i })) })
    show()
    expect(marks('2026-11-21')).toEqual(Array.from({ length: 8 }, () => 'plan'))
    expect(tile('2026-11-21')).toHaveTextContent('+3')
  })

  const weekRules = () => [...root().querySelectorAll('[data-planner-week-rule]')].map((r) => r.getAttribute('data-planner-week-rule'))

  it('stands a rule before the tile that starts a week — by Settings’ first day of the week, never before the first tile', () => {
    // Fri 20 … Thu 26, weeks starting on Monday (the default): before Mon 23.
    show()
    expect(weekRules()).toEqual(['2026-11-23'])
    const strip = within(root()).getByRole('group', { name: 'Days' })
    expect(strip.querySelector('[data-planner-week-rule]')?.nextElementSibling).toBe(tile('2026-11-23'))
    // Still seven tiles between the arrows, and the rule is no button.
    expect(strip.querySelectorAll('[data-planner-tile]')).toHaveLength(7)
    expect(strip.querySelectorAll('button')).toHaveLength(9)
    cleanup()
    // Weeks starting on Sunday: before Sun 22.
    useSettingsStore.setState({ weekStartsOn: 0 })
    show()
    expect(weekRules()).toEqual(['2026-11-22'])
  })

  it('has no rule in a window that starts on the week’s first day', () => {
    // Today a Monday: the window is one whole week.
    vi.setSystemTime(new Date(2026, 10, 23, 10))
    show()
    expect(tileNames()[0]).toMatch(/^Today, Nov 23/)
    expect(weekRules()).toEqual([])
  })

  describe('a click on a tile', () => {
    /** The days pane as a scroller 300px high over 900px of content, each group 100px under the last. */
    function scrollable() {
      const scrollTo = vi.fn()
      const pane = root().querySelector<HTMLElement>('[data-planner-pane="days"]')!
      pane.scrollTo = scrollTo as unknown as typeof pane.scrollTo
      vi.spyOn(pane, 'scrollHeight', 'get').mockReturnValue(900)
      vi.spyOn(pane, 'clientHeight', 'get').mockReturnValue(300)
      pane.scrollTop = 40
      const rect = (top: number) => ({ top, bottom: top + 100, left: 0, right: 500, width: 500, height: 100, x: 0, y: top, toJSON: () => ({}) })
      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(rect(200))
      const groups = [...pane.querySelectorAll<HTMLElement>('[data-planner-group]')]
      // As drawn with the pane scrolled 40px: its content starts at 160.
      groups.forEach((g, i) => vi.spyOn(g, 'getBoundingClientRect').mockReturnValue(rect(160 + i * 100)))
      return scrollTo
    }

    it('scrolls the day list to that day — it picks nothing, and every day stays listed', () => {
      show()
      const scrollTo = scrollable()
      fireEvent.click(tile('2026-11-23'))
      // Mon is the fourth group: 300px into the content.
      expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })
      expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Unplanned'])
      expect(tile('2026-11-23')).not.toHaveAttribute('aria-pressed')
      expect(root().querySelector('[data-picked]')).toBeNull()
      // An empty day's tile goes to its quiet heading; today's to Today.
      fireEvent.click(tile('2026-11-22'))
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: 'smooth' })
      fireEvent.click(tile('2026-11-20'))
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
      expect(scrollTo).toHaveBeenCalledTimes(3)
    })

    it('scrolls at once under reduced motion', () => {
      const original = window.matchMedia
      window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion') })) as typeof window.matchMedia
      try {
        show()
        const scrollTo = scrollable()
        fireEvent.click(tile('2026-11-24'))
        expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'auto' })
      } finally {
        window.matchMedia = original
      }
    })

    it('does nothing where the list has nothing to scroll', () => {
      show()
      const into = vi.fn()
      for (const g of root().querySelectorAll<HTMLElement>('[data-planner-group]')) g.scrollIntoView = into
      fireEvent.click(tile('2026-11-23'))
      expect(into).not.toHaveBeenCalled()
      expect(root().querySelector<HTMLElement>('[data-planner-pane="days"]')!.scrollTop).toBe(0)
    })

    it('in a shifted window goes to that window’s day', () => {
      show()
      fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
      const scrollTo = scrollable()
      // Today, then Fri 27 … : Sat 28 is the third group.
      fireEvent.click(tile('2026-11-28'))
      expect(scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' })
    })
  })

  it('the arrows move the window a week; Today stays, and there is no week before this one', () => {
    show()
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(tileNames()).toEqual([
      // Sun 29: the due date of the task planned for today — a mark, no row.
      'Fri, Nov 27: no tasks', 'Sat, Nov 28: 1 task, 1 due', 'Sun, Nov 29: no tasks, 1 due', 'Mon, Nov 30: no tasks',
      'Tue, Dec 1: no tasks', 'Wed, Dec 2: no tasks', 'Thu, Dec 3: no tasks',
    ])
    expect(root().querySelector('[data-today]')).toBeNull()
    // Today is still today's; the days ahead are the window's, from its first day.
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    expect(groupNames()).toEqual(['Today', 'Fri, Nov 27', 'Sat, Nov 28', 'Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3', 'Unplanned'])
    expect(titlesIn(group('Sat, Nov 28'))).toEqual(['Next week deadline'])
    // Planned for today is due on the 29th, but its plan keeps it on today.
    expect(titlesIn(group('Sun, Nov 29'))).toEqual([])
    // This week's later days have no group while the window is shifted.
    expect(root()).not.toHaveTextContent('Monday deadline')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(tile('2026-11-20')).toHaveAttribute('data-today', 'true')
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
  })

  it('keeps the window by tab, across a remount (Open larger)', () => {
    const first = show()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    first.unmount()
    show({ forced: 'large' })
    expect(tileNames()[0]).toBe('Fri, Nov 27: no tasks')
    expect(usePlannerStore.getState().windows).toEqual({ [plannerWindowKey(null, 'plan')]: { offset: 7 } })
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

  it('has no Add task row', () => {
    show()
    expect(within(root()).queryByRole('button', { name: 'Add task' })).toBeNull()
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
    // The store's advance: the next due date, the plan cleared, the task still open.
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

  it('each pane’s rows share their columns: the days one list, the trays another', () => {
    show()
    expect(root().querySelectorAll('[data-planner-pane] > [data-zoom]')).toHaveLength(2)
  })

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
  it('a narrow cell shows the strip over one column: Today, the days ahead, the trays', () => {
    width = 500
    show()
    expect(root()).toHaveAttribute('data-planner-face', 'medium')
    expect(root().querySelector('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'column')
    expect(root().querySelector('[data-planner-pane]')).toBeNull()
    expect(root().querySelector('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'tiles')
    expect(root().querySelectorAll('[data-planner-tile]')).toHaveLength(7)
    expect(groupNames()).toEqual(['Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'Unplanned'])
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
    expect(groupNames()).toEqual(['Today', 'Mon, Nov 23', 'Thu, Nov 26', 'Unplanned'])
    expect(titlesIn(group('Today'))).toEqual(['Late invoice', 'Chase legal', 'Planned for today'])
    // The phone's rows: no draggable occurrence.
    expect(root().querySelector('[data-row-key], [data-drag-id]')).toBeNull()
  })

  it('has no Unplanned group with nothing in it', () => {
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
