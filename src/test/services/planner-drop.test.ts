import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import type { PersistedTodoItem } from '../../models'
import { createTab, PLANNER_ORDER_MAX, type PersistedWorkspaceLayout, type PlannerTab } from '../../models/workspace-layout'
import { applyPlannerMove, movePlannerTask, planPlannerDrop } from '../../services/planner-drop'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import type { PlannerDragPreview } from '../../stores/planner-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import type { PlannerTarget } from '../../utils/planner'
import { TASK_DRAG_KIND, TASK_DROP_KIND, dispatchTaskDrop, type PlannerDropData, type PlannerDropRequest } from '../../utils/task-dnd'
import { addTask } from '../add-task'
import { resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'
import { resetStores } from '../store-tracking'

/**
 * The Planner's one writer (`services/planner-drop`), on the real stores
 * and database: each decision of the drop rule is exactly one task write —
 * a follow-up moved (local midnight, stamped, one undo step) or a Do day
 * set or cleared (one undo step, no stamp) — or none; the due date is never
 * written; a drop into a group stores the hand order on the Planner's tab.
 * Driven as the page drives it: `dispatchTaskDrop` → the plan → the write.
 */

// Fri 20 Nov 2026, mid-morning.
const NOW = new Date(2026, 10, 20, 10, 30)
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = { today: TODAY, last: day(6) }
const STAMP = new Date(2026, 9, 1, 9, 0)
const T0 = new Date('2026-09-01T09:00:00.000Z')

const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n) })
const NO_DAY: PlannerTarget = { kind: 'noday' }
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

async function storedOrder(tabId = 'plan'): Promise<string[] | undefined> {
  await settleLayoutWrites()
  const layout = (await db.layouts.get(layoutId)) as PersistedWorkspaceLayout
  const tab = layout.cells.flatMap((c) => c.tabs).find((t) => t.id === tabId) as PlannerTab
  return tab.viewState?.order
}

/** Counts the task writes and the view-state writes a drop makes, without changing them. */
function watchWrites() {
  const update = vi.spyOn(useTodoStore.getState(), 'update')
  const setPlan = vi.spyOn(useTodoStore.getState(), 'setPlan')
  const bulkSetDeadline = vi.spyOn(useTodoStore.getState(), 'bulkSetDeadline')
  const patch = vi.spyOn(ws(), 'patchTabViewState')
  useTodoStore.setState({ update, setPlan, bulkSetDeadline })
  useWorkspaceStore.setState({ patchTabViewState: patch })
  return { update, setPlan, bulkSetDeadline, patch, tasks: () => update.mock.calls.length + setPlan.mock.calls.length }
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

describe('a drop on a day', () => {
  it('moves the follow-up of a row that is on its day by it: local midnight, stamped, one undo step — no Do day', async () => {
    const task = await seed('Chase', { nextFollowupAt: day(0, 12) })
    const w = watchWrites()
    await drop(task, tile(on(3)), null, { listTabId: 'plan', sectionKey: '2026-11-20', rowKey: `2026-11-20|${task.id}` })
    expect(w.update).toHaveBeenCalledTimes(1)
    expect(w.update).toHaveBeenCalledWith(task.id, { nextFollowupAt: day(3) })
    expect(w.setPlan).not.toHaveBeenCalled()
    const after = await storedTask(task.id)
    // The day, at local midnight — not the old time of day, not noon.
    expect(after.nextFollowupAt).toEqual(day(3))
    expect(after.doDate).toBeUndefined()
    expect(after.dueDate).toBeUndefined()
    expect(after.modifiedAt).toEqual(NOW)
    expect(steps()).toEqual(['Edit "Chase"'])

    await useUndoStore.getState().undo()
    const undone = await storedTask(task.id)
    expect(undone.nextFollowupAt).toEqual(day(0, 12))
    expect(undone.modifiedAt).toEqual(STAMP)
  })

  it('gives a row that is on its day by its due date a Do day: the due date kept, no stamp, one undo step', async () => {
    const task = await seed('Venue', { dueDate: day(2, 9) })
    const w = watchWrites()
    await drop(task, tile(on(4)))
    expect(w.setPlan).toHaveBeenCalledTimes(1)
    expect(w.setPlan).toHaveBeenCalledWith([task.id], { day: day(4) })
    expect(w.update).not.toHaveBeenCalled()
    expect(w.bulkSetDeadline).not.toHaveBeenCalled()
    const after = await storedTask(task.id)
    expect(after.doDate).toEqual(day(4))
    expect(after.dueDate).toEqual(day(2, 9))
    expect(after.modifiedAt).toEqual(STAMP)
    expect(steps()).toHaveLength(1)

    // Its undo takes the Do day away and leaves the stamp as it was.
    await useUndoStore.getState().undo()
    const undone = await storedTask(task.id)
    expect(undone.doDate).toBeUndefined()
    expect(undone.dueDate).toEqual(day(2, 9))
    expect(undone.modifiedAt).toEqual(STAMP)
    expect(useTodoStore.getState().todos.find((t) => t.id === task.id)?.modifiedAt).toEqual(STAMP)
  })

  it('gives a row with a Do day another one, whatever its dates', async () => {
    const task = await seed('Brief', { doDate: day(0), nextFollowupAt: day(1), dueDate: day(5) })
    const w = watchWrites()
    await drop(task, tile(on(2)))
    expect(w.tasks()).toBe(1)
    const after = await storedTask(task.id)
    expect(after.doDate).toEqual(day(2))
    expect(after.nextFollowupAt).toEqual(day(1))
    expect(after.dueDate).toEqual(day(5))
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

describe('a drop on Focus, no day', () => {
  it('clears a Do day, and only that', async () => {
    const task = await seed('Focus', { focus: true, doDate: day(1), dueDate: day(20) })
    const w = watchWrites()
    await drop(task, group(NO_DAY, 'none', [], ['x']))
    expect(w.setPlan).toHaveBeenCalledTimes(1)
    expect(w.setPlan).toHaveBeenCalledWith([task.id], null)
    expect(w.update).not.toHaveBeenCalled()
    const after = await storedTask(task.id)
    expect(after.doDate).toBeUndefined()
    expect(after.dueDate).toEqual(day(20))
    expect(after.modifiedAt).toEqual(STAMP)
  })

  it('refuses a row placed by a date: no write, no order, no undo step', async () => {
    const due = await seed('Due', { dueDate: day(2) })
    const chase = await seed('Chase', { nextFollowupAt: day(0), focus: true })
    const w = watchWrites()
    await drop(due, group(NO_DAY, 'none', ['f'], ['f', due.uid]), over('none', 0))
    await drop(chase, group(NO_DAY, 'none', ['f'], ['f', chase.uid]), over('none', 1))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
    expect(await storedOrder()).toBeUndefined()
    expect((await storedTask(due.id)).dueDate).toEqual(day(2))
    expect((await storedTask(chase.id)).nextFollowupAt).toEqual(day(0))
  })

  it('refuses a completed task anywhere', async () => {
    const done = await seed('Done', { isCompleted: true, completedAt: NOW, nextFollowupAt: day(0) })
    const w = watchWrites()
    await drop(done, tile(on(3)))
    await drop(done, group(NO_DAY, 'none', [], []), over('none', 0))
    expect(w.tasks()).toBe(0)
    expect(w.patch).not.toHaveBeenCalled()
  })
})

describe('rows from elsewhere', () => {
  it('a list’s row is taken by the same rule: its placement for the Planner’s window', async () => {
    const plain = await seed('Plain')
    const followup = await seed('Call', { nextFollowupAt: day(2) })
    const far = await seed('Far', { nextFollowupAt: day(30) })
    const w = watchWrites()
    const fromList = { listTabId: 'a-list', sectionKey: 'all', rowKey: 'all|1' }
    await drop(plain, tile(on(1)), null, fromList)
    await drop(followup, tile(on(0)), null, fromList)
    // A follow-up outside the window doesn't place the task: the day is a Do day, the follow-up stays.
    await drop(far, tile(on(3)), null, fromList)
    expect(w.tasks()).toBe(3)
    expect((await storedTask(plain.id)).doDate).toEqual(day(1))
    expect((await storedTask(followup.id)).nextFollowupAt).toEqual(day(0))
    expect((await storedTask(followup.id)).doDate).toBeUndefined()
    expect((await storedTask(far.id)).doDate).toEqual(day(3))
    expect((await storedTask(far.id)).nextFollowupAt).toEqual(day(30))
  })

  it('a calendar entry dropped on a Planner is the Planner’s drop, never the due date', async () => {
    const task = await seed('Entry', { dueDate: day(1) })
    const w = watchWrites()
    await drop(task, tile(on(3)), null, { calendarDateType: 'due' })
    expect(w.tasks()).toBe(1)
    expect((await storedTask(task.id)).dueDate).toEqual(day(1))
    expect((await storedTask(task.id)).doDate).toEqual(day(3))
  })

  it('the write is the task as stored, not the row as dragged', async () => {
    const task = await seed('Changed', { nextFollowupAt: day(0) })
    // Its follow-up was cleared while it was dragged: it is no longer on a day by it.
    await db.todos.update(task.id, { nextFollowupAt: undefined })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === task.id ? { ...t, nextFollowupAt: undefined } : t)) })
    await drop(task, tile(on(3)))
    expect((await storedTask(task.id)).doDate).toEqual(day(3))
    expect((await storedTask(task.id)).nextFollowupAt).toBeUndefined()
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

  it('a row dropped into another group: the day write and its place there, one of each', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const e = await seed('E', { doDate: day(3) })
    const shown = [a.uid, d.uid, e.uid]
    const w = watchWrites()
    await drop(a, group(on(3), '2026-11-23', [d.uid, e.uid], shown), over('2026-11-23', 1))
    expect(w.update).toHaveBeenCalledTimes(1)
    expect(w.setPlan).not.toHaveBeenCalled()
    expect(w.patch).toHaveBeenCalledTimes(1)
    expect((await storedTask(a.id)).nextFollowupAt).toEqual(day(3))
    expect(await storedOrder()).toEqual([d.uid, a.uid, e.uid])
  })

  it('is written before the task, in the drop’s own turn', async () => {
    const a = await seed('A', { nextFollowupAt: day(0) })
    const d = await seed('D', { dueDate: day(3) })
    const plan = planPlannerDrop(
      { todo: a, tabId: 'plan', target: on(3), window: WINDOW, group: { key: '2026-11-23', rows: [d.uid], shown: [a.uid, d.uid] } },
      over('2026-11-23', 0),
    )
    const written = applyPlannerMove('plan', a.id, plan!)
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

describe('Move to day › (no pointer)', () => {
  it('makes the same writes as a drop on the day, and never an order', async () => {
    const chase = await seed('Chase', { nextFollowupAt: day(0) })
    const venue = await seed('Venue', { dueDate: day(2) })
    const w = watchWrites()
    await movePlannerTask('plan', { todoId: chase.id, target: on(3), window: WINDOW })
    await movePlannerTask('plan', { todoId: venue.id, target: on(4), window: WINDOW })
    expect(w.update).toHaveBeenCalledTimes(1)
    expect(w.setPlan).toHaveBeenCalledTimes(1)
    expect(w.patch).not.toHaveBeenCalled()
    expect((await storedTask(chase.id)).nextFollowupAt).toEqual(day(3))
    expect((await storedTask(venue.id)).doDate).toEqual(day(4))
    expect((await storedTask(venue.id)).dueDate).toEqual(day(2))

    // No day: a Do day cleared; a row placed by a date left as it is.
    await movePlannerTask('plan', { todoId: venue.id, target: NO_DAY, window: WINDOW })
    expect((await storedTask(venue.id)).doDate).toBeUndefined()
    const before = w.tasks()
    await movePlannerTask('plan', { todoId: venue.id, target: NO_DAY, window: WINDOW })
    await movePlannerTask('plan', { todoId: chase.id, target: on(3), window: WINDOW })
    expect(w.tasks()).toBe(before)
  })
})
