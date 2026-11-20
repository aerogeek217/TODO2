import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { ListWidgetRow } from '../../../components/workspace/list/ListWidgetRow'
import { usePlannerMenuEntries } from '../../../components/workspace/planner/planner-reset'
import { PlannerWidget } from '../../../components/workspace/planner/PlannerWidget'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { MobileTaskRow } from '../../../components/task/MobileTaskRow'
import { TaskRowExtrasContext } from '../../../components/task/task-row-extras'
import { TaskLine } from '../../../components/task/TaskLine'
import { TaskRow } from '../../../components/task/TaskRow'
import { WidgetFaceContext, type WidgetFaceHost } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem } from '../../../models'
import type { PlannerTab } from '../../../models/workspace-layout'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { clearFilterStore, getByTooltip, makeTodo, resetEntityStores } from '../../helpers'

/**
 * The four Planner-only things on a Planner's rows — the corner flag on a
 * placed row, the tag after the title (a Delayed row's planned day, a held
 * row's natural day, a conflict's words as a button with its fixes), the
 * passed date drawn late, the Snooze / Unplan hover buttons —, Reset plan
 * (the top line's control and the ⋯ menu's submenu), and that a row outside
 * a Planner is untouched by any of it.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20, 10)
const day = (offset: number) => new Date(2026, 10, 20 + offset)
const PLANNER: PlannerTab = { id: 'plan', kind: 'planner', config: {} }

let width = 1100

const TODOS = (): PersistedTodoItem[] => [
  // Today.
  makeTodo({ id: 1, uid: 'due-today', title: 'Due today', dueDate: day(0), sortOrder: 1 }),
  makeTodo({ id: 2, uid: 'planned-today', title: 'Planned for today', doDate: day(0), dueDate: day(9), sortOrder: 2 }),
  // Mon 23: one there by its own date, one planned there.
  makeTodo({ id: 3, uid: 'mon-due', title: 'Monday deadline', dueDate: day(3), sortOrder: 3 }),
  makeTodo({ id: 4, uid: 'mon-plan', title: 'Monday plan', doDate: day(3), sortOrder: 4 }),
  // Tue 24: planned a day after its due date (Mon 23).
  makeTodo({ id: 5, uid: 'past-due', title: 'Past its due date', dueDate: day(3), doDate: day(4), sortOrder: 5 }),
  // Wed 25: planned past both dates — due Sun 22, follow-up Sat 21.
  makeTodo({ id: 6, uid: 'past-both', title: 'Past both dates', dueDate: day(2), nextFollowupAt: day(1), doDate: day(5), sortOrder: 6 }),
  // Thu 26: planned two days after its follow-up (Tue 24), its due date later.
  makeTodo({ id: 7, uid: 'past-followup', title: 'Past its follow-up', nextFollowupAt: day(4), dueDate: day(20), doDate: day(6), sortOrder: 7 }),
  // Delayed: planned for Wed 18.
  makeTodo({ id: 8, uid: 'missed', title: 'Missed plan', doDate: day(-2), dueDate: day(10), sortOrder: 8 }),
  // Unplanned: held with a natural day (Mon 23), held with none, in Focus.
  makeTodo({ id: 9, uid: 'held', title: 'Held call', unplanned: true, nextFollowupAt: day(3), sortOrder: 9 }),
  makeTodo({ id: 10, uid: 'held-bare', title: 'Held, no date', unplanned: true, sortOrder: 10 }),
  makeTodo({ id: 11, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 11 }),
]

const PLACED = ['Planned for today', 'Monday plan', 'Past its due date', 'Past both dates', 'Past its follow-up', 'Missed plan', 'Held, no date', 'Held call']

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
/** A task's row in the Planner: its box (the row and its flag). */
const rowOf = (title: string) => root().querySelector(`[data-task-title="${title}"]`)!.closest<HTMLElement>('[data-planner-row]')!
const flagged = () => [...root().querySelectorAll('[data-planner-row]')]
  .filter((row) => row.querySelector('[data-planner-flag]'))
  .map((row) => row.querySelector('[data-task-title]')?.getAttribute('data-task-title'))
const tagOf = (title: string) => rowOf(title).querySelector<HTMLElement>('[data-planner-tag]')
const tags = () => Object.fromEntries([...root().querySelectorAll('[data-planner-row]')]
  .filter((row) => row.querySelector('[data-planner-tag]'))
  .map((row) => [row.querySelector('[data-task-title]')?.getAttribute('data-task-title'), row.querySelector('[data-planner-tag]')?.textContent]))
const actionsOf = (title: string) => [...rowOf(title).querySelectorAll('[data-planner-actions] button')].map((b) => b.textContent)
const cell = (title: string, name: 'due' | 'followup') => rowOf(title).querySelector<HTMLElement>(`[data-row-cell="${name}"]`)!

/** The store's plan and edit writes, watched (nothing is stored). */
function watch() {
  const setPlan = vi.fn(() => Promise.resolve())
  const setPlans = vi.fn(() => Promise.resolve())
  const update = vi.fn(() => Promise.resolve(true))
  useTodoStore.setState({ setPlan, setPlans, update })
  return { setPlan, setPlans, update }
}

beforeEach(() => {
  width = 1100
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 700)
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

describe('the corner flag', () => {
  it('is on every row with a plan state — a planned day, Delayed, held in Unplanned — and on no other', () => {
    show()
    expect(flagged()).toEqual(PLACED)
    // There by its own date, or in Unplanned by Focus alone: no flag.
    for (const title of ['Due today', 'Monday deadline', 'Someday focus']) {
      expect(rowOf(title)).not.toHaveAttribute('data-planner-placed')
      expect(rowOf(title).querySelector('[data-planner-flag]')).toBeNull()
    }
    const flag = rowOf('Monday plan').querySelector('[data-planner-flag]')!
    expect(flag).toHaveAttribute('aria-hidden', 'true')
    // Around the list's row, not in it: the row is the list's own.
    expect(flag.parentElement).toBe(rowOf('Monday plan'))
    expect(flag.closest('[data-row-key]')).toBeNull()
  })

  it('is not on a row whose plan is redundant — planned for the very day its own date puts it', () => {
    useTodoStore.setState({
      todos: [
        // Added in the Planner with a due date of today; and a planned task whose due date was edited onto its planned day.
        makeTodo({ id: 1, title: 'Added due today', doDate: day(0), dueDate: day(0) }),
        makeTodo({ id: 2, title: 'Edited onto its day', doDate: day(3), dueDate: day(3) }),
        // Yesterday's: overdue in Today, not in Delayed.
        makeTodo({ id: 3, title: 'Yesterday’s', doDate: day(-1), dueDate: day(-1) }),
      ],
    })
    show()
    expect(flagged()).toEqual([])
    expect(rowOf('Yesterday’s').closest('[data-planner-group]')).toHaveAttribute('data-planner-group-kind', 'today')
    expect(root().querySelector('[data-planner-group="delayed"]')).toBeNull()
    expect(root().querySelector('[data-mark="plan"]')).toBeNull()
  })

  it('is there in the Stacked and the Lines styles too', () => {
    width = 400
    show({ forced: 'large' })
    expect(root().querySelector('[data-zoom]')).toHaveAttribute('data-zoom', 'stacked')
    expect(flagged()).toEqual(PLACED)
    cleanup()
    useSettingsStore.setState({ listZoom: 'lines' })
    show({ forced: 'large' })
    expect(root().querySelector('[data-zoom]')).toHaveAttribute('data-zoom', 'lines')
    expect(flagged()).toEqual(PLACED)
  })

  it('leaves a row that lingers after its completion, with its tag and its hover buttons', () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    show()
    expect(flagged()).toContain('Past its due date')
    act(() => {
      useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 5 ? { ...t, isCompleted: true, completedAt: new Date() } : t)) })
    })
    // Still in its group, completed — and plain.
    expect(rowOf('Past its due date')).toBeInTheDocument()
    expect(rowOf('Past its due date').querySelector('[data-leaving]')).not.toBeNull()
    expect(flagged()).not.toContain('Past its due date')
    expect(tagOf('Past its due date')).toBeNull()
    expect(actionsOf('Past its due date')).toEqual([])
    expect(cell('Past its due date', 'due')).not.toHaveAttribute('data-date-level', 'late')
    act(() => { vi.advanceTimersByTime(700) })
    expect(root().querySelector('[data-task-title="Past its due date"]')).toBeNull()
  })
})

describe('the tag after the title', () => {
  it('a Delayed row: the day it was planned for; a held row with a natural day: that day; a row planned past a real date: how far past', () => {
    show()
    expect(tags()).toEqual({
      'Missed plan': 'Wed',
      'Held call': 'Mon',
      'Past its due date': '1 day after due',
      'Past both dates': '3 days after due',
      'Past its follow-up': '2 days after follow-up',
    })
    // The two day tags are plain, muted text with the day in full as a tooltip; the conflict's is a button.
    expect(tagOf('Missed plan')).toHaveAttribute('data-planner-tag', 'planned')
    expect(tagOf('Missed plan')?.tagName).toBe('SPAN')
    expect(getByTooltip(rowOf('Missed plan'), 'Planned for Wed, Nov 18')).toBe(tagOf('Missed plan'))
    expect(tagOf('Held call')).toHaveAttribute('data-planner-tag', 'natural')
    expect(getByTooltip(rowOf('Held call'), 'Its own date puts it on Mon, Nov 23')).toBe(tagOf('Held call'))
    expect(tagOf('Past its due date')).toHaveAttribute('data-planner-tag', 'conflict')
    expect(tagOf('Past its due date')?.tagName).toBe('BUTTON')
    expect(within(rowOf('Past its due date')).getByRole('button', { name: '1 day after due' })).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('sits right after the title’s text on a row, and leads the details line of a stacked one', () => {
    show()
    const title = rowOf('Past its due date').querySelector('[data-task-title]')!
    expect(title.querySelector('[data-title-text]')?.nextElementSibling).toBe(tagOf('Past its due date'))
    cleanup()
    width = 400
    show({ forced: 'large' })
    const details = rowOf('Past its due date').querySelector('[data-stacked-details]')!
    expect(details.firstElementChild).toBe(tagOf('Past its due date'))
    expect(rowOf('Past its due date').querySelector('[data-task-title] [data-planner-tag]')).toBeNull()
  })

  it('is on a Lines row too', () => {
    useSettingsStore.setState({ listZoom: 'lines' })
    show()
    expect(tags()).toMatchObject({ 'Missed plan': 'Wed', 'Held call': 'Mon', 'Past its due date': '1 day after due' })
    expect(rowOf('Past its due date').querySelector('[data-task-title]')?.nextElementSibling).toBe(tagOf('Past its due date'))
  })

  describe('a conflict’s tag opens its fixes', () => {
    const open = (title: string) => {
      fireEvent.click(tagOf(title)!)
      return screen.getByRole('menu', { name: 'Fix the plan' })
    }
    const items = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('data-menu-label'))

    it('lists Move due date to the planned day, then Plan for the due date’s day', () => {
      show()
      expect(tagOf('Past its due date')).toHaveAttribute('aria-expanded', 'false')
      const menu = open('Past its due date')
      expect(tagOf('Past its due date')).toHaveAttribute('aria-expanded', 'true')
      expect(items(menu)).toEqual(['Move due date to Tue, Nov 24', 'Plan for Mon, Nov 23'])
    })

    it('with both dates passed, lists each date’s fixes', () => {
      show()
      expect(items(open('Past both dates'))).toEqual([
        'Move due date to Wed, Nov 25', 'Plan for Sun, Nov 22', 'Move follow-up to Wed, Nov 25', 'Plan for Sat, Nov 21',
      ])
    })

    it('a follow-up’s: Move follow-up to …, Plan for …', () => {
      show()
      expect(items(open('Past its follow-up'))).toEqual(['Move follow-up to Thu, Nov 26', 'Plan for Tue, Nov 24'])
    })

    it('Move due date … edits the due date — and clears the plan it makes redundant; the row is not opened', () => {
      const { update, setPlan } = watch()
      const openEdit = vi.fn()
      show()
      fireEvent.click(within(open('Past its due date')).getByRole('menuitem', { name: 'Move due date to Tue, Nov 24' }))
      expect(update).toHaveBeenCalledTimes(1)
      expect(update).toHaveBeenCalledWith(5, { dueDate: day(4), doDate: undefined, unplanned: undefined })
      expect(setPlan).not.toHaveBeenCalled()
      expect(openEdit).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu', { name: 'Fix the plan' })).toBeNull()
    })

    it('Plan for … moves the plan and no date', () => {
      const { update, setPlan } = watch()
      show()
      fireEvent.click(within(open('Past its follow-up')).getByRole('menuitem', { name: 'Plan for Tue, Nov 24' }))
      // Tue 24 is the day its follow-up puts it: the plan is cleared.
      expect(setPlan).toHaveBeenCalledWith([7], null)
      expect(update).not.toHaveBeenCalled()
    })

    it('Esc closes the menu with the focus back on the tag', () => {
      show()
      const tag = tagOf('Past its due date')!
      tag.focus()
      const menu = open('Past its due date')
      fireEvent.keyDown(menu, { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: 'Fix the plan' })).toBeNull()
      expect(document.activeElement).toBe(tag)
    })
  })
})

describe('the date a plan falls after', () => {
  it('is drawn late — bold over its band — though it is not past; the others as they are', () => {
    show()
    // Due Mon 23 (three days ahead), planned Tue 24.
    const due = cell('Past its due date', 'due')
    expect(due).toHaveAttribute('data-date-level', 'late')
    expect(due).toHaveAttribute('data-due-past', 'true')
    // Its name still says the date, not that it is late.
    expect(due).toHaveAccessibleName(/^Due /)
    // The same date on a row with no plan: not late.
    expect(cell('Monday deadline', 'due')).toHaveAttribute('data-date-level', 'soon')
    expect(cell('Monday deadline', 'due')).not.toHaveAttribute('data-due-past')
    // A follow-up the plan falls after; the due date after the plan is left alone.
    expect(cell('Past its follow-up', 'followup')).toHaveAttribute('data-followup', 'late')
    expect(cell('Past its follow-up', 'followup')).toHaveAttribute('data-date-level', 'late')
    expect(cell('Past its follow-up', 'followup')).toHaveAccessibleName(/^Follow-up: (?!.*late)/)
    expect(cell('Past its follow-up', 'due')).toHaveAttribute('data-date-level', 'later')
    // Both.
    expect(cell('Past both dates', 'due')).toHaveAttribute('data-date-level', 'late')
    expect(cell('Past both dates', 'followup')).toHaveAttribute('data-date-level', 'late')
    // A Delayed row's and a held row's dates are not drawn late.
    expect(cell('Missed plan', 'due')).toHaveAttribute('data-date-level', 'later')
    expect(cell('Held call', 'followup')).toHaveAttribute('data-followup', 'upcoming')
  })

  it('in the Stacked style too', () => {
    width = 400
    show({ forced: 'large' })
    expect(cell('Past its due date', 'due')).toHaveAttribute('data-date-level', 'late')
    expect(cell('Past its follow-up', 'followup')).toHaveAttribute('data-date-level', 'late')
    expect(cell('Monday deadline', 'due')).toHaveAttribute('data-date-level', 'soon')
  })
})

describe('the hover buttons', () => {
  it('Snooze and Unplan on a row of a day and of Delayed; Snooze alone on a row already in Unplanned', () => {
    show()
    for (const title of ['Due today', 'Planned for today', 'Monday deadline', 'Monday plan', 'Past its due date', 'Missed plan']) {
      expect(actionsOf(title)).toEqual(['Snooze', 'Unplan'])
    }
    for (const title of ['Held call', 'Held, no date', 'Someday focus']) expect(actionsOf(title)).toEqual(['Snooze'])
    // In the row's hover cluster, at the title's end.
    expect(rowOf('Due today').querySelector('[data-planner-actions]')?.closest('[data-row-cluster]')).not.toBeNull()
  })

  it('are in a stacked row too, and on no Lines row', () => {
    width = 400
    show({ forced: 'large' })
    expect(actionsOf('Monday plan')).toEqual(['Snooze', 'Unplan'])
    expect(actionsOf('Held call')).toEqual(['Snooze'])
    cleanup()
    useSettingsStore.setState({ listZoom: 'lines' })
    show({ forced: 'large' })
    expect(root().querySelector('[data-planner-actions]')).toBeNull()
  })

  it('Snooze plans the row for the next day; Unplan moves it to Unplanned — and neither opens the task', () => {
    const { setPlan, update } = watch()
    show()
    const press = (title: string, name: string) => fireEvent.click(within(rowOf(title)).getByRole('button', { name }))
    press('Due today', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([1], { day: day(1) })
    // From Mon 23 to Tue 24.
    press('Monday plan', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([4], { day: day(4) })
    // A tray's row: tomorrow.
    press('Someday focus', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([11], { day: day(1) })
    press('Monday deadline', 'Unplan')
    expect(setPlan).toHaveBeenLastCalledWith([3], 'unplanned')
    // No date of its own and not in Focus: held, so it stays in the Planner.
    press('Monday plan', 'Unplan')
    expect(setPlan).toHaveBeenLastCalledWith([4], 'unplanned')
    expect(setPlan).toHaveBeenCalledTimes(5)
    expect(update).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('say what they do in a tooltip', () => {
    show()
    expect(getByTooltip(rowOf('Monday plan'), 'Plan for Tue, Nov 24')).toHaveTextContent('Snooze')
    expect(getByTooltip(rowOf('Monday plan'), 'Move to Unplanned')).toHaveTextContent('Unplan')
  })
})

describe('on the phone', () => {
  let original: typeof window.matchMedia

  beforeEach(() => {
    original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    width = 359
  })

  afterEach(() => {
    window.matchMedia = original
  })

  it('a placed row has its flag and its tag (on a line under it), a passed date is drawn late — and there are no hover buttons', () => {
    show({ heightFree: true })
    expect(flagged()).toEqual(PLACED)
    expect(tags()).toMatchObject({ 'Missed plan': 'Wed', 'Held call': 'Mon', 'Past its due date': '1 day after due' })
    expect(root().querySelector('[data-planner-actions]')).toBeNull()
    expect(rowOf('Past its due date').querySelector('[data-row-part="due"]')).toHaveAttribute('data-date-level', 'late')
    expect(rowOf('Monday deadline').querySelector('[data-row-part="due"]')).toHaveAttribute('data-date-level', 'soon')
    // A follow-up the plan falls after shows there, late (the phone shows a follow-up only when it asks for action).
    expect(rowOf('Past its follow-up').querySelector('[data-row-part="followup"]')).toHaveAttribute('data-date-level', 'late')
    expect(rowOf('Held call').querySelector('[data-row-part="followup"]')).toBeNull()
    // The conflict's tag opens its fixes there too.
    fireEvent.click(tagOf('Past its due date')!)
    expect(within(screen.getByRole('menu', { name: 'Fix the plan' })).getAllByRole('menuitem')).toHaveLength(2)
  })
})

describe('Reset plan', () => {
  const controls: CellControlsValue = {
    cellId: 'c', tabs: [PLANNER], tabId: 'plan', title: 'Planner', touch: false, setMoreButton: () => undefined, menuOpen: false,
    onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
  }
  const alone = () => render(<DndContext><CellControlsContext.Provider value={controls}><PlannerWidget tab={PLANNER} /></CellControlsContext.Provider></DndContext>)
  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reset plan' }))
    return screen.getByRole('menu', { name: 'Reset plan' })
  }
  const rows = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => [i.getAttribute('data-menu-label'), i.textContent?.replace(i.getAttribute('data-menu-label') ?? '', ''), (i as HTMLButtonElement).disabled])

  it('is in the top line of a Planner alone in its cell: an icon and the words, opening its three choices with their counts', () => {
    alone()
    const button = screen.getByRole('button', { name: 'Reset plan' })
    expect(button).toHaveTextContent('Reset plan')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button.closest('[data-widget-top-line]')).not.toBeNull()
    // This week: every placed task the Planner shows (8). Today only: the one planned for today. Delayed: one.
    expect(rows(openMenu())).toEqual([['This week', '8', false], ['Today only', '1', false], ['Delayed', '1', false]])
  })

  it('a choice with nothing to clear is inert', () => {
    useTodoStore.setState({ todos: TODOS().filter((t) => t.uid !== 'missed' && t.uid !== 'planned-today') })
    alone()
    expect(rows(openMenu())).toEqual([['This week', '6', false], ['Today only', '0', true], ['Delayed', '0', true]])
    cleanup()
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'By its date', dueDate: day(1) })] })
    alone()
    expect(rows(openMenu())).toEqual([['This week', '0', true], ['Today only', '0', true], ['Delayed', '0', true]])
  })

  it('each choice clears those tasks’ plans in one write, one undo step with the snackbar — and no date', () => {
    const { setPlan, update } = watch()
    alone()
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^This week/ }))
    expect(setPlan).toHaveBeenLastCalledWith([2, 4, 5, 6, 7, 8, 10, 9], null, 'Reset plan: this week', true)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^Today only/ }))
    expect(setPlan).toHaveBeenLastCalledWith([2], null, 'Reset plan: today', true)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^Delayed/ }))
    expect(setPlan).toHaveBeenLastCalledWith([8], null, 'Reset plan: Delayed', true)
    expect(setPlan).toHaveBeenCalledTimes(3)
    expect(update).not.toHaveBeenCalled()
  })

  it('has no top-line control in a cell of tabs: the same three are under Reset plan › in the widget’s ⋯ menu', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Reset plan' })).toBeNull()
    const { setPlan } = watch()
    const { result } = renderHook(() => usePlannerMenuEntries(PLANNER))
    const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
    expect(result.current.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['Reset plan'])
    const choices = item(result.current, 'Reset plan').children ?? []
    expect(choices.map((e) => (e.kind === 'item' ? [e.label, e.note, e.disabled] : e.kind))).toEqual([
      ['This week', '8', false], ['Today only', '1', false], ['Delayed', '1', false],
    ])
    item(choices, 'Delayed').onSelect?.()
    expect(setPlan).toHaveBeenCalledWith([8], null, 'Reset plan: Delayed', true)
  })

  it('offers nothing for a tab that is no Planner', () => {
    const { result } = renderHook(() => usePlannerMenuEntries(undefined))
    expect(result.current).toEqual([])
  })
})

describe('a row outside a Planner', () => {
  const dated = makeTodo({ id: 50, title: 'A list’s task', dueDate: day(3), nextFollowupAt: day(4), doDate: day(6), sortOrder: 1 })
  const html = (ui: React.ReactNode) => {
    const { container, unmount } = render(ui)
    const out = container.innerHTML
    unmount()
    return out
  }
  const none = () => null

  it('draws exactly as it does with no extras: a desktop row, a stacked row, a line and a phone row', () => {
    const kinds: Array<[string, React.ReactNode]> = [
      ['row', <TaskRow todo={dated} />],
      ['stacked', <TaskRow todo={dated} stacked />],
      ['line', <TaskLine todo={dated} />],
      ['phone', <MobileTaskRow todo={dated} />],
    ]
    for (const [kind, row] of kinds) {
      const bare = html(row)
      expect(bare, kind).not.toMatch(/data-planner|data-row-cluster="[^"]*"[^>]*>\s*<span[^>]*data-planner/)
      // A provider with nothing to add changes nothing.
      expect(html(<TaskRowExtrasContext.Provider value={none}>{row}</TaskRowExtrasContext.Provider>), kind).toBe(bare)
    }
  })

  it('a list widget’s row has no flag, tag or hover buttons, and its dates are as late as they are — whatever plan the task has', () => {
    render(
      <DndContext>
        <ListWidgetRow
          todo={dated}
          tabId="a-list"
          sectionKey="all"
          rowKey="all|50"
          selected={false}
          selFirst
          selLast
          cursor={false}
          look="idle"
          onSelect={() => {}}
          onOpenDetail={() => {}}
        />
      </DndContext>,
    )
    const row = document.querySelector<HTMLElement>('[data-row-key="all|50"]')!
    expect(row.querySelector('[data-planner-flag], [data-planner-tag], [data-planner-actions]')).toBeNull()
    expect(row.parentElement?.closest('[data-planner-row]')).toBeNull()
    // Planned for a day after both dates: in a list neither is drawn late.
    expect(row.querySelector('[data-row-cell="due"]')).toHaveAttribute('data-date-level', 'soon')
    expect(row.querySelector('[data-row-cell="due"]')).not.toHaveAttribute('data-due-past')
    expect(row.querySelector('[data-row-cell="followup"]')).toHaveAttribute('data-followup', 'upcoming')
  })

  it('the extras reach a row only through the provider: a tag, buttons and a late date where one says so', () => {
    const extras = () => ({ tag: <span data-test-tag="">tag</span>, actions: <button type="button" data-test-action="">Go</button>, late: { due: true } })
    render(<DndContext><TaskRowExtrasContext.Provider value={extras}><TaskRow todo={dated} /></TaskRowExtrasContext.Provider></DndContext>)
    expect(document.querySelector('[data-task-title] [data-test-tag]')).not.toBeNull()
    expect(document.querySelector('[data-row-cluster] [data-test-action]')).not.toBeNull()
    expect(document.querySelector('[data-row-cell="due"]')).toHaveAttribute('data-date-level', 'late')
    expect(document.querySelector('[data-row-cell="followup"]')).toHaveAttribute('data-followup', 'upcoming')
    cleanup()
    // The drag overlay's copy of the row takes none.
    render(<DndContext><TaskRowExtrasContext.Provider value={extras}><TaskRow todo={dated} ghost /></TaskRowExtrasContext.Provider></DndContext>)
    expect(document.querySelector('[data-test-tag], [data-test-action]')).toBeNull()
  })
})
