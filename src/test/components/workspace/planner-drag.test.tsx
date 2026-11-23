import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { PlannerDragLabel } from '../../../components/workspace/planner/PlannerDragLabel'
import { PlannerWidget } from '../../../components/workspace/planner/PlannerWidget'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem } from '../../../models'
import type { PlannerTab } from '../../../models/workspace-layout'
import { usePlannerStore, type PlannerDragPreview } from '../../../stores/planner-store'
import { useTodoStore } from '../../../stores/todo-store'
import type { PlannerDrop } from '../../../utils/planner'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * What a Planner shows while a task is dragged over it, from its drag
 * preview (`stores/planner-store`'s `drag`, which `use-planner-drag` sets —
 * `planner-drag-hook.test.tsx`): the target's tile and group marked — one
 * neutral mark: a drop changes the plan, never a real date —, a blank slot
 * where the row would land, the lifted row's label, the not-allowed cursor
 * for a refused drop. And Plan for day ›, Snooze and Unplan in a row's task
 * menu.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20, 10)
const day = (offset: number) => new Date(2026, 10, 20 + offset)
const PLANNER: PlannerTab = { id: 'plan', kind: 'planner', config: {} }

const TODOS = (): PersistedTodoItem[] => [
  makeTodo({ id: 1, uid: 'late', title: 'Late invoice', dueDate: day(-3), sortOrder: 1 }),
  makeTodo({ id: 2, uid: 'chase', title: 'Chase legal', nextFollowupAt: day(0), sortOrder: 2 }),
  makeTodo({ id: 3, uid: 'plan', title: 'Planned for today', doDate: day(0), dueDate: day(9), sortOrder: 3 }),
  makeTodo({ id: 4, uid: 'mon-due', title: 'Monday deadline', dueDate: day(3), sortOrder: 4 }),
  makeTodo({ id: 5, uid: 'mon-do', title: 'Monday plan', doDate: day(3), sortOrder: 5 }),
  makeTodo({ id: 6, uid: 'missed', title: 'Missed plan', doDate: day(-1), sortOrder: 6 }),
  makeTodo({ id: 7, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 7 }),
  makeTodo({ id: 8, uid: 'held', title: 'Held call', unplanned: true, nextFollowupAt: day(2), sortOrder: 8 }),
]

function show(tab: PlannerTab = PLANNER) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{}}>
        <PlannerWidget tab={tab} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const root = () => document.querySelector<HTMLElement>('[data-planner="plan"]')!
const group = (key: string) => root().querySelector<HTMLElement>(`[data-planner-group="${key}"]`)!
const marked = () => [...root().querySelectorAll('[data-planner-drop]')].map((el) => (
  `${el.hasAttribute('data-planner-tile') ? 'tile' : 'group'} ${el.getAttribute('data-planner-tile') ?? el.getAttribute('data-planner-group')}`
))
/** A group's rows and its drop slot, top to bottom. */
const sequence = (key: string) => [...group(key).querySelectorAll('[data-task-title], [data-drop-slot]')].map((el) => el.getAttribute('data-task-title') ?? '(slot)')

const preview = (over: 'tile' | 'group', key: string, drop: PlannerDrop, index: number | null = null, tabId = 'plan'): PlannerDragPreview =>
  ({ tabId, over, key, drop, index })
const hover = (next: PlannerDragPreview | null) => act(() => usePlannerStore.getState().setDrag(next))

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 1100)
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
  document.documentElement.removeAttribute('data-drop-refused')
})

describe('the target of a drag', () => {
  it('marks the day’s tile and group — in one neutral mark, whatever date put the row there — when the drop plans the task', () => {
    show()
    expect(marked()).toEqual([])
    hover(preview('tile', '2026-11-23', { kind: 'plan', day: day(3) }))
    expect(marked()).toEqual(['tile 2026-11-23', 'group 2026-11-23'])
    // Over the group instead: the same day, the same marks.
    hover(preview('group', '2026-11-23', { kind: 'plan', day: day(3) }, 0))
    expect(marked()).toEqual(['tile 2026-11-23', 'group 2026-11-23'])
    // No tone: a drop changes no real date.
    for (const el of root().querySelectorAll('[data-planner-drop]')) expect(el.getAttribute('data-planner-drop')).toBe('')
  })

  it('marks Today’s group with today’s tile; and the day a drop clears the plan on', () => {
    show()
    hover(preview('tile', '2026-11-20', { kind: 'plan', day: day(0) }))
    expect(marked()).toEqual(['tile 2026-11-20', 'group 2026-11-20'])
    expect(group('2026-11-20')).toHaveAttribute('data-planner-group-kind', 'today')
    hover(preview('group', '2026-11-23', { kind: 'own', day: day(3) }, 0))
    expect(marked()).toEqual(['tile 2026-11-23', 'group 2026-11-23'])
  })

  it('marks Unplanned when the drop unplans', () => {
    show()
    hover(preview('group', 'unplanned', { kind: 'unplan', hold: true }, 1))
    expect(marked()).toEqual(['group unplanned'])
    hover(preview('group', 'unplanned', { kind: 'unplan', hold: false }, 0))
    expect(marked()).toEqual(['group unplanned'])
  })

  it('marks nothing for a refused drop and shows the not-allowed cursor — Delayed takes no drop; nor for a drop that writes nothing', () => {
    show()
    hover(preview('group', 'delayed', { kind: 'refuse' }))
    expect(marked()).toEqual([])
    expect(document.documentElement).toHaveAttribute('data-drop-refused')
    expect(root().querySelector('[data-drop-slot]')).toBeNull()
    hover(preview('group', '2026-11-20', { kind: 'none' }, 0))
    expect(marked()).toEqual([])
    expect(document.documentElement).not.toHaveAttribute('data-drop-refused')
    hover(null)
    expect(marked()).toEqual([])
  })

  it('is another Planner’s to show when the drag is over that one', () => {
    show()
    hover(preview('tile', '2026-11-23', { kind: 'plan', day: day(3) }, null, 'another'))
    expect(marked()).toEqual([])
    hover(preview('group', 'delayed', { kind: 'refuse' }, null, 'another'))
    expect(document.documentElement).not.toHaveAttribute('data-drop-refused')
  })
})

describe('the drop slot', () => {
  it('shows where the row would land in the hovered group: before the row at its place', () => {
    show()
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'plan', day: day(3) }, 0))
    expect(sequence('2026-11-23')).toEqual(['(slot)', 'Monday deadline', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'plan', day: day(3) }, 1))
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', '(slot)', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'plan', day: day(3) }, 2))
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', 'Monday plan', '(slot)'])
    // Only there.
    expect(root().querySelectorAll('[data-drop-slot]')).toHaveLength(1)
  })

  it('shows in a tray too: among Unplanned’s rows, and in Delayed for a reorder of its own', () => {
    show()
    expect(sequence('unplanned')).toEqual(['Held call', 'Someday focus'])
    hover(preview('group', 'unplanned', { kind: 'unplan', hold: true }, 1))
    expect(sequence('unplanned')).toEqual(['Held call', '(slot)', 'Someday focus'])
    hover(preview('group', 'delayed', { kind: 'none' }, 1))
    expect(sequence('delayed')).toEqual(['Missed plan', '(slot)'])
  })

  it('opens an empty day, and takes the place of Today’s empty line', () => {
    show()
    hover(preview('group', '2026-11-21', { kind: 'plan', day: day(1) }, 0))
    expect(sequence('2026-11-21')).toEqual(['(slot)'])
    act(() => useTodoStore.setState({ todos: TODOS().filter((t) => t.id > 3) }))
    hover(null)
    expect(within(group('2026-11-20')).getByRole('status')).toHaveTextContent('Nothing for today')
    hover(preview('group', '2026-11-20', { kind: 'plan', day: day(0) }, 0))
    expect(within(group('2026-11-20')).queryByRole('status')).toBeNull()
    expect(group('2026-11-20').querySelector('[data-drop-slot]')).not.toBeNull()
  })

  it('has none over a tile, or with no place', () => {
    show()
    hover(preview('tile', '2026-11-23', { kind: 'plan', day: day(3) }))
    expect(root().querySelector('[data-drop-slot]')).toBeNull()
    hover(preview('group', '2026-11-23', { kind: 'plan', day: day(3) }, null))
    expect(root().querySelector('[data-drop-slot]')).toBeNull()
  })
})

describe('the lifted row’s label', () => {
  it('says what a drop does to the plan — never a date it changes, and in no date’s tone', () => {
    render(<PlannerDragLabel />)
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('tile', '2026-11-25', { kind: 'plan', day: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Plan · Wed, Nov 25')
    expect(screen.getByTestId('planner-drag-label')).not.toHaveAttribute('data-tone')
    hover(preview('group', '2026-11-20', { kind: 'plan', day: day(0) }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Plan · Today')
    hover(preview('group', '2026-11-25', { kind: 'own', day: day(5) }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Its date · Wed, Nov 25')
    hover(preview('group', 'unplanned', { kind: 'unplan', hold: true }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Unplan')
    hover(preview('group', 'unplanned', { kind: 'unplan', hold: false }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Unplan')
    expect(screen.getByTestId('planner-drag-label').textContent).not.toMatch(/Follow-up|Due|Do ·/)
  })

  it('is not there for a refused drop, one that writes nothing, or a drag over no Planner target', () => {
    render(<PlannerDragLabel />)
    hover(preview('group', 'delayed', { kind: 'refuse' }))
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('group', '2026-11-20', { kind: 'none' }, 1))
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('tile', '2026-11-25', { kind: 'plan', day: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toBeInTheDocument()
    hover(null)
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
  })

  it('sits above the row where there is no room under it at the window’s foot', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rect.mockReturnValue({ top: 700, bottom: 730, left: 0, right: 200, width: 200, height: 30, x: 0, y: 700, toJSON: () => ({}) })
    vi.stubGlobal('innerHeight', 740)
    render(<div><PlannerDragLabel /></div>)
    hover(preview('tile', '2026-11-25', { kind: 'plan', day: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toHaveAttribute('data-above')
    // Back up the window as the pointer moves: under the row again.
    rect.mockReturnValue({ top: 300, bottom: 330, left: 0, right: 200, width: 200, height: 30, x: 0, y: 300, toJSON: () => ({}) })
    act(() => { window.dispatchEvent(new Event('pointermove')) })
    expect(screen.getByTestId('planner-drag-label')).not.toHaveAttribute('data-above')
    vi.unstubAllGlobals()
  })
})

describe('Plan for day ›, Snooze and Unplan in a row’s task menu', () => {
  const openMenu = (title: string) => {
    fireEvent.contextMenu(within(root()).getByText(title))
    return screen.getByRole('menu', { name: 'Task actions' })
  }
  const openMove = (title: string) => {
    const menu = openMenu(title)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Plan for day/ }))
    return screen.getAllByRole('menu').at(-1)!
  }
  /** The store's writes, watched: the plan action, and the edit path no menu entry here may take. */
  function watch() {
    const setPlan = vi.fn(async () => true)
    const update = vi.fn(async () => true)
    useTodoStore.setState({ setPlan, update })
    return { setPlan, update }
  }

  it('Plan for day › is in the menu of a Planner’s row, with the days and Pick a date… — and no No day', () => {
    show()
    const sub = openMove('Monday deadline')
    expect(within(sub).queryByText('Plans it for that day')).toBeNull()
    const items = within(sub).getAllByRole('menuitemradio')
    expect(items.map((i) => i.getAttribute('data-menu-label'))).toEqual([
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26',
    ])
    expect(within(sub).getByRole('menuitem', { name: 'Pick a date…' })).toBeInTheDocument()
    // On Monday by its due date, not planned: Monday is noted, nothing checked.
    expect(within(sub).getByRole('menuitemradio', { name: /^Mon, Nov 23/ })).toHaveAttribute('aria-checked', 'false')
    expect(within(sub).getByRole('menuitemradio', { name: /^Mon, Nov 23/ })).toHaveTextContent('due')
  })

  it('a pick plans the task for the day — a row there by its due date and one there by its follow-up alike, no date moved', () => {
    const { setPlan, update } = watch()
    show()
    fireEvent.click(within(openMove('Monday deadline')).getByRole('menuitemradio', { name: /^Wed, Nov 25/ }))
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(setPlan).toHaveBeenLastCalledWith([4], { day: day(5) })

    const sub = openMove('Chase legal')
    expect(within(sub).queryByText('Plans it for that day')).toBeNull()
    expect(within(sub).queryByText(/move/i)).toBeNull()
    fireEvent.click(within(sub).getByRole('menuitemradio', { name: /^Sat, Nov 21/ }))
    expect(setPlan).toHaveBeenCalledTimes(2)
    expect(setPlan).toHaveBeenLastCalledWith([2], { day: day(1) })
    expect(update).not.toHaveBeenCalled()
  })

  it('a pick of the day its own date puts it plans it there outright; the day it is planned for writes nothing', () => {
    const { setPlan, update } = watch()
    show()
    // Monday plan is planned for Monday already.
    fireEvent.click(within(openMove('Monday plan')).getByRole('menuitemradio', { name: /^Mon, Nov 23/ }))
    expect(setPlan).not.toHaveBeenCalled()
    // Held call: its follow-up is Sunday — picking Sunday plans it for Sunday (a drag there would clear the plan).
    fireEvent.click(within(openMove('Held call')).getByRole('menuitemradio', { name: /^Sun, Nov 22/ }))
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(setPlan).toHaveBeenLastCalledWith([8], { day: day(2) })
    // Monday deadline sits on Monday by its due date: picking Monday plans it there.
    fireEvent.click(within(openMove('Monday deadline')).getByRole('menuitemradio', { name: /^Mon, Nov 23/ }))
    expect(setPlan).toHaveBeenLastCalledWith([4], { day: day(3) })
    expect(update).not.toHaveBeenCalled()
  })

  it('Snooze plans the row for the next day: the day after its own, tomorrow from Delayed; none on an Unplanned row', () => {
    const { setPlan, update } = watch()
    show()
    /** Picks Snooze in the row's menu; the item names the day it plans for. */
    const snooze = (title: string, names: string) => {
      const item = within(openMenu(title)).getByRole('menuitem', { name: /^Snooze/ })
      expect(item).toHaveTextContent(names)
      fireEvent.click(item)
    }
    snooze('Monday deadline', 'Tue, Nov 24')
    expect(setPlan).toHaveBeenLastCalledWith([4], { day: day(4) })
    snooze('Late invoice', 'Sat, Nov 21')
    expect(setPlan).toHaveBeenLastCalledWith([1], { day: day(1) })
    snooze('Missed plan', 'Sat, Nov 21')
    expect(setPlan).toHaveBeenLastCalledWith([6], { day: day(1) })
    expect(within(openMenu('Someday focus')).queryByRole('menuitem', { name: /^Snooze/ })).toBeNull()
    expect(setPlan).toHaveBeenCalledTimes(3)
    expect(update).not.toHaveBeenCalled()
  })

  it('Unplan holds a row in Unplanned — a dated one, and one with no date that would leave the Planner; it is off in Unplanned', () => {
    const { setPlan, update } = watch()
    show()
    fireEvent.click(within(openMenu('Monday deadline')).getByRole('menuitem', { name: /^Unplan/ }))
    expect(setPlan).toHaveBeenLastCalledWith([4], 'unplanned')
    fireEvent.click(within(openMenu('Monday plan')).getByRole('menuitem', { name: /^Unplan/ }))
    expect(setPlan).toHaveBeenLastCalledWith([5], 'unplanned')
    fireEvent.click(within(openMenu('Missed plan')).getByRole('menuitem', { name: /^Unplan/ }))
    expect(setPlan).toHaveBeenLastCalledWith([6], 'unplanned')
    expect(setPlan).toHaveBeenCalledTimes(3)

    const off = within(openMenu('Someday focus')).getByRole('menuitem', { name: /^Unplan/ })
    expect(off).toBeDisabled()
    expect(off).toHaveAttribute('aria-description', expect.stringMatching(/Unplanned already/))
    expect(update).not.toHaveBeenCalled()
  })
})
