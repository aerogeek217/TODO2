import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import { todoRepository } from '../../data'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import type { PersistedTodoItem } from '../../models'
import { createTab, PLANNER_ORDER_MAX, type PersistedWorkspaceLayout, type PlannerTab } from '../../models/workspace-layout'
import {
  applyPlannerFix,
  applyPlannerMove,
  movePlannerTask,
  planPlannerDrop,
  resetPlannerPlan,
  snoozePlannerTask,
  unplanDelayedTasks,
  unplanPlannerTask,
} from '../../services/planner-drop'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import type { PlannerDragPreview } from '../../stores/planner-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore, type ConfirmPrompt } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import {
  PLANNER_DELAYED_KEY,
  PLANNER_UNPLANNED_KEY,
  plannerPlacement,
  plannerResetCounts,
  plannerView,
  type PlannerDateKind,
  type PlannerTarget,
} from '../../utils/planner'
import { TASK_DRAG_KIND, TASK_DROP_KIND, dispatchTaskDrop, type PlannerDropData, type PlannerDropRequest } from '../../utils/task-dnd'
import { addTask } from '../add-task'
import { resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'
import { resetStores } from '../store-tracking'

/**
 * The Planner's one writer (`services/planner-drop`), on the real stores
 * and database: each decision of the drop rule is exactly one task write —
 * the task's plan state (a planned day, held in Unplanned, cleared: both
 * fields at once, one undo step, no stamp, no history event) — or none; a
 * due date or a follow-up is never written by a drop, Plan for day ›,
 * Snooze, Unplan, Unplan all Delayed or Reset plan — only by a conflict's
 * Move date fix, which is a real edit. A drop into a group stores the hand
 * order on the Planner's tab. Drops are driven as the page drives them:
 * `dispatchTaskDrop` → the plan → the write.
 */

// Fri 20 Nov 2026, mid-morning.
const NOW = new Date(2026, 10, 20, 10, 30)
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = { today: TODAY, last: day(6) }
const STAMP = new Date(2026, 9, 1, 9, 0)
const T0 = new Date('2026-09-01T09:00:00.000Z')

const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n) })
/** A menu's pick of the day (Plan for day ›): planned outright. */
const pickOn = (n: number): PlannerTarget => ({ kind: 'day', day: day(n), pick: true })
const UNPLANNED: PlannerTarget = { kind: 'unplanned' }
const DELAYED: PlannerTarget = { kind: 'delayed' }
const ws = () => useWorkspaceStore.getState()

let layoutId = 0

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useSettingsStore.setState({ autoFollowup: false })
  layoutId = await layoutRepository.insert({
    name: 'Week', createdAt: T0, modifiedAt: T0,
    ...grid([[cell('k1', [createTab('planner', 'plan')], { activeTabId: 'plan' }), cell('k2', [createTab('planner', 'plan-2')], { activeTabId: 'plan-2' })]]),
  })
  await layoutRepository.setActiveId(layoutId)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
})
afterEach(() => { vi.useRealTimers() })

/** A task as stored: created through the store, then given its dates and an old stamp, with an empty undo stack. */
async function seed(title: string, fields: Partial<PersistedTodoItem> = {}): Promise<PersistedTodoItem> {
  const id = await addTask(title)
  const changes = { nextFollowupAt: undefined, ...fields, modifiedAt: STAMP }
  await db.todos.update(id, changes)
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, ...changes } : t)) })
  useUndoStore.getState().clear()
  return useTodoStore.getState().todos.find((t) => t.id === id)!
}

const storedTask = async (id: number) => (await db.todos.get(id)) as PersistedTodoItem
const steps = () => useUndoStore.getState().undoStack.map((s) => s.description)
const eventCount = (todoId: number) => db.todoEvents.where('todoId').equals(todoId).count()

/** The task's plan fields, its real dates and its stamp — as stored; the store's copy must agree. */
async function plan(id: number) {
  const stored = await storedTask(id)
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)
  expect(shown?.doDate?.getTime()).toBe(stored.doDate?.getTime())
  expect(shown?.unplanned).toBe(stored.unplanned)
  expect(shown?.dueDate?.getTime()).toBe(stored.dueDate?.getTime())
  expect(shown?.nextFollowupAt?.getTime()).toBe(stored.nextFollowupAt?.getTime())
  expect(shown?.modifiedAt.getTime()).toBe(stored.modifiedAt.getTime())
  return { doDate: stored.doDate, unplanned: stored.unplanned, nextFollowupAt: stored.nextFollowupAt, dueDate: stored.dueDate, modifiedAt: stored.modifiedAt }
}

/** The Planner as it shows the store's tasks this week. */
const viewNow = () => plannerView(useTodoStore.getState().todos, { today: TODAY })

async function storedOrder(tabId = 'plan'): Promise<string[] | undefined> {
  await settleLayoutWrites()
  const layout = (await db.layouts.get(layoutId)) as PersistedWorkspaceLayout
  const tab = layout.cells.flatMap((c) => c.tabs).find((t) => t.id === tabId) as PlannerTab
  return tab.viewState?.order
}

const REAL_DATES = ['dueDate', 'nextFollowupAt', 'lastFollowupAt']

/**
 * Watches the writes a Planner action makes, without changing them: the
 * store actions called, the task writes that reach the database (`tasks`)
 * and how many of them touch a real date (`realDates`), and the tab's
 * view-state writes (`patch`).
 */
function watchWrites() {
  const update = vi.spyOn(useTodoStore.getState(), 'update')
  const setPlan = vi.spyOn(useTodoStore.getState(), 'setPlan')
  const patch = vi.spyOn(ws(), 'patchTabViewState')
  const bulkUpdate = vi.spyOn(todoRepository, 'bulkUpdate')
  useTodoStore.setState({ update, setPlan })
  useWorkspaceStore.setState({ patchTabViewState: patch })
  const realDates = () => bulkUpdate.mock.calls
    .flatMap((call) => call[0])
    .filter((m) => REAL_DATES.some((field) => field in m.changes)).length
  return { update, setPlan, patch, bulkUpdate, tasks: () => bulkUpdate.mock.calls.length, realDates }
}

function tile(target: PlannerTarget, scope = 'plan'): PlannerDropData {
  return { type: TASK_DROP_KIND.plannerDay, scope, target, window: WINDOW }
}

function group(target: PlannerTarget, key: string, rows: string[], shown: string[], scope = 'plan'): PlannerDropData {
  return { type: TASK_DROP_KIND.plannerGroup, scope, target, window: WINDOW, group: { key, rows, shown } }
}

/** The drag preview a Planner shows over a group: the place in it. */
const over = (key: string, index: number | null, tabId = 'plan'): PlannerDragPreview =>
  ({ tabId, over: 'group', key, drop: { kind: 'none' }, index })

/** A drop as the page makes it: the dispatcher, then the Planner's plan (the place from `preview`) and its write. */
async function drop(todo: PersistedTodoItem, target: PlannerDropData, preview: PlannerDragPreview | null = null, activeExtra: Record<string, unknown> = {}) {
  const reschedule = vi.fn(async () => {})
  const event = {
    active: { id: 'active', data: { current: { ...activeExtra, type: TASK_DRAG_KIND.task, todo } } },
    activatorEvent: null,
    over: { id: 'over', data: { current: target } },
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent
  const handled = await dispatchTaskDrop(event, {
    calendar: { reschedule },
    planner: {
      drop: (request: PlannerDropRequest) => {
        const plan = planPlannerDrop(request, preview)
        return plan ? applyPlannerMove(request.tabId, request.todo.id, plan) : undefined
      },
    },
  })
  expect(handled).toBe(true)
  expect(reschedule).not.toHaveBeenCalled()
}

describe('a drop on a day: the task is planned, its real dates untouched', () => {
  it('a row there by its follow-up keeps the follow-up and gets a planned day: no stamp, no history event, one undo step', async () => {
    const task = await seed('Chase', { nextFollowupAt: day(0, 12) })
    const events = await eventCount(task.id)
    const w = watchWrites()
    await drop(task, tile(on(3)), null, { listTabId: 'plan', sectionKey: '2026-11-20', rowKey: `2026-11-20|${task.id}` })
    expect(w.setPlan).toHaveBeenCalledTimes(1)
    expect(w.setPlan).toHaveBeenCalledWith([task.id], { day: day(3) })
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(await plan(task.id)).toEqual({ doDate: day(3), unplanned: undefined, nextFollowupAt: day(0, 12), dueDate: undefined, modifiedAt: STAMP })
    expect(await eventCount(task.id)).toBe(events)
    expect(steps()).toEqual(['Planned “Chase”'])

    await useUndoStore.getState().undo()
    expect(await plan(task.id)).toEqual({ doDate: undefined, unplanned: undefined, nextFollowupAt: day(0, 12), dueDate: undefined, modifiedAt: STAMP })
    expect(useTodoStore.getState().todos.find((t) => t.id === task.id)?.modifiedAt).toEqual(STAMP)
    await useUndoStore.getState().redo()
    expect(await plan(task.id)).toMatchObject({ doDate: day(3), modifiedAt: STAMP })
    expect(await eventCount(task.id)).toBe(events)
  })

  it('a row there by its due date likewise: the due date kept', async () => {
    const task = await seed('Venue', { dueDate: day(2, 9) })
    const w = watchWrites()
    await drop(task, tile(on(4)))
    expect(w.setPlan).toHaveBeenCalledWith([task.id], { day: day(4) })
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(await plan(task.id)).toEqual({ doDate: day(4), unplanned: undefined, nextFollowupAt: undefined, dueDate: day(2, 9), modifiedAt: STAMP })
    expect(steps()).toHaveLength(1)
  })

  it('a planned row gets another day; a held one a day, no longer held — both fields in the one write', async () => {
    const brief = await seed('Brief', { doDate: day(0), nextFollowupAt: day(1), dueDate: day(5) })
    const held = await seed('Held', { unplanned: true, dueDate: day(1) })
    const w = watchWrites()
    await drop(brief, tile(on(2)))
    await drop(held, tile(on(3)))
    expect(w.tasks()).toBe(2)
    expect(w.bulkUpdate.mock.calls.map((c) => c[0])).toEqual([
      [{ todoId: brief.id, changes: { doDate: day(2), unplanned: undefined } }],
      [{ todoId: held.id, changes: { doDate: day(3), unplanned: undefined } }],
    ])
    expect(await plan(brief.id)).toEqual({ doDate: day(2), unplanned: undefined, nextFollowupAt: day(1), dueDate: day(5), modifiedAt: STAMP })
    expect(await plan(held.id)).toEqual({ doDate: day(3), unplanned: undefined, nextFollowupAt: undefined, dueDate: day(1), modifiedAt: STAMP })
    // The undo holds it again.
    await useUndoStore.getState().undo()
    expect(await plan(held.id)).toMatchObject({ doDate: undefined, unplanned: true, modifiedAt: STAMP })
  })

  it('on the day its own date puts it, the task loses its plan: planned elsewhere, delayed or held', async () => {
    const planned = await seed('Planned', { dueDate: day(2), doDate: day(4) })
    const delayed = await seed('Delayed', { nextFollowupAt: day(1), doDate: day(-2) })
    const held = await seed('Held', { dueDate: day(3), unplanned: true })
    const late = await seed('Late', { dueDate: day(-4), doDate: day(2) })
    const w = watchWrites()
    await drop(planned, tile(on(2)))
    await drop(delayed, tile(on(1)))
    await drop(held, tile(on(3)))
    await drop(late, tile(on(0)))
    expect(w.setPlan.mock.calls).toEqual([[[planned.id], null], [[delayed.id], null], [[held.id], null], [[late.id], null]])
    expect(w.realDates()).toBe(0)
    for (const t of [planned, delayed, held, late]) {
      const after = await plan(t.id)
      expect(after).toMatchObject({ doDate: undefined, unplanned: undefined, modifiedAt: STAMP })
      expect(after.dueDate).toEqual(t.dueDate)
      expect(after.nextFollowupAt).toEqual(t.nextFollowupAt)
    }
    expect(steps()).toEqual(['Cleared the plan of “Planned”', 'Cleared the plan of “Delayed”', 'Cleared the plan of “Held”', 'Cleared the plan of “Late”'])
  })

  it('writes nothing on the day the row is on — Today for a late one', async () => {
    const late = await seed('Late', { dueDate: day(-3) })
    const planned = await seed('Planned', { doDate: day(2) })
    const w = watchWrites()
    await drop(late, tile(on(0)))
    await drop(planned, tile(on(2)))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
    expect((await storedTask(late.id)).doDate).toBeUndefined()
  })
})

describe('a drop on Unplanned', () => {
  const unplanned = (rows: string[] = [], shown: string[] = ['x']) => group(UNPLANNED, PLANNER_UNPLANNED_KEY, rows, shown)

  it('holds a task with a date there: `unplanned` set and the planned day cleared in the one write, its dates kept', async () => {
    const due = await seed('Due', { dueDate: day(2) })
    const chase = await seed('Chase', { nextFollowupAt: day(0), doDate: day(3) })
    const w = watchWrites()
    await drop(due, unplanned())
    await drop(chase, unplanned())
    expect(w.setPlan.mock.calls).toEqual([[[due.id], 'unplanned'], [[chase.id], 'unplanned']])
    expect(w.bulkUpdate.mock.calls.map((c) => c[0])).toEqual([
      [{ todoId: due.id, changes: { doDate: undefined, unplanned: true } }],
      [{ todoId: chase.id, changes: { doDate: undefined, unplanned: true } }],
    ])
    expect(w.realDates()).toBe(0)
    expect(await plan(due.id)).toEqual({ doDate: undefined, unplanned: true, nextFollowupAt: undefined, dueDate: day(2), modifiedAt: STAMP })
    expect(await plan(chase.id)).toEqual({ doDate: undefined, unplanned: true, nextFollowupAt: day(0), dueDate: undefined, modifiedAt: STAMP })
    expect(steps()).toEqual(['Unplanned “Due”', 'Unplanned “Chase”'])

    // The undo of the second puts its planned day back and lets it go.
    await useUndoStore.getState().undo()
    expect(await plan(chase.id)).toMatchObject({ doDate: day(3), unplanned: undefined, modifiedAt: STAMP })
  })

  it('never takes a task out of the Planner: a planned task with no date, not in Focus, is held — and Unplan’s undo plans it again', async () => {
    const bare = await seed('From a list', { doDate: day(2) })
    const w = watchWrites()
    await unplanPlannerTask('plan', bare.id, WINDOW)
    expect(w.setPlan).toHaveBeenCalledWith([bare.id], 'unplanned')
    expect(await plan(bare.id)).toMatchObject({ doDate: undefined, unplanned: true, modifiedAt: STAMP })
    const shown = plannerView(useTodoStore.getState().todos, { today: TODAY })
    expect(shown.unplanned.tasks.map((t) => t.id)).toEqual([bare.id])
    expect(shown.placements.get(bare.uid)).toMatchObject({ where: 'unplanned', placed: true })
    await useUndoStore.getState().undo()
    expect(await plan(bare.id)).toMatchObject({ doDate: day(2), unplanned: undefined, modifiedAt: STAMP })
  })

  it('a Focus task with no date just loses its plan (not held)', async () => {
    const task = await seed('Focus', { focus: true, doDate: day(1), dueDate: day(20) })
    const w = watchWrites()
    await drop(task, unplanned())
    expect(w.setPlan).toHaveBeenCalledWith([task.id], null)
    expect(await plan(task.id)).toEqual({ doDate: undefined, unplanned: undefined, nextFollowupAt: undefined, dueDate: day(20), modifiedAt: STAMP })
  })

  it('writes nothing for a row that is there already', async () => {
    const focus = await seed('Focus', { focus: true })
    const held = await seed('Held', { unplanned: true, dueDate: day(1) })
    const w = watchWrites()
    await drop(focus, unplanned([focus.uid, held.uid], [focus.uid, held.uid]))
    await drop(held, unplanned([focus.uid, held.uid], [focus.uid, held.uid]))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
  })

  it('holds a task with no plan, no date and no Focus: it joins the Planner, flagged, one undo step', async () => {
    const focus = await seed('Focus', { focus: true })
    const plain = await seed('Plain')
    const w = watchWrites()
    await drop(plain, unplanned([focus.uid], [focus.uid]), over(PLANNER_UNPLANNED_KEY, 0))
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(await plan(plain.id)).toMatchObject({ unplanned: true, doDate: undefined, modifiedAt: STAMP })
    expect(steps()).toEqual(['Unplanned “Plain”'])
  })
})

describe('a drop on Delayed, and a completed task', () => {
  const delayed = (rows: string[], shown: string[]) => group(DELAYED, PLANNER_DELAYED_KEY, rows, shown)

  it('Delayed takes no drop: no write, no order, no undo step', async () => {
    const missed = await seed('Missed', { doDate: day(-1) })
    const due = await seed('Due', { dueDate: day(2) })
    const planned = await seed('Planned', { doDate: day(2) })
    const focus = await seed('Focus', { focus: true })
    const w = watchWrites()
    for (const t of [due, planned, focus]) await drop(t, delayed([missed.uid], [missed.uid, t.uid]), over(PLANNER_DELAYED_KEY, 0))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
    expect(await storedOrder()).toBeUndefined()
  })

  it('a row already in Delayed only reorders', async () => {
    const a = await seed('A', { doDate: day(-1) })
    const b = await seed('B', { doDate: day(-2) })
    const w = watchWrites()
    await drop(a, delayed([b.uid, a.uid], [b.uid, a.uid]), over(PLANNER_DELAYED_KEY, 0))
    expect(w.tasks()).toBe(0)
    expect(await storedOrder()).toEqual([a.uid, b.uid])
    expect(await plan(a.id)).toMatchObject({ doDate: day(-1), modifiedAt: STAMP })
  })

  it('refuses a completed task anywhere', async () => {
    const done = await seed('Done', { isCompleted: true, completedAt: NOW, nextFollowupAt: day(0) })
    const w = watchWrites()
    await drop(done, tile(on(3)))
    await drop(done, group(UNPLANNED, PLANNER_UNPLANNED_KEY, [], []), over(PLANNER_UNPLANNED_KEY, 0))
    await drop(done, delayed([], []), over(PLANNER_DELAYED_KEY, 0))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
  })
})

describe('rows from elsewhere', () => {
  it('a list’s row is taken by the same rule: planned, or left to its own date', async () => {
    const plain = await seed('Plain')
    const followup = await seed('Call', { nextFollowupAt: day(2) })
    const far = await seed('Far', { nextFollowupAt: day(30) })
    const w = watchWrites()
    const fromList = { listTabId: 'a-list', sectionKey: 'all', rowKey: 'all|1' }
    await drop(plain, tile(on(1)), null, fromList)
    // On the day its follow-up puts it already: nothing. On another: a plan.
    await drop(followup, tile(on(2)), null, fromList)
    await drop(followup, tile(on(0)), null, fromList)
    await drop(far, tile(on(3)), null, fromList)
    expect(w.tasks()).toBe(3)
    expect(w.realDates()).toBe(0)
    expect((await storedTask(plain.id)).doDate).toEqual(day(1))
    expect(await plan(followup.id)).toMatchObject({ doDate: day(0), nextFollowupAt: day(2) })
    expect(await plan(far.id)).toMatchObject({ doDate: day(3), nextFollowupAt: day(30) })
  })

  it('a calendar entry dropped on a Planner is the Planner’s drop, never its date', async () => {
    const task = await seed('Entry', { dueDate: day(1) })
    const w = watchWrites()
    await drop(task, tile(on(3)), null, { calendarDateType: 'due' })
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(await plan(task.id)).toMatchObject({ doDate: day(3), dueDate: day(1) })
  })

  it('the write is decided for the task as stored, not the row as dragged', async () => {
    const task = await seed('Changed', { dueDate: day(3), doDate: day(1) })
    // Its due date was cleared while it was dragged: Monday is no longer its own date's day.
    await db.todos.update(task.id, { dueDate: undefined })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === task.id ? { ...t, dueDate: undefined } : t)) })
    await drop(task, tile(on(3)))
    expect(await plan(task.id)).toMatchObject({ doDate: day(3), dueDate: undefined })
  })

  it('does nothing for a task that is gone', async () => {
    const task = await seed('Gone')
    await db.todos.delete(task.id)
    useTodoStore.setState({ todos: useTodoStore.getState().todos.filter((t) => t.id !== task.id) })
    const w = watchWrites()
    await drop(task, tile(on(3)))
    expect(w.tasks()).toBe(0)
    expect(planPlannerDrop({ todo: task, tabId: 'plan', target: on(3), window: WINDOW, group: null }, null)).toBeNull()
  })
})

describe('the hand order', () => {
  it('a row dragged inside its group: the whole displayed sequence with it in its new place, on the tab — no task write, no undo step', async () => {
    const a = await seed('A', { dueDate: day(-1) })
    const b = await seed('B', { nextFollowupAt: day(0) })
    const c = await seed('C', { doDate: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const shown = [a.uid, b.uid, c.uid, d.uid]
    const w = watchWrites()
    await drop(c, group(on(0), '2026-11-20', [a.uid, b.uid, c.uid], shown), over('2026-11-20', 0))
    expect(w.tasks()).toBe(0)
    expect(w.patch).toHaveBeenCalledTimes(1)
    expect(await storedOrder()).toEqual([c.uid, a.uid, b.uid, d.uid])
    expect(steps()).toEqual([])
    for (const t of [a, b, c, d]) expect((await storedTask(t.id)).modifiedAt).toEqual(STAMP)
    // The other Planner of the layout keeps its own.
    expect(await storedOrder('plan-2')).toBeUndefined()
  })

  it('a row dropped into another group: the plan write and its place there, one of each', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const e = await seed('E', { doDate: day(3) })
    const shown = [a.uid, d.uid, e.uid]
    const w = watchWrites()
    await drop(a, group(on(3), '2026-11-23', [d.uid, e.uid], shown), over('2026-11-23', 1))
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(w.patch).toHaveBeenCalledTimes(1)
    expect(await plan(a.id)).toMatchObject({ doDate: day(3), nextFollowupAt: day(0) })
    expect(await storedOrder()).toEqual([d.uid, a.uid, e.uid])
  })

  it('a plan write that fails: the user is told, the plan is as it was, and the hand order goes back to the one stored before', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const b = await seed('B', { dueDate: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const e = await seed('E', { doDate: day(3) })
    const shown = [b.uid, a.uid, d.uid, e.uid]
    // An order stored before: a dragged above b in Today.
    await drop(a, group(on(0), '2026-11-20', [b.uid, a.uid], shown), over('2026-11-20', 0))
    const before = await storedOrder()
    expect(before).toEqual([a.uid, b.uid, d.uid, e.uid])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bulkUpdate = vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await drop(a, group(on(3), '2026-11-23', [d.uid, e.uid], [a.uid, b.uid, d.uid, e.uid]), over('2026-11-23', 1))
    bulkUpdate.mockRestore()
    expect(await plan(a.id)).toMatchObject({ doDate: undefined, nextFollowupAt: day(0), modifiedAt: STAMP })
    expect(steps()).toEqual([])
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't save the plan of “A”.", notice: true })
    // The row never reached Monday: no place among its rows is kept.
    expect(await storedOrder()).toEqual(before)
  })

  it('a dated row dropped into Unplanned is held where it was dropped, among the tray’s rows', async () => {
    const a = await seed('A', { dueDate: day(1) })
    const f = await seed('F', { focus: true })
    const g = await seed('G', { unplanned: true, nextFollowupAt: day(2) })
    const shown = [a.uid, f.uid, g.uid]
    await drop(a, group(UNPLANNED, PLANNER_UNPLANNED_KEY, [f.uid, g.uid], shown), over(PLANNER_UNPLANNED_KEY, 1))
    expect(await plan(a.id)).toMatchObject({ unplanned: true, dueDate: day(1) })
    expect(await storedOrder()).toEqual([f.uid, a.uid, g.uid])
  })

  it('is written before the task, in the drop’s own turn', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const movePlan = planPlannerDrop(
      { todo: a, tabId: 'plan', target: on(3), window: WINDOW, group: { key: '2026-11-23', rows: [d.uid], shown: [a.uid, d.uid] } },
      over('2026-11-23', 0),
    )
    const written = applyPlannerMove('plan', a.id, movePlan!)
    // Synchronously: the layout on screen has the order before the task's write resolves.
    const tab = ws().working?.cells.flatMap((c) => c.tabs).find((t) => t.id === 'plan') as PlannerTab
    expect(tab.viewState?.order).toEqual([a.uid, d.uid])
    await written
  })

  it('takes the place only from a preview of that very group of that Planner', async () => {
    const a = await seed('A', { dueDate: day(-1) })
    const b = await seed('B', { doDate: day(0) })
    const target = group(on(0), '2026-11-20', [a.uid, b.uid], [a.uid, b.uid])
    const w = watchWrites()
    // No preview, one of another group, of another Planner, of a tile, one with no place: the order stays.
    await drop(b, target, null)
    await drop(b, target, over('2026-11-21', 0))
    await drop(b, target, over('2026-11-20', 0, 'plan-2'))
    await drop(b, target, { tabId: 'plan', over: 'tile', key: '2026-11-20', drop: { kind: 'none' }, index: 0 })
    await drop(b, target, over('2026-11-20', null))
    expect(w.patch).not.toHaveBeenCalled()
    expect(await storedOrder()).toBeUndefined()
    await drop(b, target, over('2026-11-20', 0))
    expect(await storedOrder()).toEqual([b.uid, a.uid])
  })

  it('a row dropped on a tile keeps the order as it is', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const w = watchWrites()
    await drop(a, tile(on(3)), over('2026-11-23', 0))
    expect(w.tasks()).toBe(1)
    expect(w.patch).not.toHaveBeenCalled()
  })

  it('a row dropped where it is writes nothing at all', async () => {
    const a = await seed('A', { dueDate: day(-1) })
    const b = await seed('B', { doDate: day(0) })
    const w = watchWrites()
    await drop(b, group(on(0), '2026-11-20', [a.uid, b.uid], [a.uid, b.uid]), over('2026-11-20', 1))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
  })

  it('keeps the place of a task the screen filter hides (Today as C, A, B; C hidden; A dragged below B)', async () => {
    const a = await seed('A', { doDate: day(0) })
    const b = await seed('B', { doDate: day(0) })
    const c = await seed('C', { doDate: day(0) })
    await ws().patchTabViewState('plan', 'planner', { order: [c.uid, a.uid, b.uid] })
    // The filter hides C: the Planner shows A, B.
    await drop(a, group(on(0), '2026-11-20', [a.uid, b.uid], [a.uid, b.uid]), over('2026-11-20', 1))
    // With the filter cleared: C first still, then B, A as dropped.
    expect(await storedOrder()).toEqual([c.uid, b.uid, a.uid])
  })

  it('keeps a day’s order while the window is shifted past it (Wednesday ordered; a reorder in the shifted week)', async () => {
    const t1 = await seed('T1', { dueDate: day(-1) })
    const w1 = await seed('W1', { doDate: day(5) })
    const w2 = await seed('W2', { doDate: day(5) })
    const w3 = await seed('W3', { doDate: day(5) })
    const n1 = await seed('N1', { doDate: day(8) })
    const n2 = await seed('N2', { doDate: day(8) })
    await ws().patchTabViewState('plan', 'planner', { order: [t1.uid, w2.uid, w1.uid, w3.uid] })
    // Shifted a week: Today and next week show; Wednesday is in no group.
    const shifted: PlannerDropData = {
      type: TASK_DROP_KIND.plannerGroup,
      scope: 'plan',
      target: on(8),
      window: { today: TODAY, last: day(13) },
      group: { key: '2026-11-28', rows: [n1.uid, n2.uid], shown: [t1.uid, n1.uid, n2.uid] },
    }
    await drop(n2, shifted, over('2026-11-28', 0))
    const order = await storedOrder()
    expect(order?.filter((u) => [w1.uid, w2.uid, w3.uid].includes(u))).toEqual([w2.uid, w1.uid, w3.uid])
    expect(order).toEqual([t1.uid, n2.uid, n1.uid, w2.uid, w1.uid, w3.uid])
  })

  it('drops from the order only the tasks the todo store no longer holds; a completed one keeps its place', async () => {
    const a = await seed('A', { dueDate: day(-1) })
    const b = await seed('B', { doDate: day(0) })
    const done = await seed('Done', { isCompleted: true, completedAt: NOW, doDate: day(0) })
    await ws().patchTabViewState('plan', 'planner', { order: ['deleted-1', done.uid, b.uid, 'deleted-2', a.uid] })
    await drop(b, group(on(0), '2026-11-20', [b.uid, a.uid], [b.uid, a.uid]), over('2026-11-20', 1))
    expect(await storedOrder()).toEqual([done.uid, a.uid, b.uid])
  })

  it('keeps within the layout’s cap: the tasks not shown go first, the earliest first', async () => {
    const a = await seed('A', { dueDate: day(-1) })
    const b = await seed('B', { doDate: day(0) })
    // Existing tasks the Planner doesn't show, filling the order to its cap.
    const hidden: string[] = []
    const rows = Array.from({ length: PLANNER_ORDER_MAX - 1 }, (_, i) => ({ todo: { title: `H${i}`, isCompleted: false, createdAt: NOW, modifiedAt: NOW }, personIds: [], tagIds: [] }))
    const ids = await useTodoStore.getState().addMany(rows, { description: 'Add hidden' })
    for (const id of ids) hidden.push(useTodoStore.getState().todos.find((t) => t.id === id)!.uid)
    await ws().patchTabViewState('plan', 'planner', { order: [...hidden, a.uid] })
    await drop(b, group(on(0), '2026-11-20', [a.uid, b.uid], [a.uid, b.uid]), over('2026-11-20', 0))
    const order = await storedOrder()
    expect(order).toHaveLength(PLANNER_ORDER_MAX)
    // One too many: the first hidden one went; the shown rows are there, as dropped.
    expect(order?.[0]).toBe(hidden[1])
    expect(order?.slice(-2)).toEqual([b.uid, a.uid])
  })
})

describe('Plan for day › (no pointer)', () => {
  it('makes the same writes as a drop on the day, and never an order or a real date', async () => {
    const chase = await seed('Chase', { nextFollowupAt: day(0) })
    const venue = await seed('Venue', { dueDate: day(2) })
    const w = watchWrites()
    await movePlannerTask('plan', { todoId: chase.id, target: on(3), window: WINDOW })
    await movePlannerTask('plan', { todoId: venue.id, target: on(4), window: WINDOW })
    expect(w.tasks()).toBe(2)
    expect(w.realDates()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(await plan(chase.id)).toMatchObject({ doDate: day(3), nextFollowupAt: day(0), modifiedAt: STAMP })
    expect(await plan(venue.id)).toMatchObject({ doDate: day(4), dueDate: day(2), modifiedAt: STAMP })

    // Back onto its own date's day: the plan cleared. The day it is on: nothing.
    await movePlannerTask('plan', { todoId: venue.id, target: on(2), window: WINDOW })
    expect(await plan(venue.id)).toMatchObject({ doDate: undefined, unplanned: undefined, dueDate: day(2) })
    const before = w.tasks()
    await movePlannerTask('plan', { todoId: venue.id, target: on(2), window: WINDOW })
    await movePlannerTask('plan', { todoId: chase.id, target: on(3), window: WINDOW })
    expect(w.tasks()).toBe(before)
  })

  it('a menu’s pick plans the day outright — its own date’s day too — in one unstamped write and one undo step', async () => {
    const venue = await seed('Venue', { dueDate: day(2), doDate: day(4) })
    const chase = await seed('Chase', { nextFollowupAt: day(1) })
    const w = watchWrites()
    const stepsBefore = steps().length
    await movePlannerTask(null, { todoId: venue.id, target: pickOn(2), window: WINDOW })
    expect(await plan(venue.id)).toMatchObject({ doDate: day(2), dueDate: day(2), modifiedAt: STAMP })
    expect(steps()).toHaveLength(stepsBefore + 1)
    // Not planned yet, on its own date's day by its follow-up: planned there.
    await movePlannerTask(null, { todoId: chase.id, target: pickOn(1), window: WINDOW })
    expect(await plan(chase.id)).toMatchObject({ doDate: day(1), modifiedAt: STAMP })
    expect(w.realDates()).toBe(0)
    // Planned for that day already: nothing.
    const before = w.tasks()
    await movePlannerTask(null, { todoId: venue.id, target: pickOn(2), window: WINDOW })
    expect(w.tasks()).toBe(before)
    // A day before today is refused.
    await movePlannerTask(null, { todoId: chase.id, target: pickOn(-1), window: WINDOW })
    expect(w.tasks()).toBe(before)
    await useUndoStore.getState().undo()
    expect(await plan(chase.id)).toMatchObject({ doDate: undefined, modifiedAt: STAMP })
  })
})

describe('Snooze', () => {
  it('plans the task for the day after the one it sits on — by a plan or by its own date', async () => {
    const planned = await seed('Planned', { doDate: day(2) })
    const due = await seed('Due', { dueDate: day(3) })
    const late = await seed('Late', { nextFollowupAt: day(-4) })
    const w = watchWrites()
    await snoozePlannerTask('plan', planned.id, WINDOW)
    await snoozePlannerTask('plan', due.id, WINDOW)
    await snoozePlannerTask('plan', late.id, WINDOW)
    expect(w.tasks()).toBe(3)
    expect(w.realDates()).toBe(0)
    expect(await plan(planned.id)).toMatchObject({ doDate: day(3), modifiedAt: STAMP })
    expect(await plan(due.id)).toMatchObject({ doDate: day(4), dueDate: day(3), modifiedAt: STAMP })
    // A late row sits on today: tomorrow.
    expect(await plan(late.id)).toMatchObject({ doDate: day(1), nextFollowupAt: day(-4), modifiedAt: STAMP })
    expect(steps()).toEqual(['Planned “Planned”', 'Planned “Due”', 'Planned “Late”'])
  })

  it('past the window with no real date inside it: the task leaves the view, and the snackbar names the day with its Undo', async () => {
    // A plan on the window's last day (Thu 26), no date.
    const task = await seed('Last day', { doDate: day(6) })
    const w = watchWrites()
    await snoozePlannerTask('plan', task.id, WINDOW)
    expect(w.setPlan).toHaveBeenCalledWith([task.id], { day: day(7) }, 'Planned for Fri, Nov 27', true)
    expect(await plan(task.id)).toMatchObject({ doDate: day(7), modifiedAt: STAMP })
    expect(plannerPlacement(useTodoStore.getState().todos.find((t) => t.id === task.id)!, WINDOW)).toBeNull()
    expect(steps()).toEqual(['Planned for Fri, Nov 27'])
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Planned for Fri, Nov 27' })
    expect(useUndoStore.getState().snackbar?.notice).toBeUndefined()
    await useUndoStore.getState().undo()
    expect(await plan(task.id)).toMatchObject({ doDate: day(6), modifiedAt: STAMP })
    expect(viewNow().days.at(-1)?.tasks.map((t) => t.id)).toEqual([task.id])
  })

  it('past the window with a real date inside it: the row stays in view on its natural day, planned later — no snackbar', async () => {
    // On the window's last day by its due date.
    const due = await seed('Due last day', { dueDate: day(6) })
    // Overdue, in Today.
    const late = await seed('Overdue', { nextFollowupAt: day(-2), doDate: day(6) })
    const w = watchWrites()
    await snoozePlannerTask('plan', due.id, WINDOW)
    await snoozePlannerTask('plan', late.id, WINDOW)
    expect(w.setPlan.mock.calls).toEqual([[[due.id], { day: day(7) }], [[late.id], { day: day(7) }]])
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(w.realDates()).toBe(0)
    const view = viewNow()
    expect(view.days.at(-1)?.tasks.map((t) => t.id)).toEqual([due.id])
    expect(view.today.tasks.map((t) => t.id)).toEqual([late.id])
    expect(view.placements.get(due.uid)).toMatchObject({ where: 'day', day: day(6), reason: 'due', placed: true, planned: day(7) })
    expect(view.placements.get(late.uid)).toMatchObject({ where: 'day', day: day(0), reason: 'followup', placed: true, planned: day(7) })
    // Again: a day further, still in view.
    await snoozePlannerTask('plan', due.id, WINDOW)
    expect(await plan(due.id)).toMatchObject({ doDate: day(8), dueDate: day(6) })
    expect(viewNow().placements.get(due.uid)).toMatchObject({ day: day(6), planned: day(8) })
  })

  it('a Delayed or Unplanned row goes to tomorrow', async () => {
    const delayed = await seed('Delayed', { doDate: day(-3) })
    const held = await seed('Held', { unplanned: true, dueDate: day(4) })
    const focus = await seed('Focus', { focus: true })
    for (const t of [delayed, held, focus]) await snoozePlannerTask('plan', t.id, WINDOW)
    for (const t of [delayed, held, focus]) expect(await plan(t.id)).toMatchObject({ doDate: day(1), unplanned: undefined })
  })

  it('goes through the drop rule: landing on its own date’s day clears the plan', async () => {
    const task = await seed('Venue', { doDate: day(1), dueDate: day(2) })
    const held = await seed('Held', { unplanned: true, nextFollowupAt: day(1) })
    const w = watchWrites()
    await snoozePlannerTask('plan', task.id, WINDOW)
    await snoozePlannerTask('plan', held.id, WINDOW)
    expect(w.setPlan.mock.calls).toEqual([[[task.id], null], [[held.id], null]])
    expect(await plan(task.id)).toMatchObject({ doDate: undefined, unplanned: undefined, dueDate: day(2) })
    expect(await plan(held.id)).toMatchObject({ doDate: undefined, unplanned: undefined, nextFollowupAt: day(1) })
  })

  it('snoozing twice moves on a day each time; one undo step each', async () => {
    const task = await seed('Venue', { dueDate: day(0) })
    await snoozePlannerTask('plan', task.id, WINDOW)
    await snoozePlannerTask('plan', task.id, WINDOW)
    expect(await plan(task.id)).toMatchObject({ doDate: day(2), dueDate: day(0), modifiedAt: STAMP })
    expect(steps()).toHaveLength(2)
    await useUndoStore.getState().undo()
    expect(await plan(task.id)).toMatchObject({ doDate: day(1) })
  })

  it('does nothing for a completed task or one that is gone', async () => {
    const done = await seed('Done', { isCompleted: true, completedAt: NOW, doDate: day(1) })
    const w = watchWrites()
    await snoozePlannerTask('plan', done.id, WINDOW)
    await snoozePlannerTask('plan', 9999, WINDOW)
    expect(w.tasks()).toBe(0)
  })
})

describe('Unplan', () => {
  it('is the Unplanned drop for one row: held with a date, else its plan cleared', async () => {
    const dated = await seed('Dated', { doDate: day(3), dueDate: day(1) })
    const byDate = await seed('By date', { nextFollowupAt: day(2) })
    const focus = await seed('Focus', { focus: true, doDate: day(2) })
    const w = watchWrites()
    for (const t of [dated, byDate, focus]) await unplanPlannerTask('plan', t.id, WINDOW)
    expect(w.setPlan.mock.calls).toEqual([[[dated.id], 'unplanned'], [[byDate.id], 'unplanned'], [[focus.id], null]])
    expect(w.realDates()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(await plan(dated.id)).toMatchObject({ doDate: undefined, unplanned: true, dueDate: day(1), modifiedAt: STAMP })
    expect(await plan(byDate.id)).toMatchObject({ unplanned: true, nextFollowupAt: day(2), modifiedAt: STAMP })
    expect(await plan(focus.id)).toMatchObject({ doDate: undefined, unplanned: undefined })
  })

  it('writes nothing for a row in Unplanned already', async () => {
    const held = await seed('Held', { unplanned: true, dueDate: day(1) })
    const focus = await seed('Focus', { focus: true })
    const w = watchWrites()
    await unplanPlannerTask('plan', held.id, WINDOW)
    await unplanPlannerTask('plan', focus.id, WINDOW)
    expect(w.tasks()).toBe(0)
  })
})

describe('Unplan all Delayed', () => {
  it('moves every Delayed task to Unplanned in one write and one undo step — held with a date, else cleared; nothing else changes', async () => {
    const dated = await seed('Dated', { doDate: day(-1), dueDate: day(2) })
    const late = await seed('Late', { doDate: day(-3), nextFollowupAt: day(-5) })
    const focus = await seed('Focus', { doDate: day(-2), focus: true })
    const today = await seed('Today', { doDate: day(0) })
    const held = await seed('Held', { unplanned: true, dueDate: day(1) })
    const view = viewNow()
    expect(view.delayed.tasks.map((t) => t.id).sort()).toEqual([dated.id, late.id, focus.id].sort())
    const w = watchWrites()
    await unplanDelayedTasks(view)
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(steps()).toEqual(['Unplanned 3 tasks from Delayed'])
    // With the snackbar and its Undo.
    expect(useUndoStore.getState().snackbar?.description).toBe('Unplanned 3 tasks from Delayed')
    expect(await plan(dated.id)).toMatchObject({ doDate: undefined, unplanned: true, dueDate: day(2), modifiedAt: STAMP })
    expect(await plan(late.id)).toMatchObject({ doDate: undefined, unplanned: true, nextFollowupAt: day(-5), modifiedAt: STAMP })
    expect(await plan(focus.id)).toMatchObject({ doDate: undefined, unplanned: undefined, modifiedAt: STAMP })
    expect(await plan(today.id)).toMatchObject({ doDate: day(0) })
    expect(await plan(held.id)).toMatchObject({ unplanned: true })
    const after = viewNow()
    expect(after.delayed.tasks).toEqual([])
    expect(after.unplanned.tasks.map((t) => t.id).sort()).toEqual([dated.id, late.id, focus.id, held.id].sort())

    await useUndoStore.getState().undo()
    expect(viewNow().delayed.tasks.map((t) => t.id).sort()).toEqual([dated.id, late.id, focus.id].sort())
    for (const t of [dated, late, focus]) expect(await plan(t.id)).toMatchObject({ doDate: t.doDate, unplanned: undefined, modifiedAt: STAMP })
    await useUndoStore.getState().redo()
    expect(viewNow().delayed.tasks).toEqual([])
    expect(steps()).toEqual(['Unplanned 3 tasks from Delayed'])
  })

  it('with nothing in Delayed: no write, no step', async () => {
    await seed('Today', { doDate: day(0) })
    const w = watchWrites()
    await unplanDelayedTasks(viewNow())
    expect(w.tasks()).toBe(0)
    expect(steps()).toEqual([])
  })
})

describe('Reset plan', () => {
  async function week() {
    return {
      plannedToday: await seed('Planned today', { doDate: day(0), dueDate: day(3) }),
      byDate: await seed('By date', { dueDate: day(0) }),
      plannedMon: await seed('Planned Mon', { doDate: day(3) }),
      delayed: await seed('Delayed', { doDate: day(-2), nextFollowupAt: day(1) }),
      held: await seed('Held', { unplanned: true, dueDate: day(2) }),
      focus: await seed('Focus', { focus: true }),
      far: await seed('Far', { doDate: day(9) }),
    }
  }
  const NO_PLAN = { doDate: undefined, unplanned: undefined, modifiedAt: STAMP }
  /** The confirm prompt Reset plan asks, answered `answer`; its questions. */
  let asked: ConfirmPrompt[] = []
  function answer(yes: boolean) {
    asked = []
    useUIStore.setState({
      askConfirmation: (prompt) => {
        asked.push(prompt)
        return Promise.resolve(yes)
      },
    })
  }
  beforeEach(() => answer(true))

  it('asks first — how many plans it clears, and how many of those tasks then leave the Planner; Cancel writes nothing', async () => {
    await week()
    await seed('Parked', { unplanned: true })
    answer(false)
    const w = watchWrites()
    await resetPlannerPlan(viewNow(), 'week')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ title: 'Reset plan: this week?', confirmLabel: 'Reset plan' })
    expect(asked[0]?.message).toBe('This clears the plan of 5 tasks: each goes back to where its own dates put it. 2 of them have no date in the Planner and leave it. No due date or follow-up changes.')
    expect(w.tasks()).toBe(0)
    expect(steps()).toEqual([])
  })

  it('this week: clears every plan state the Planner shows or holds, one write and one undo step; real dates and plans past the window stay', async () => {
    const t = await week()
    const view = viewNow()
    expect(plannerResetCounts(view)).toEqual({ week: 4, today: 1, delayed: 1 })
    const w = watchWrites()
    await resetPlannerPlan(view, 'week')
    expect(w.tasks()).toBe(1)
    expect(w.realDates()).toBe(0)
    expect(steps()).toEqual(['Reset plan: this week'])
    // With the snackbar and its Undo.
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Reset plan: this week' })
    expect(useUndoStore.getState().snackbar?.notice).toBeUndefined()
    for (const task of [t.plannedToday, t.plannedMon, t.delayed, t.held]) expect(await plan(task.id)).toMatchObject(NO_PLAN)
    expect(await plan(t.plannedToday.id)).toMatchObject({ dueDate: day(3) })
    expect(await plan(t.delayed.id)).toMatchObject({ nextFollowupAt: day(1) })
    expect(await plan(t.far.id)).toMatchObject({ doDate: day(9) })
    expect(plannerResetCounts(viewNow())).toEqual({ week: 0, today: 0, delayed: 0 })

    await useUndoStore.getState().undo()
    expect(await plan(t.plannedToday.id)).toMatchObject({ doDate: day(0), modifiedAt: STAMP })
    expect(await plan(t.plannedMon.id)).toMatchObject({ doDate: day(3), modifiedAt: STAMP })
    expect(await plan(t.delayed.id)).toMatchObject({ doDate: day(-2), modifiedAt: STAMP })
    expect(await plan(t.held.id)).toMatchObject({ unplanned: true, doDate: undefined, modifiedAt: STAMP })
    expect(plannerResetCounts(viewNow())).toEqual({ week: 4, today: 1, delayed: 1 })
  })

  it('today only: the tasks planned for today', async () => {
    const t = await week()
    await resetPlannerPlan(viewNow(), 'today')
    expect(steps()).toEqual(['Reset plan: today'])
    expect(await plan(t.plannedToday.id)).toMatchObject(NO_PLAN)
    expect(await plan(t.plannedMon.id)).toMatchObject({ doDate: day(3) })
    expect(await plan(t.delayed.id)).toMatchObject({ doDate: day(-2) })
    expect(await plan(t.held.id)).toMatchObject({ unplanned: true })
    expect(plannerResetCounts(viewNow())).toEqual({ week: 3, today: 0, delayed: 1 })
  })

  it('Delayed only', async () => {
    const t = await week()
    await resetPlannerPlan(viewNow(), 'delayed')
    expect(steps()).toEqual(['Reset plan: Delayed'])
    expect(await plan(t.delayed.id)).toMatchObject(NO_PLAN)
    expect(await plan(t.plannedToday.id)).toMatchObject({ doDate: day(0) })
    expect(await plan(t.held.id)).toMatchObject({ unplanned: true })
    expect(plannerResetCounts(viewNow())).toEqual({ week: 3, today: 1, delayed: 0 })
  })

  it('with the window shifted the step is named for the days shown', async () => {
    const tomorrow = await seed('Tomorrow', { doDate: day(1) })
    const next = await seed('Next week', { doDate: day(8) })
    await resetPlannerPlan(plannerView(useTodoStore.getState().todos, { today: TODAY, offset: 7 }), 'week')
    expect(steps()).toEqual(['Reset plan: Nov 27 – Dec 3'])
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Reset plan: Nov 27 – Dec 3' })
    expect(await plan(next.id)).toMatchObject({ doDate: undefined })
    // Tomorrow is not one of the days shown: its plan stands.
    expect(await plan(tomorrow.id)).toMatchObject({ doDate: day(1) })
  })

  it('a scope with nothing in it writes nothing', async () => {
    await seed('By date', { dueDate: day(0) })
    const w = watchWrites()
    for (const scope of ['week', 'today', 'delayed'] as const) await resetPlannerPlan(viewNow(), scope)
    expect(w.tasks()).toBe(0)
    expect(steps()).toEqual([])
    // Nor asks.
    expect(asked).toEqual([])
  })
})

describe('a conflict’s fixes', () => {
  /** The fixes of the task's conflict with `date`, as the Planner offers them. */
  function fixes(id: number, date: PlannerDateKind) {
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
    return plannerPlacement(todo, WINDOW)?.conflicts.find((c) => c.date === date)?.fixes ?? []
  }

  it('Move due date to the planned day: a real edit — the day at local midnight, stamped, in the history — and the plan it makes redundant cleared, all one undo step', async () => {
    const task = await seed('Venue', { doDate: day(3), dueDate: day(1, 9) })
    const events = await eventCount(task.id)
    const [move] = fixes(task.id, 'due')
    expect(move).toEqual({ kind: 'move-date', date: 'due', to: day(3) })
    const w = watchWrites()
    await applyPlannerFix('plan', task.id, move!, WINDOW)
    expect(w.update).toHaveBeenCalledTimes(1)
    expect(w.update).toHaveBeenCalledWith(task.id, { dueDate: day(3), doDate: undefined, unplanned: undefined })
    expect(w.setPlan).not.toHaveBeenCalled()
    const after = await storedTask(task.id)
    // The planned day at local midnight: not the old time of day, not noon.
    expect(after.dueDate).toEqual(day(3))
    expect(after.dueDate?.getHours()).toBe(0)
    // Its own date puts it on that day now: the plan went with the edit.
    expect(after.doDate).toBeUndefined()
    expect(after.unplanned).toBeUndefined()
    expect(after.modifiedAt).toEqual(NOW)
    expect(await eventCount(task.id)).toBe(events + 1)
    expect(steps()).toEqual(['Edit "Venue"'])
    // No conflict left, the row where it was and no longer placed.
    expect(plannerPlacement(useTodoStore.getState().todos.find((t) => t.id === task.id)!, WINDOW)).toMatchObject({
      where: 'day', day: day(3), reason: 'due', placed: false, conflicts: [],
    })

    await useUndoStore.getState().undo()
    const undone = await storedTask(task.id)
    expect(undone.dueDate).toEqual(day(1, 9))
    expect(undone.modifiedAt).toEqual(STAMP)
    expect(undone.doDate).toEqual(day(3))
    expect(steps()).toEqual([])
    await useUndoStore.getState().redo()
    expect(await plan(task.id)).toMatchObject({ dueDate: day(3), doDate: undefined, unplanned: undefined })
  })

  it('the plan stays while another, earlier date still puts the task elsewhere; the second fix clears it', async () => {
    // Due Sat, follow-up Sun, planned Wed.
    const task = await seed('Both', { doDate: day(5), dueDate: day(1), nextFollowupAt: day(2) })
    const w = watchWrites()
    await applyPlannerFix('plan', task.id, fixes(task.id, 'due')[0]!, WINDOW)
    expect(w.update).toHaveBeenLastCalledWith(task.id, { dueDate: day(5) })
    expect(await plan(task.id)).toMatchObject({ dueDate: day(5), nextFollowupAt: day(2), doDate: day(5) })
    expect(plannerPlacement(useTodoStore.getState().todos.find((t) => t.id === task.id)!, WINDOW)).toMatchObject({ placed: true, conflicts: [{ date: 'followup' }] })
    await applyPlannerFix('plan', task.id, fixes(task.id, 'followup')[0]!, WINDOW)
    expect(w.update).toHaveBeenLastCalledWith(task.id, { nextFollowupAt: day(5), doDate: undefined, unplanned: undefined })
    expect(await plan(task.id)).toMatchObject({ dueDate: day(5), nextFollowupAt: day(5), doDate: undefined })
    expect(w.setPlan).not.toHaveBeenCalled()
  })

  it('Move follow-up to the planned day likewise', async () => {
    const task = await seed('Chase', { doDate: day(4), nextFollowupAt: day(2, 12) })
    const events = await eventCount(task.id)
    const [move] = fixes(task.id, 'followup')
    expect(move).toEqual({ kind: 'move-date', date: 'followup', to: day(4) })
    const w = watchWrites()
    await applyPlannerFix('plan', task.id, move!, WINDOW)
    expect(w.update).toHaveBeenCalledWith(task.id, { nextFollowupAt: day(4), doDate: undefined, unplanned: undefined })
    const after = await storedTask(task.id)
    expect(after.nextFollowupAt).toEqual(day(4))
    expect(after.nextFollowupAt?.getHours()).toBe(0)
    expect(after.dueDate).toBeUndefined()
    expect(after.lastFollowupAt).toBeUndefined()
    expect(after.doDate).toBeUndefined()
    expect(after.modifiedAt).toEqual(NOW)
    expect(await eventCount(task.id)).toBe(events + 1)
    expect(steps()).toEqual(['Edit "Chase"'])
  })

  it('a row planned later: Plan for its date’s day plans it there; Move date to the planned day takes it out of view, with the snackbar', async () => {
    // Due Thu 26, planned Fri 27 (past the window): it shows on Thu.
    const a = await seed('Plan back', { doDate: day(7), dueDate: day(6) })
    const b = await seed('Move on', { doDate: day(7), dueDate: day(6) })
    expect(fixes(a.id, 'due')).toEqual([{ kind: 'move-date', date: 'due', to: day(7) }, { kind: 'plan', day: day(6) }])
    const w = watchWrites()
    await applyPlannerFix('plan', a.id, fixes(a.id, 'due')[1]!, WINDOW)
    expect(w.setPlan).toHaveBeenLastCalledWith([a.id], { day: day(6) })
    expect(await plan(a.id)).toMatchObject({ doDate: day(6), dueDate: day(6), modifiedAt: STAMP })
    expect(useUndoStore.getState().snackbar).toBeNull()

    await applyPlannerFix('plan', b.id, fixes(b.id, 'due')[0]!, WINDOW)
    // The due date is the planned day now, past the window: the plan stays (a plan like any other), out of view.
    expect(w.update).toHaveBeenLastCalledWith(b.id, { dueDate: day(7) })
    expect(await plan(b.id)).toMatchObject({ doDate: day(7), dueDate: day(7) })
    expect(viewNow().placements.has(b.uid)).toBe(false)
    expect(steps().at(-1)).toBe('Moved the due date to Fri, Nov 27')
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Moved the due date to Fri, Nov 27' })
    await useUndoStore.getState().undo()
    expect(await plan(b.id)).toMatchObject({ doDate: day(7), dueDate: day(6) })
    expect(viewNow().placements.get(b.uid)).toMatchObject({ day: day(6), planned: day(7) })
  })

  it('a fix handed a time of day still writes the day’s midnight', async () => {
    const task = await seed('Venue', { doDate: day(3), dueDate: day(1) })
    await applyPlannerFix('plan', task.id, { kind: 'move-date', date: 'due', to: day(3, 15) }, WINDOW)
    expect((await storedTask(task.id)).dueDate).toEqual(day(3))
  })

  it('Plan for that date’s day: a plan write, planned outright — its own date’s day is a plan like any other', async () => {
    const task = await seed('Venue', { doDate: day(3), dueDate: day(1) })
    const [, planFix] = fixes(task.id, 'due')
    expect(planFix).toEqual({ kind: 'plan', day: day(1) })
    const w = watchWrites()
    await applyPlannerFix('plan', task.id, planFix!, WINDOW)
    expect(w.setPlan).toHaveBeenCalledWith([task.id], { day: day(1) })
    expect(w.realDates()).toBe(0)
    expect(await plan(task.id)).toMatchObject({ doDate: day(1), unplanned: undefined, dueDate: day(1), modifiedAt: STAMP })
  })

  it('outside a Planner (the task layout’s Planned cell): the same fixes, a date moved out of view with no snackbar', async () => {
    const a = await seed('Plan back', { doDate: day(9), dueDate: day(6) })
    const b = await seed('Move on', { doDate: day(9), dueDate: day(6) })
    const w = watchWrites()
    await applyPlannerFix(null, a.id, { kind: 'plan', day: day(6) }, WINDOW)
    expect(w.setPlan).toHaveBeenLastCalledWith([a.id], { day: day(6) })
    await applyPlannerFix(null, b.id, { kind: 'move-date', date: 'due', to: day(9) }, WINDOW)
    expect(w.update).toHaveBeenLastCalledWith(b.id, { dueDate: day(9) })
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('Plan for the later of its two dates’ days keeps a plan there', async () => {
    // Due Sat, follow-up Mon, planned Wed: planning for the follow-up's day is not its natural day (the due date's).
    const task = await seed('Both', { doDate: day(5), dueDate: day(1), nextFollowupAt: day(3) })
    const [, planFix] = fixes(task.id, 'followup')
    expect(planFix).toEqual({ kind: 'plan', day: day(3) })
    await applyPlannerFix('plan', task.id, planFix!, WINDOW)
    expect(await plan(task.id)).toMatchObject({ doDate: day(3), dueDate: day(1), nextFollowupAt: day(3), modifiedAt: STAMP })
  })
})
