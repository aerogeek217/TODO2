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
 * `planner-drag-hook.test.tsx`): the target day's tile and group marked in
 * the tone of the date the drop changes, a blank slot where the row would
 * land, the lifted row's label, the not-allowed cursor for a refused drop.
 * And Move to day › in a row's task menu.
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
  makeTodo({ id: 7, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 7 }),
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
  `${el.hasAttribute('data-planner-tile') ? 'tile' : 'group'} ${el.getAttribute('data-planner-tile') ?? el.getAttribute('data-planner-group')}: ${el.getAttribute('data-planner-drop')}`
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
  it('marks the day’s tile and group in the follow-up’s tone when the drop moves the follow-up', () => {
    show()
    expect(marked()).toEqual([])
    hover(preview('tile', '2026-11-23', { kind: 'followup', date: day(3) }))
    expect(marked()).toEqual(['tile 2026-11-23: followup', 'group 2026-11-23: followup'])
    // Over the group instead: the same day, the same marks.
    hover(preview('group', '2026-11-23', { kind: 'followup', date: day(3) }, 0))
    expect(marked()).toEqual(['tile 2026-11-23: followup', 'group 2026-11-23: followup'])
  })

  it('marks them in the Do day’s tone when the drop sets it; Today’s group with today’s tile', () => {
    show()
    hover(preview('tile', '2026-11-20', { kind: 'do', date: day(0) }))
    expect(marked()).toEqual(['tile 2026-11-20: do', 'group 2026-11-20: do'])
    expect(group('2026-11-20')).toHaveAttribute('data-planner-group-kind', 'today')
  })

  it('marks Focus, no day when the drop clears a Do day', () => {
    show()
    hover(preview('group', 'none', { kind: 'do', date: undefined }, 1))
    expect(marked()).toEqual(['group none: do'])
  })

  it('marks nothing for a refused drop and shows the not-allowed cursor; nor for a drop that writes nothing', () => {
    show()
    hover(preview('group', 'none', { kind: 'refuse' }))
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
    hover(preview('tile', '2026-11-23', { kind: 'do', date: day(3) }, null, 'another'))
    expect(marked()).toEqual([])
    hover(preview('group', 'none', { kind: 'refuse' }, null, 'another'))
    expect(document.documentElement).not.toHaveAttribute('data-drop-refused')
  })
})

describe('the drop slot', () => {
  it('shows where the row would land in the hovered group: before the row at its place', () => {
    show()
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'do', date: day(3) }, 0))
    expect(sequence('2026-11-23')).toEqual(['(slot)', 'Monday deadline', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'do', date: day(3) }, 1))
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', '(slot)', 'Monday plan'])
    hover(preview('group', '2026-11-23', { kind: 'do', date: day(3) }, 2))
    expect(sequence('2026-11-23')).toEqual(['Monday deadline', 'Monday plan', '(slot)'])
    // Only there.
    expect(root().querySelectorAll('[data-drop-slot]')).toHaveLength(1)
  })

  it('opens an empty day, and takes the place of Today’s empty line', () => {
    show()
    hover(preview('group', '2026-11-21', { kind: 'do', date: day(1) }, 0))
    expect(sequence('2026-11-21')).toEqual(['(slot)'])
    act(() => useTodoStore.setState({ todos: TODOS().filter((t) => t.id > 3) }))
    hover(null)
    expect(within(group('2026-11-20')).getByRole('status')).toHaveTextContent('Nothing for today')
    hover(preview('group', '2026-11-20', { kind: 'do', date: day(0) }, 0))
    expect(within(group('2026-11-20')).queryByRole('status')).toBeNull()
    // Before Add task, Today's last row.
    expect(group('2026-11-20').querySelector('[data-drop-slot]')?.nextElementSibling).toHaveTextContent('Add task')
  })

  it('has none over a tile, or with no place', () => {
    show()
    hover(preview('tile', '2026-11-23', { kind: 'do', date: day(3) }))
    expect(root().querySelector('[data-drop-slot]')).toBeNull()
    hover(preview('group', '2026-11-23', { kind: 'do', date: day(3) }, null))
    expect(root().querySelector('[data-drop-slot]')).toBeNull()
  })
})

describe('the lifted row’s label', () => {
  it('says which date a drop changes and to which day, in that date’s tone', () => {
    render(<PlannerDragLabel />)
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('tile', '2026-11-25', { kind: 'followup', date: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Follow-up · Wed, Nov 25')
    expect(screen.getByTestId('planner-drag-label')).toHaveAttribute('data-tone', 'followup')
    hover(preview('group', '2026-11-25', { kind: 'do', date: day(5) }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('Do · Wed, Nov 25')
    expect(screen.getByTestId('planner-drag-label')).toHaveAttribute('data-tone', 'do')
    hover(preview('group', 'none', { kind: 'do', date: undefined }, 0))
    expect(screen.getByTestId('planner-drag-label')).toHaveTextContent('No day')
  })

  it('is not there for a refused drop, one that writes nothing, or a drag over no Planner target', () => {
    render(<PlannerDragLabel />)
    hover(preview('group', 'none', { kind: 'refuse' }))
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('group', '2026-11-20', { kind: 'none' }, 1))
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
    hover(preview('tile', '2026-11-25', { kind: 'do', date: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toBeInTheDocument()
    hover(null)
    expect(screen.queryByTestId('planner-drag-label')).toBeNull()
  })

  it('sits above the row where there is no room under it at the window’s foot', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rect.mockReturnValue({ top: 700, bottom: 730, left: 0, right: 200, width: 200, height: 30, x: 0, y: 700, toJSON: () => ({}) })
    vi.stubGlobal('innerHeight', 740)
    render(<div><PlannerDragLabel /></div>)
    hover(preview('tile', '2026-11-25', { kind: 'do', date: day(5) }))
    expect(screen.getByTestId('planner-drag-label')).toHaveAttribute('data-above')
    // Back up the window as the pointer moves: under the row again.
    rect.mockReturnValue({ top: 300, bottom: 330, left: 0, right: 200, width: 200, height: 30, x: 0, y: 300, toJSON: () => ({}) })
    act(() => { window.dispatchEvent(new Event('pointermove')) })
    expect(screen.getByTestId('planner-drag-label')).not.toHaveAttribute('data-above')
    vi.unstubAllGlobals()
  })
})

describe('Move to day › in a row’s task menu', () => {
  const openMenu = (title: string) => {
    fireEvent.contextMenu(within(root()).getByText(title))
    return screen.getByRole('menu', { name: 'Task actions' })
  }
  const openMove = (title: string) => {
    const menu = openMenu(title)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Move to day/ }))
    return screen.getAllByRole('menu').at(-1)!
  }

  it('is in the menu of a Planner’s row, with the days and No day', () => {
    show()
    const sub = openMove('Monday deadline')
    expect(within(sub).getByText('Sets the Do day')).toBeInTheDocument()
    const items = within(sub).getAllByRole('menuitemradio')
    expect(items.map((i) => i.getAttribute('data-menu-label'))).toEqual([
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26', 'No day',
    ])
    expect(within(sub).getByRole('menuitemradio', { name: /^Mon, Nov 23/ })).toHaveAttribute('aria-checked', 'true')
    // Placed by its due date: No day is off and says why.
    const noDay = within(sub).getByRole('menuitemradio', { name: /^No day/ })
    expect(noDay).toBeDisabled()
    expect(noDay).toHaveAttribute('aria-description', expect.stringMatching(/due date/))
  })

  it('a pick sets the Do day of a row placed by its due date, and moves the follow-up of one placed by it', () => {
    const setPlan = vi.fn(async () => {})
    const update = vi.fn(async () => true)
    useTodoStore.setState({ setPlan, update })
    show()
    fireEvent.click(within(openMove('Monday deadline')).getByRole('menuitemradio', { name: /^Wed, Nov 25/ }))
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(setPlan).toHaveBeenCalledWith([4], { day: day(5) })
    expect(update).not.toHaveBeenCalled()

    const sub = openMove('Chase legal')
    expect(within(sub).getByText('Moves the follow-up')).toBeInTheDocument()
    fireEvent.click(within(sub).getByRole('menuitemradio', { name: /^Sat, Nov 21/ }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(2, { nextFollowupAt: day(1) })
    expect(setPlan).toHaveBeenCalledTimes(1)
  })

  it('No day clears a Do day; the day the row is on writes nothing', () => {
    const setPlan = vi.fn(async () => {})
    const update = vi.fn(async () => true)
    useTodoStore.setState({ setPlan, update })
    show()
    fireEvent.click(within(openMove('Monday plan')).getByRole('menuitemradio', { name: /^No day/ }))
    expect(setPlan).toHaveBeenCalledWith([5], null)
    fireEvent.click(within(openMove('Monday plan')).getByRole('menuitemradio', { name: /^Mon, Nov 23/ }))
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})
