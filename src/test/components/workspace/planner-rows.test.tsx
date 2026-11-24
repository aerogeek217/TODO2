import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
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
import { plannerWindowKey, usePlannerStore } from '../../../stores/planner-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { clearFilterStore, getByTooltip, makeTodo, resetEntityStores } from '../../helpers'

/**
 * The four Planner-only things on a Planner's rows — the corner flag on a
 * placed row, the tag after the title (a Delayed row's planned day, a
 * conflict's words as a button with its fixes), the passed date drawn late,
 * the Snooze / Unplan (or Remove) / Today hover buttons —, Reset plan
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
  // Unplanned: in Focus.
  makeTodo({ id: 11, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 11 }),
]

const PLACED = ['Planned for today', 'Monday plan', 'Past its due date', 'Past both dates', 'Past its follow-up', 'Missed plan']

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
  const setPlan = vi.fn(() => Promise.resolve(true))
  const setPlans = vi.fn(() => Promise.resolve(true))
  const update = vi.fn(() => Promise.resolve(true))
  useTodoStore.setState({ setPlan, setPlans, update })
  // Reset plan asks first: answered yes.
  const askConfirmation = vi.fn(() => Promise.resolve(true))
  useUIStore.setState({ askConfirmation })
  return { setPlan, setPlans, update, askConfirmation }
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
  it('is on every row with a plan — a planned day, Delayed — and on no other: never on a row in Unplanned', () => {
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

  it('is on a row planned for the very day its own date puts it — a plan like any other', () => {
    useTodoStore.setState({
      todos: [
        // Added in the Planner with a due date of today; and a planned task whose due date was edited onto its planned day.
        makeTodo({ id: 1, title: 'Added due today', doDate: day(0), dueDate: day(0) }),
        makeTodo({ id: 2, title: 'Edited onto its day', doDate: day(3), dueDate: day(3) }),
        // Yesterday's: its plan has passed, so it is Delayed.
        makeTodo({ id: 3, title: 'Yesterday’s', doDate: day(-1), dueDate: day(-1) }),
      ],
    })
    show()
    expect(flagged()).toEqual(['Added due today', 'Edited onto its day', 'Yesterday’s'])
    expect(rowOf('Yesterday’s').closest('[data-planner-group]')).toHaveAttribute('data-planner-group-kind', 'delayed')
    expect(root().querySelector('[data-mark="plan"]')).not.toBeNull()
  })

  it('is drawn only: the row’s accessible description says it in words — planned, planned for a day', () => {
    show()
    const box = (title: string) => within(rowOf(title)).getByRole('checkbox')
    expect(box('Monday plan')).toHaveAccessibleDescription('planned')
    expect(box('Past its due date')).toHaveAccessibleDescription('planned')
    expect(box('Missed plan')).toHaveAccessibleDescription('planned for Wed')
    // A row with no flag has none; its checkbox keeps its name.
    expect(box('Monday deadline')).not.toHaveAttribute('aria-description')
    expect(box('Someday focus')).not.toHaveAttribute('aria-description')
    expect(box('Monday plan')).toHaveAccessibleName('Mark complete')
    cleanup()
    // A line (its own tab stop) carries it too.
    useSettingsStore.setState({ listZoom: 'lines' })
    show()
    expect(rowOf('Missed plan').querySelector('[data-task-line]')).toHaveAttribute('aria-description', 'planned for Wed')
    expect(rowOf('Monday deadline').querySelector('[data-task-line]')).not.toHaveAttribute('aria-description')
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
  it('a Delayed row: the day it was planned for; a row planned past a real date: how far past; none in Unplanned', () => {
    show()
    expect(tags()).toEqual({
      'Missed plan': 'Wed',
      'Past its due date': '1 day after due',
      'Past both dates': '3 days after due',
      'Past its follow-up': '2 days after follow-up',
    })
    // The two day tags are plain, muted text with the day in full as a tooltip; the conflict's is a button.
    expect(tagOf('Missed plan')).toHaveAttribute('data-planner-tag', 'planned')
    expect(tagOf('Missed plan')?.tagName).toBe('SPAN')
    expect(getByTooltip(rowOf('Missed plan'), 'Planned for Wed, Nov 18')).toBe(tagOf('Missed plan'))
    expect(tagOf('Someday focus')).toBeNull()
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
    expect(tags()).toMatchObject({ 'Missed plan': 'Wed', 'Past its due date': '1 day after due' })
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
      expect(update).toHaveBeenCalledWith(5, { dueDate: day(4), doDate: undefined })
      expect(setPlan).not.toHaveBeenCalled()
      expect(openEdit).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu', { name: 'Fix the plan' })).toBeNull()
    })

    it('Plan for … moves the plan and no date', () => {
      const { update, setPlan } = watch()
      show()
      fireEvent.click(within(open('Past its follow-up')).getByRole('menuitem', { name: 'Plan for Tue, Nov 24' }))
      // Tue 24 is the day its follow-up puts it: planned there outright.
      expect(setPlan).toHaveBeenCalledWith([7], { day: day(4) })
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

describe('a row planned later — for a day past the days shown', () => {
  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        // On the window's last day (Thu 26) by its due date, planned for Fri 27.
        makeTodo({ id: 1, title: 'Snoozed past the week', dueDate: day(6), doDate: day(7), sortOrder: 1 }),
        // Overdue, planned for next Saturday: still in Today.
        makeTodo({ id: 2, title: 'Overdue, planned next week', nextFollowupAt: day(-3), doDate: day(8), sortOrder: 2 }),
        // Planned past the window with no date: not shown.
        makeTodo({ id: 3, title: 'No date, next week', doDate: day(9), sortOrder: 3 }),
      ],
    })
  })

  it('stays on the day its date puts it, flagged, with a muted tag naming the planned day and its date drawn late', () => {
    show()
    expect(rowOf('Snoozed past the week').closest('[data-planner-group]')).toHaveAttribute('aria-label', 'Thu, Nov 26')
    expect(rowOf('Overdue, planned next week').closest('[data-planner-group]')).toHaveAttribute('aria-label', 'Today')
    expect(root().querySelector('[data-task-title="No date, next week"]')).toBeNull()
    expect(flagged()).toEqual(['Overdue, planned next week', 'Snoozed past the week'])
    expect(tags()).toEqual({ 'Snoozed past the week': 'planned Fri, Nov 27', 'Overdue, planned next week': 'planned Sat, Nov 28' })
    const tag = tagOf('Snoozed past the week')!
    expect(tag).toHaveAttribute('data-planner-tag', 'later')
    expect(tag.tagName).toBe('BUTTON')
    expect(getByTooltip(rowOf('Snoozed past the week'), 'Planned for Fri, Nov 27, after the days shown. Click to fix')).toBe(tag)
    expect(cell('Snoozed past the week', 'due')).toHaveAttribute('data-date-level', 'late')
    // The tile counts the row; the plan, on no day shown, marks none.
    const thu = root().querySelector('[data-planner-tile="2026-11-26"]')!
    expect(within(thu as HTMLElement).getByTestId('planner-tile-count')).toHaveTextContent('1')
    expect(thu.querySelector('[data-mark="plan"]')).toBeNull()
  })

  it('its tag opens the fixes: move the date to the planned day, or plan for the date’s day', () => {
    const { setPlan, update } = watch()
    show()
    fireEvent.click(tagOf('Snoozed past the week')!)
    const menu = screen.getByRole('menu', { name: 'Fix the plan' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('data-menu-label'))).toEqual(['Move due date to Fri, Nov 27', 'Plan for Thu, Nov 26'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Plan for Thu, Nov 26' }))
    expect(setPlan).toHaveBeenCalledWith([1], { day: day(6) })
    expect(update).not.toHaveBeenCalled()
    // An overdue date has only the move.
    fireEvent.click(tagOf('Overdue, planned next week')!)
    expect(within(screen.getByRole('menu', { name: 'Fix the plan' })).getAllByRole('menuitem').map((i) => i.getAttribute('data-menu-label'))).toEqual(['Move follow-up to Sat, Nov 28'])
  })

  it('Snooze moves the plan on from the planned day; Reset plan counts the row', () => {
    const { setPlan } = watch()
    show()
    fireEvent.click(within(rowOf('Snoozed past the week')).getByRole('button', { name: 'Snooze' }))
    expect(setPlan).toHaveBeenLastCalledWith([1], { day: day(8) })
    expect(getByTooltip(rowOf('Snoozed past the week'), 'Plan for Sat, Nov 28')).toHaveTextContent('Snooze')
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
    // A Delayed row's dates are not drawn late.
    expect(cell('Missed plan', 'due')).toHaveAttribute('data-date-level', 'later')
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
  it('Snooze on a row of a day and of Delayed, with Unplan on a placed one — Remove when clearing takes it out; Today alone in Unplanned', () => {
    show()
    // There by its own date: nothing to unplan.
    for (const title of ['Due today', 'Monday deadline']) expect(actionsOf(title)).toEqual(['Snooze'])
    // Placed, and its own date keeps it in the Planner once cleared.
    for (const title of ['Past its due date', 'Past both dates', 'Past its follow-up']) expect(actionsOf(title)).toEqual(['Snooze', 'Unplan'])
    // Placed, with no date in the window and not in Focus: clearing takes it out.
    for (const title of ['Planned for today', 'Monday plan', 'Missed plan']) expect(actionsOf(title)).toEqual(['Snooze', 'Remove'])
    // In Unplanned: never placed, so only Today — no Clear or Remove there.
    expect(actionsOf('Someday focus')).toEqual(['Today'])
    expect(rowOf('Someday focus').querySelector('[data-row-cell="planner-clear"], [data-row-cell="planner-unplan"]')).toBeNull()
    expect(rowOf('Monday plan').querySelector('[data-row-cell="planner-unplan"]')).toHaveTextContent('Remove')
    // In the row's hover cluster, at the title's end.
    expect(rowOf('Due today').querySelector('[data-planner-actions]')?.closest('[data-row-cluster]')).not.toBeNull()
  })

  it('are in a stacked row too, and on no Lines row', () => {
    width = 400
    show({ forced: 'large' })
    expect(actionsOf('Past its due date')).toEqual(['Snooze', 'Unplan'])
    expect(actionsOf('Monday plan')).toEqual(['Snooze', 'Remove'])
    expect(actionsOf('Someday focus')).toEqual(['Today'])
    cleanup()
    useSettingsStore.setState({ listZoom: 'lines' })
    show({ forced: 'large' })
    expect(root().querySelector('[data-planner-actions]')).toBeNull()
  })

  it('Snooze plans the row for the next day; Unplan clears its plan, Remove too, saying so — and none opens the task', () => {
    const { setPlan, update } = watch()
    show()
    const press = (title: string, name: string) => fireEvent.click(within(rowOf(title)).getByRole('button', { name }))
    press('Due today', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([1], { day: day(1) })
    // From Mon 23 to Tue 24.
    press('Monday plan', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([4], { day: day(4) })
    // A Delayed row: tomorrow.
    press('Missed plan', 'Snooze')
    expect(setPlan).toHaveBeenLastCalledWith([8], { day: day(1) })
    // Back to its due day: the plain plan write.
    press('Past its due date', 'Unplan')
    expect(setPlan).toHaveBeenLastCalledWith([5], null)
    // No date of its own and not in Focus: it leaves the Planner, and the snackbar says so.
    press('Monday plan', 'Remove')
    expect(setPlan).toHaveBeenLastCalledWith([4], null, 'Removed “Monday plan” from the Planner', true)
    expect(setPlan).toHaveBeenCalledTimes(5)
    expect(update).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Today plans an Unplanned row for today', () => {
    const { setPlan, update } = watch()
    show()
    fireEvent.click(within(rowOf('Someday focus')).getByRole('button', { name: 'Today' }))
    expect(setPlan).toHaveBeenLastCalledWith([11], { day: day(0) })
    expect(update).not.toHaveBeenCalled()
    expect(getByTooltip(rowOf('Someday focus'), 'Plan for today')).toHaveTextContent('Today')
  })

  it('say what they do in a tooltip', () => {
    show()
    expect(getByTooltip(rowOf('Monday plan'), 'Plan for Tue, Nov 24')).toHaveTextContent('Snooze')
    expect(getByTooltip(rowOf('Past its due date'), 'Clear the plan')).toHaveTextContent('Unplan')
    expect(getByTooltip(rowOf('Monday plan'), 'Clear the plan: it leaves the Planner')).toHaveTextContent('Remove')
  })
})

describe('the focus follows a row moved from the keyboard', () => {
  /** The plan writes applied to the store's tasks (no database): the rows move as they would. */
  function livePlans() {
    const setPlan = vi.fn((ids: number[], plan: { day: Date } | null) => {
      act(() => {
        useTodoStore.setState({
          todos: useTodoStore.getState().todos.map((t) => (ids.includes(t.id) ? { ...t, doDate: plan ? plan.day : undefined } : t)),
        })
      })
      return Promise.resolve(true)
    })
    useTodoStore.setState({ setPlan })
    return setPlan
  }
  const groupOf = (title: string) => rowOf(title).closest('[data-planner-group]')?.getAttribute('aria-label')
  const button = (title: string, name: string) => within(rowOf(title)).getByRole('button', { name })
  /** A press of Enter or Space on the focused button: a click that counts no pointer press. */
  const keyPress = (el: HTMLElement) => { el.focus(); fireEvent.click(el, { detail: 0 }) }

  it('Snooze: to the same button of the row at its new place — so Enter again snoozes on', async () => {
    livePlans()
    show()
    keyPress(button('Monday deadline', 'Snooze'))
    await waitFor(() => expect(groupOf('Monday deadline')).toBe('Tue, Nov 24'))
    await waitFor(() => expect(document.activeElement).toBe(button('Monday deadline', 'Snooze')))
    keyPress(button('Monday deadline', 'Snooze'))
    await waitFor(() => expect(groupOf('Monday deadline')).toBe('Wed, Nov 25'))
    await waitFor(() => expect(document.activeElement).toBe(button('Monday deadline', 'Snooze')))
  })

  it('Unplan: to the row in Unplanned — its Today button, the row having no Unplan there', async () => {
    useTodoStore.setState({ todos: [...TODOS(), makeTodo({ id: 12, title: 'Focus plan', focus: true, doDate: day(3), sortOrder: 12 })] })
    livePlans()
    show()
    keyPress(button('Focus plan', 'Unplan'))
    await waitFor(() => expect(groupOf('Focus plan')).toBe('Unplanned'))
    await waitFor(() => expect(document.activeElement).toBe(button('Focus plan', 'Today')))
  })

  it('Unplan back to its own day: to the row there — its Snooze button, the row having no Unplan there', async () => {
    livePlans()
    show()
    keyPress(button('Past its due date', 'Unplan'))
    await waitFor(() => expect(groupOf('Past its due date')).toBe('Mon, Nov 23'))
    await waitFor(() => expect(document.activeElement).toBe(button('Past its due date', 'Snooze')))
  })

  it('Remove: the row gone, to the row that took its place', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'First plan', doDate: day(1), sortOrder: 1 }),
        makeTodo({ id: 2, title: 'Second plan', doDate: day(1), sortOrder: 2 }),
      ],
    })
    livePlans()
    show()
    keyPress(button('First plan', 'Remove'))
    await waitFor(() => expect(root().querySelector('[data-task-title="First plan"]')).toBeNull())
    await waitFor(() => expect(document.activeElement?.closest('[data-planner-row]')).toBe(rowOf('Second plan')))
  })

  it('Today: to the row in Today — its Snooze button', async () => {
    livePlans()
    show()
    keyPress(button('Someday focus', 'Today'))
    await waitFor(() => expect(groupOf('Someday focus')).toBe('Today'))
    await waitFor(() => expect(document.activeElement).toBe(button('Someday focus', 'Snooze')))
  })

  it('a fix: the tag gone with the conflict, to the row it was on', async () => {
    livePlans()
    show()
    // Planned Thu 26, follow-up Tue 24: Plan for Tue clears the plan — the row moves to Tue and has no tag.
    keyPress(tagOf('Past its follow-up')!)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Fix the plan' })).getByRole('menuitem', { name: 'Plan for Tue, Nov 24' }))
    await waitFor(() => expect(groupOf('Past its follow-up')).toBe('Tue, Nov 24'))
    expect(tagOf('Past its follow-up')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(button('Past its follow-up', 'Snooze')))
  })

  it('a row that leaves the view: to the row that took its place, else to its group’s heading', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Last day, first', doDate: day(6), sortOrder: 1 }),
        makeTodo({ id: 2, title: 'Last day, second', doDate: day(6), sortOrder: 2 }),
      ],
    })
    livePlans()
    show()
    // Snoozed past the window with no date: gone from the days shown.
    keyPress(button('Last day, first', 'Snooze'))
    await waitFor(() => expect(root().querySelector('[data-task-title="Last day, first"]')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button('Last day, second', 'Snooze')))
    keyPress(button('Last day, second', 'Snooze'))
    await waitFor(() => expect(root().querySelector('[data-task-title="Last day, second"]')).toBeNull())
    const heading = root().querySelector('[data-planner-group="2026-11-26"] [data-planner-heading]')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('a pointer’s press moves no focus', async () => {
    livePlans()
    show()
    fireEvent.click(button('Monday deadline', 'Snooze'), { detail: 1 })
    await waitFor(() => expect(groupOf('Monday deadline')).toBe('Tue, Nov 24'))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(document.activeElement).toBe(document.body)
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
    expect(tags()).toMatchObject({ 'Missed plan': 'Wed', 'Past its due date': '1 day after due' })
    expect(root().querySelector('[data-planner-actions]')).toBeNull()
    expect(rowOf('Past its due date').querySelector('[data-row-part="due"]')).toHaveAttribute('data-date-level', 'late')
    expect(rowOf('Monday deadline').querySelector('[data-row-part="due"]')).toHaveAttribute('data-date-level', 'soon')
    // A follow-up the plan falls after shows there, late (the phone shows a follow-up only when it asks for action).
    expect(rowOf('Past its follow-up').querySelector('[data-row-part="followup"]')).toHaveAttribute('data-date-level', 'late')
    // The flag in words, after what the row's details say; none on a row in Unplanned.
    expect(within(rowOf('Monday plan')).getByRole('button', { name: 'Monday plan' })).toHaveAttribute('aria-description', 'planned')
    expect(within(rowOf('Someday focus')).getByRole('button', { name: 'Someday focus' })).not.toHaveAttribute('aria-description')
    expect(within(rowOf('Missed plan')).getByRole('button', { name: 'Missed plan' }).getAttribute('aria-description')).toMatch(/planned for Wed$/)
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
    // This week: every placed task the Planner shows (6). Today only: the one planned for today. Delayed: one.
    expect(rows(openMenu())).toEqual([['This week', '6', false], ['Today only', '1', false], ['Delayed', '1', false]])
  })

  it('a choice with nothing to clear is inert', () => {
    useTodoStore.setState({ todos: TODOS().filter((t) => t.uid !== 'missed' && t.uid !== 'planned-today') })
    alone()
    expect(rows(openMenu())).toEqual([['This week', '4', false], ['Today only', '0', true], ['Delayed', '0', true]])
    cleanup()
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'By its date', dueDate: day(1) })] })
    alone()
    expect(rows(openMenu())).toEqual([['This week', '0', true], ['Today only', '0', true], ['Delayed', '0', true]])
  })

  it('each choice asks, then clears those tasks’ plans in one write, one undo step with the snackbar — and no date', async () => {
    const { setPlan, update, askConfirmation } = watch()
    alone()
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^This week/ }))
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([2, 4, 5, 6, 7, 8], null, 'Reset plan: this week', true))
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^Today only/ }))
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([2], null, 'Reset plan: today', true))
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /^Delayed/ }))
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([8], null, 'Reset plan: Delayed', true))
    expect(askConfirmation).toHaveBeenCalledTimes(3)
    expect(setPlan).toHaveBeenCalledTimes(3)
    expect(update).not.toHaveBeenCalled()
  })

  it('with the window shifted, the first choice is named for the days shown — it resets those, not this week — in the button’s menu and the ⋯ submenu alike', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, uid: 'tomorrow', title: 'Planned tomorrow', doDate: day(1), sortOrder: 1 }),
        makeTodo({ id: 2, uid: 'next', title: 'Planned next week', doDate: day(8), sortOrder: 2 }),
      ],
    })
    const { setPlan } = watch()
    alone()
    expect(rows(openMenu())).toEqual([['This week', '1', false], ['Today only', '0', true], ['Delayed', '0', true]])
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Reset plan' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    // Fri 27 … Thu Dec 3: the task planned there, not tomorrow's.
    expect(rows(openMenu())).toEqual([['Nov 27 – Dec 3', '1', false], ['Today only', '0', true], ['Delayed', '0', true]])
    const { result } = renderHook(() => usePlannerMenuEntries(PLANNER))
    const submenu = result.current[2]?.kind === 'item' ? result.current[2].children ?? [] : []
    expect(submenu.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['Nov 27 – Dec 3', 'Today only', 'Delayed'])
    fireEvent.click(within(screen.getByRole('menu', { name: 'Reset plan' })).getByRole('menuitem', { name: /^Nov 27 – Dec 3/ }))
    await waitFor(() => expect(setPlan).toHaveBeenCalledWith([2], null, 'Reset plan: Nov 27 – Dec 3', true))
    // Back on this week it is This week again.
    fireEvent.click(screen.getByRole('button', { name: 'Nov 27 – Dec 3. Back to this week' }))
    expect(rows(openMenu())[0]).toEqual(['This week', '1', false])
  })

  it('has no top-line control in a cell of tabs: the same three are under Reset plan › in the widget’s ⋯ menu', async () => {
    show()
    expect(screen.queryByRole('button', { name: 'Reset plan' })).toBeNull()
    const { setPlan } = watch()
    const { result } = renderHook(() => usePlannerMenuEntries(PLANNER))
    const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
    expect(result.current.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['Unplanned filter…', 'Week load…', 'Reset plan'])
    const choices = item(result.current, 'Reset plan').children ?? []
    expect(choices.map((e) => (e.kind === 'item' ? [e.label, e.note, e.disabled] : e.kind))).toEqual([
      ['This week', '6', false], ['Today only', '1', false], ['Delayed', '1', false],
    ])
    act(() => { item(choices, 'Delayed').onSelect?.() })
    await waitFor(() => expect(setPlan).toHaveBeenCalledWith([8], null, 'Reset plan: Delayed', true))
  })

  it('offers nothing for a tab that is no Planner — and such a cell’s menu reads nothing: a task change doesn’t render it again', () => {
    show()
    let renders = 0
    const { result } = renderHook(() => { renders++; return usePlannerMenuEntries(undefined) })
    expect(result.current).toEqual([])
    const before = renders
    // A plan cleared: the Planner's counts change, the other cell's menu hook is not run again.
    act(() => { useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 4 ? { ...t, doDate: undefined } : t)) }) })
    expect(usePlannerStore.getState().resets[plannerWindowKey(undefined, 'plan')]?.counts).toEqual({ week: 5, today: 1, delayed: 1 })
    expect(renders).toBe(before)
    expect(result.current).toEqual([])
  })

  it('the menus read what the drawn Planner reports: one report per change of a count, none once it is gone', () => {
    const key = plannerWindowKey(undefined, 'plan')
    const { unmount } = show()
    const report = usePlannerStore.getState().resets[key]
    expect(report?.counts).toEqual({ week: 6, today: 1, delayed: 1 })
    // A change that moves no count (a title): the same report, so no menu is built again.
    act(() => { useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 1 ? { ...t, title: 'Renamed' } : t)) }) })
    expect(usePlannerStore.getState().resets[key]).toBe(report)
    // A Planner that isn't drawn reports nothing, and its menu offers no Reset plan — only its settings.
    unmount()
    expect(usePlannerStore.getState().resets).toEqual({})
    const { result } = renderHook(() => usePlannerMenuEntries(PLANNER))
    expect(result.current.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['Unplanned filter…'])
  })

  it('the report’s action clears the scope as the Planner shows when it is called, not as it was when reported', async () => {
    const key = plannerWindowKey(undefined, 'plan')
    show()
    const { setPlan } = watch()
    const report = usePlannerStore.getState().resets[key]!
    // Another task planned for today too, with the count of Delayed unchanged: the Delayed report is the same object.
    act(() => { useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 8 ? { ...t, title: 'Missed, renamed' } : t)) }) })
    act(() => { report.run('delayed') })
    await waitFor(() => expect(setPlan).toHaveBeenCalledWith([8], null, 'Reset plan: Delayed', true))
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
