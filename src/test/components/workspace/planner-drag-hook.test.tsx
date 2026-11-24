import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { DndMonitorListener } from '@dnd-kit/core'
import { usePlannerDrag } from '../../../components/workspace/planner/use-planner-drag'
import type { PersistedTodoItem } from '../../../models'
import { usePlannerStore } from '../../../stores/planner-store'
import type { PlannerTarget } from '../../../utils/planner'
import { TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'

/**
 * `usePlannerDrag`: what a Planner says of a task dragged over it — the
 * drag preview in `stores/planner-store` (the target, what a drop would
 * do to the task's plan, the place in a hovered group) — from dnd-kit's `over` and the
 * pointer, over the groups' geometry as the drag started. dnd-kit's monitor
 * is stood in for, so the drag's events are sent by hand.
 */

const monitor: { current: DndMonitorListener | null } = { current: null }

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd-kit/core')>()),
  useDndMonitor: (listener: DndMonitorListener) => { monitor.current = listener },
}))

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number) => new Date(2026, 10, 20 + n)
const WINDOW = { today: TODAY, last: day(6) }
const TODAY_KEY = '2026-11-20'
const MON_KEY = '2026-11-23'

/** The Planner's tasks: Today holds a late deadline, a follow-up and a plan; Monday a deadline; Delayed a missed plan; Unplanned a Focus task. */
const late = makeTodo({ id: 1, uid: 'late', dueDate: day(-2) })
const chase = makeTodo({ id: 2, uid: 'chase', nextFollowupAt: day(0) })
const plan = makeTodo({ id: 3, uid: 'plan', doDate: day(0) })
const monday = makeTodo({ id: 4, uid: 'mon', dueDate: day(3) })
const focus = makeTodo({ id: 5, uid: 'focus', focus: true })
const missed = makeTodo({ id: 7, uid: 'missed', doDate: day(-2) })
const SHOWN = ['late', 'chase', 'plan', 'mon', 'missed', 'focus']

/** A row 30px high from `top`, in the group `key`. */
function Row({ group, todo, top }: { group: string; todo: PersistedTodoItem; top: number }) {
  return <div data-row-key={`${group}|${todo.id}`} data-row-todo={todo.id} data-rect={`${top},${top + 30}`} />
}

/**
 * The Planner's scrollers as the large face lays them out: Today's pane
 * (rows at 100, 130, 160), the days-ahead pane (Monday: one row at 100) and
 * the pinned trays (Delayed: one row at 400; Unplanned: one row at 460).
 */
function Harness({ tabId = 'plan' }: { tabId?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const active = usePlannerDrag(tabId, hostRef)
  return (
    <div ref={hostRef}>
      <output data-testid="active">{active ? `${active.todo.uid}:${active.row ? `${active.row.key}@${active.row.index}` : 'elsewhere'}` : 'none'}</output>
      <div data-planner-pane="today" data-rect="60,600">
        <div data-list-section={TODAY_KEY} data-rect="70,250">
          <Row group={TODAY_KEY} todo={late} top={100} />
          <Row group={TODAY_KEY} todo={chase} top={130} />
          <Row group={TODAY_KEY} todo={plan} top={160} />
        </div>
      </div>
      <div data-planner-pane="ahead" data-rect="60,380">
        <div data-list-section={MON_KEY} data-rect="70,140">
          <Row group={MON_KEY} todo={monday} top={100} />
        </div>
      </div>
      <div data-planner-pane="trays" data-rect="380,600">
        <div data-list-section="delayed" data-rect="380,440">
          <Row group="delayed" todo={missed} top={400} />
        </div>
        <div data-list-section="unplanned" data-rect="440,500">
          <Row group="unplanned" todo={focus} top={460} />
        </div>
      </div>
    </div>
  )
}

const target = (n: number): PlannerTarget => ({ kind: 'day', day: day(n) })
const tile = (n: number, scope = 'plan'): PlannerDropData => ({ type: TASK_DROP_KIND.plannerDay, scope, target: target(n), window: WINDOW })
const groups: Record<string, { target: PlannerTarget; rows: string[] }> = {
  [TODAY_KEY]: { target: target(0), rows: ['late', 'chase', 'plan'] },
  [MON_KEY]: { target: target(3), rows: ['mon'] },
  delayed: { target: { kind: 'delayed' }, rows: ['missed'] },
  unplanned: { target: { kind: 'unplanned' }, rows: ['focus'] },
}
const group = (key: string, scope = 'plan'): PlannerDropData => ({
  type: TASK_DROP_KIND.plannerGroup, scope, target: groups[key]!.target, window: WINDOW, group: { key, rows: groups[key]!.rows, shown: SHOWN },
})

type Start = Parameters<NonNullable<DndMonitorListener['onDragStart']>>[0]
type Over = Parameters<NonNullable<DndMonitorListener['onDragOver']>>[0]

/** One of the Planner's own rows picked up (its group and row key), or a task from elsewhere (`extra`). */
function start(todo: PersistedTodoItem, own: string | null, extra: Record<string, unknown> = {}, tabId = 'plan') {
  const data = own ? { listTabId: tabId, sectionKey: own, rowKey: `${own}|${todo.id}`, todo } : { ...extra, todo }
  act(() => monitor.current?.onDragStart?.({ active: { id: 'x', data: { current: data } }, activatorEvent: new MouseEvent('pointerdown', { clientX: 50, clientY: 110 }) } as unknown as Start))
}
const over = (data: unknown) => act(() => monitor.current?.onDragOver?.({ over: data ? { id: 'o', data: { current: data } } : null } as unknown as Over))
const move = (y: number, x = 50) => act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y })) })
const end = () => act(() => monitor.current?.onDragEnd?.({} as Parameters<NonNullable<DndMonitorListener['onDragEnd']>>[0]))
const cancel = () => act(() => monitor.current?.onDragCancel?.({} as Parameters<NonNullable<DndMonitorListener['onDragCancel']>>[0]))
const preview = () => usePlannerStore.getState().drag
const active = () => screen.getByTestId('active').textContent

beforeEach(() => {
  monitor.current = null
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const [top = 0, bottom = 0] = (this.getAttribute('data-rect') ?? '0,0').split(',').map(Number)
    return { top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a task picked up', () => {
  it('is one of the Planner’s own rows — its group and place — or a task from elsewhere', () => {
    render(<Harness />)
    expect(active()).toBe('none')
    start(plan, TODAY_KEY)
    expect(active()).toBe(`plan:${TODAY_KEY}|3@2`)
    end()
    expect(active()).toBe('none')
    // A list's row, another Planner's row, a calendar entry: a task from elsewhere.
    start(late, null, { listTabId: 'a-list', sectionKey: 'all', rowKey: 'all|1' })
    expect(active()).toBe('late:elsewhere')
    end()
    start(late, null, { calendarDateType: 'due' })
    expect(active()).toBe('late:elsewhere')
    cancel()
    expect(active()).toBe('none')
  })

  it('ignores a drag that carries no task (a tab, a cell)', () => {
    render(<Harness />)
    act(() => monitor.current?.onDragStart?.({ active: { id: 'tab', data: { current: { type: 'workspace-tab' } } }, activatorEvent: null } as unknown as Start))
    expect(active()).toBe('none')
    over(tile(3))
    expect(preview()).toBeNull()
  })

  it('shows no preview until it is over one of the Planner’s targets', () => {
    render(<Harness />)
    start(chase, TODAY_KEY)
    move(120)
    expect(preview()).toBeNull()
  })
})

describe('over a tile', () => {
  it('says what the drop does to the plan for that day, with no place', () => {
    render(<Harness />)
    // A row there by its follow-up: planned, the follow-up left alone.
    start(chase, TODAY_KEY)
    over(tile(3))
    expect(preview()).toEqual({ tabId: 'plan', over: 'tile', key: MON_KEY, drop: { kind: 'plan', day: day(3) }, index: null })
    // A row placed by its due date: planned too.
    end()
    start(monday, MON_KEY)
    over(tile(5))
    expect(preview()).toEqual({ tabId: 'plan', over: 'tile', key: '2026-11-25', drop: { kind: 'plan', day: day(5) }, index: null })
    // Its own day: nothing to write.
    over(tile(3))
    expect(preview()?.drop).toEqual({ kind: 'none' })
    // A planned row over the day its own date puts it: the plan cleared.
    end()
    start(makeTodo({ id: 8, uid: 'venue', doDate: day(1), dueDate: day(3) }), null)
    over(tile(3))
    expect(preview()).toEqual({ tabId: 'plan', over: 'tile', key: MON_KEY, drop: { kind: 'own', day: day(3) }, index: null })
    over(tile(4))
    expect(preview()?.drop).toEqual({ kind: 'plan', day: day(4) })
  })
})

describe('over a group', () => {
  it('places a row dragged in its own group by the pointer, among the rows without it', () => {
    render(<Harness />)
    start(plan, TODAY_KEY)
    over(group(TODAY_KEY))
    // Above the first row's middle (115).
    move(105)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: TODAY_KEY, drop: { kind: 'none' }, index: 0 })
    // Between the first and the second row's middles.
    move(120)
    expect(preview()?.index).toBe(1)
    // Past both: where it already is — the dragged row doesn't count.
    move(170)
    expect(preview()?.index).toBe(2)
    move(240)
    expect(preview()?.index).toBe(2)
  })

  it('places a row headed for another day there, with the write the drop makes', () => {
    render(<Harness />)
    start(chase, TODAY_KEY)
    over(group(MON_KEY))
    move(90)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: MON_KEY, drop: { kind: 'plan', day: day(3) }, index: 0 })
    move(125)
    expect(preview()?.index).toBe(1)
  })

  it('places a list’s row too, and keeps a Planner row it also shows out of the count', () => {
    render(<Harness />)
    // Monday's deadline dragged from a list widget, over Today's group.
    start(monday, null, { listTabId: 'a-list', sectionKey: 'all', rowKey: 'all|4' })
    expect(active()).toBe('mon:elsewhere')
    over(group(TODAY_KEY))
    move(150)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: TODAY_KEY, drop: { kind: 'plan', day: TODAY }, index: 2 })
    // Over its own day's group: nothing to write, a reorder among the rows without it.
    over(group(MON_KEY))
    move(135)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: MON_KEY, drop: { kind: 'none' }, index: 0 })
  })

  it('has no place for a refused drop: Delayed, Unplanned for a task with no plan, a completed task anywhere', () => {
    render(<Harness />)
    // Delayed takes no drop.
    start(monday, MON_KEY)
    over(group('delayed'))
    move(410)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'delayed', drop: { kind: 'refuse' }, index: null })
    end()
    // A dated row with no plan: nothing is put in Unplanned by hand.
    start(monday, MON_KEY)
    over(group('unplanned'))
    move(470)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'unplanned', drop: { kind: 'refuse' }, index: null })
    end()
    // A list's row with no plan and no date, not in Focus: refused too.
    start(makeTodo({ id: 9, uid: 'plain' }), null, { listTabId: 'a-list', sectionKey: 'all', rowKey: 'all|9' })
    over(group('unplanned'))
    move(470)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'unplanned', drop: { kind: 'refuse' }, index: null })
    end()
    // A completed task is refused everywhere.
    start({ ...chase, isCompleted: true }, TODAY_KEY)
    over(group(MON_KEY))
    expect(preview()).toMatchObject({ drop: { kind: 'refuse' }, index: null })
  })

  it('unplans a planned row on Unplanned, with a place there only when the cleared task would sit there', () => {
    render(<Harness />)
    // Planned, in Focus with no date: the Unplanned filter keeps it there once cleared.
    start(makeTodo({ id: 6, uid: 'planned', focus: true, doDate: day(1) }), null)
    over(group('unplanned'))
    // Above the middle of the tray's one row (475).
    move(465)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'unplanned', drop: { kind: 'unplan' }, index: 0 })
    // Past the middle of the group's one row.
    move(490)
    expect(preview()?.index).toBe(1)
    end()
    // Planned, with a due date in the window: cleared, it goes back to its day — no place in Unplanned.
    start(makeTodo({ id: 10, uid: 'venue', doDate: day(1), dueDate: day(3) }), null)
    over(group('unplanned'))
    move(470)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'unplanned', drop: { kind: 'unplan' }, index: null })
    end()
    // Planned, no date, not in Focus: cleared, it leaves the Planner — no place either.
    start(makeTodo({ id: 11, uid: 'bare', doDate: day(1) }), null)
    over(group('unplanned'))
    move(470)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'unplanned', drop: { kind: 'unplan' }, index: null })
  })

  it('reorders a Delayed row among its own', () => {
    render(<Harness />)
    start(missed, 'delayed')
    over(group('delayed'))
    move(405)
    expect(preview()).toEqual({ tabId: 'plan', over: 'group', key: 'delayed', drop: { kind: 'none' }, index: 0 })
  })
})

describe('leaving', () => {
  it('drops the preview off the Planner’s targets, and when the drag ends or is cancelled', () => {
    render(<Harness />)
    start(chase, TODAY_KEY)
    over(tile(3))
    expect(preview()).not.toBeNull()
    // Over a calendar day, another widget, nothing.
    over({ type: TASK_DROP_KIND.calendarDay, date: day(3), scope: 'cal', dateTypes: { due: true, followup: true } })
    expect(preview()).toBeNull()
    over(tile(3))
    over(null)
    expect(preview()).toBeNull()
    over(tile(3))
    end()
    expect(preview()).toBeNull()
    start(chase, TODAY_KEY)
    over(tile(3))
    cancel()
    expect(preview()).toBeNull()
    // Nothing follows the pointer once the drag is over.
    move(120)
    expect(preview()).toBeNull()
  })

  it('leaves another Planner’s preview alone, and only shows its own targets', () => {
    render(<><Harness /><Harness tabId="other" /></>)
    start(chase, TODAY_KEY)
    over(tile(3, 'other'))
    // The last Planner mounted stands in for dnd-kit here; each acts only on its own targets.
    expect(preview()).toMatchObject({ tabId: 'other', over: 'tile', key: MON_KEY })
    over(tile(3, 'plan'))
    expect(preview()).toBeNull()
  })

  it('takes its preview with it when it unmounts mid-drag', () => {
    const view = render(<Harness />)
    start(chase, TODAY_KEY)
    over(tile(3))
    expect(preview()).not.toBeNull()
    view.unmount()
    expect(preview()).toBeNull()
  })
})
