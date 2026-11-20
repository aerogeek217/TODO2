import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data'
import { droppedFields } from '../../services/subtask-convert'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * A task's plan state in the Planner — a planned day (`doDate`, schema v85)
 * or held in Unplanned (`unplanned`, schema v86), never both: `setPlan` /
 * `setPlans` write both fields in the task's one write, as one undo step,
 * and planning is not an edit — the write, its undo and its redo leave
 * `modifiedAt` as it is, stored and in the store, log no history event and
 * touch no due date or follow-up. Completing a repeating task clears the
 * plan state on the next occurrence; Duplicate and Make subtask of… leave
 * it behind.
 */

const T0 = new Date(2026, 9, 1, 9, 0) // when the tasks were last touched
const NOW = new Date(2026, 10, 10, 12, 0)
const FRI = new Date(2026, 10, 13)
const MON = new Date(2026, 10, 16)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Tasks last modified at `T0`, stored and shown, with an empty undo stack. */
async function tasks(...titles: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const title of titles) ids.push(await addTask(title))
  for (const id of ids) await patch(id, { modifiedAt: T0 })
  useUndoStore.getState().clear()
  return ids
}

/** Writes fields to a task, stored and shown, with no undo step and no stamp. */
async function patch(id: number, fields: Record<string, unknown>): Promise<void> {
  await db.todos.update(id, fields)
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, ...fields } : t)) })
}

interface Planned {
  doDate: Date | undefined
  unplanned: true | undefined
  modifiedAt: Date | undefined
}

/** The task's plan fields and `modifiedAt` — stored and shown, which must agree; a field not set is not on the stored row. */
async function planned(id: number): Promise<Planned> {
  const stored = await db.todos.get(id)
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)
  expect(shown?.doDate?.getTime()).toBe(stored?.doDate?.getTime())
  expect(shown?.unplanned).toBe(stored?.unplanned)
  expect(shown?.modifiedAt.getTime()).toBe(stored?.modifiedAt.getTime())
  if (stored?.doDate === undefined) expect('doDate' in stored!).toBe(false)
  if (stored?.unplanned === undefined) expect('unplanned' in stored!).toBe(false)
  return { doDate: stored?.doDate, unplanned: stored?.unplanned, modifiedAt: stored?.modifiedAt }
}

const onDay = (day: Date): Planned => ({ doDate: day, unplanned: undefined, modifiedAt: T0 })
const HELD: Planned = { doDate: undefined, unplanned: true, modifiedAt: T0 }
const NO_PLAN: Planned = { doDate: undefined, unplanned: undefined, modifiedAt: T0 }

const later = (minutes: number) => { vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000)) }
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const eventCount = (todoId: number) => db.todoEvents.where('todoId').equals(todoId).count()
const store = () => useTodoStore.getState()

describe('setPlan', () => {
  it('plans a day at local midnight, stored and shown, as one quiet undo step', async () => {
    const [id] = await tasks('Quote') as [number]
    later(1)
    await store().setPlan([id], { day: new Date(2026, 10, 13, 15, 45) })
    expect(await planned(id)).toEqual(onDay(FRI))
    expect(undoNames()).toEqual(['Planned “Quote”'])
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('holds a task in Unplanned, and clears a plan, each named', async () => {
    const [id] = await tasks('Quote') as [number]
    await store().setPlan([id], 'unplanned')
    expect(await planned(id)).toEqual(HELD)
    await store().setPlan([id], null)
    expect(await planned(id)).toEqual(NO_PLAN)
    expect(undoNames()).toEqual(['Unplanned “Quote”', 'Cleared the plan of “Quote”'])
  })

  it('the two plan states are exclusive: both fields change in the task’s one write', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')

    await store().setPlan([id], 'unplanned')
    expect(await planned(id)).toEqual(HELD)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toEqual([{ todoId: id, changes: { doDate: undefined, unplanned: true } }])

    await store().setPlan([id], { day: MON })
    expect(await planned(id)).toEqual(onDay(MON))
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1]?.[0]).toEqual([{ todoId: id, changes: { doDate: MON, unplanned: undefined } }])
    expect(undoNames()).toHaveLength(2)
  })

  it('never stamps the task: not on the write, its undo or its redo — and the undo and redo put both fields back', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { unplanned: true })
    later(1)
    await store().setPlan([id], { day: FRI })
    expect(await planned(id)).toEqual(onDay(FRI))
    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(HELD)
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual(onDay(FRI))
    later(4)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(HELD)

    // From a planned day to held, and back.
    await patch(id, { doDate: MON, unplanned: undefined })
    useUndoStore.getState().clear()
    await store().setPlan([id], 'unplanned')
    expect(await planned(id)).toEqual(HELD)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(onDay(MON))
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual(HELD)
  })

  it('clears a plan with null; the undo puts the day back', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    later(1)
    await store().setPlan([id], null)
    expect(await planned(id)).toEqual(NO_PLAN)
    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(onDay(FRI))
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual(NO_PLAN)
  })

  it('moves several tasks in one step, named by their count; each gets its own plan back', async () => {
    const [a, b, c] = await tasks('A', 'B', 'C') as [number, number, number]
    await patch(a, { doDate: FRI })
    await patch(b, { unplanned: true })
    later(1)
    await store().setPlan([a, b], { day: MON })
    expect(undoNames()).toEqual(['Changed the plan of 2 tasks'])
    expect(await planned(a)).toEqual(onDay(MON))
    expect(await planned(b)).toEqual(onDay(MON))
    expect(await planned(c)).toEqual(NO_PLAN)
    await useUndoStore.getState().undo()
    expect(await planned(a)).toEqual(onDay(FRI))
    expect(await planned(b)).toEqual(HELD)
  })

  it('a task already in that state is not written: no step when nothing changes', async () => {
    const [a, b, c] = await tasks('A', 'B', 'C') as [number, number, number]
    await patch(a, { doDate: FRI })
    await patch(b, { unplanned: true })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')
    await store().setPlan([a], { day: new Date(2026, 10, 13, 8, 0) })
    await store().setPlan([b], 'unplanned')
    await store().setPlan([c], null)
    await store().setPlan([], { day: MON })
    await store().setPlans([])
    expect(write).not.toHaveBeenCalled()
    expect(undoNames()).toEqual([])
  })

  it('a task touched since keeps its newer stamp through the undo and the redo', async () => {
    const [id] = await tasks('Quote') as [number]
    await store().setPlan([id], { day: FRI })
    const touched = new Date(NOW.getTime() + 5 * 60_000)
    await patch(id, { modifiedAt: touched })
    later(6)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual({ ...NO_PLAN, modifiedAt: touched })
    later(7)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual({ ...onDay(FRI), modifiedAt: touched })
  })

  it('logs no history event: not on a plan, a move, a hold, a clear, an undo or a redo', async () => {
    const [id] = await tasks('Quote') as [number]
    const before = await eventCount(id)
    await store().setPlan([id], { day: FRI })
    await store().setPlan([id], { day: MON })
    await store().setPlan([id], 'unplanned')
    await store().setPlan([id], null)
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    await useUndoStore.getState().redo()
    expect(await eventCount(id)).toBe(before)
  })

  it('writes no due date and no follow-up', async () => {
    const [id] = await tasks('Quote') as [number]
    const due = new Date(2026, 10, 12)
    const followup = new Date(2026, 10, 11)
    await patch(id, { dueDate: due, nextFollowupAt: followup })
    await store().setPlan([id], { day: MON })
    await store().setPlan([id], 'unplanned')
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toMatchObject({ dueDate: due, nextFollowupAt: followup, doDate: MON })
  })

  it('a failed write puts the plan back and adds no step', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await expect(store().setPlan([id], 'unplanned')).rejects.toThrow('disk full')
    expect(await planned(id)).toEqual(onDay(FRI))
    expect(undoNames()).toEqual([])
  })

  it('an edit of another field leaves the plan alone (and stamps, as ever)', async () => {
    const [id] = await tasks('Quote') as [number]
    await store().setPlan([id], { day: FRI })
    later(1)
    await store().update(id, { title: 'Quote v2' })
    const after = await planned(id)
    expect(after.doDate).toEqual(FRI)
    expect(after.modifiedAt).toEqual(new Date(NOW.getTime() + 60_000))
  })
})

describe('setPlans', () => {
  it('gives each task its own plan in one write and one undo step, named by the caller', async () => {
    const [a, b, c, d] = await tasks('A', 'B', 'C', 'D') as [number, number, number, number]
    await patch(a, { doDate: FRI })
    await patch(b, { doDate: FRI })
    await patch(c, { unplanned: true })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')
    later(1)
    await store().setPlans([
      { id: a, plan: 'unplanned' },
      { id: b, plan: null },
      { id: c, plan: { day: MON } },
      { id: d, plan: null }, // no plan already: not written
    ], 'Unplanned 2 delayed tasks')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0].map((m) => m.todoId)).toEqual([a, b, c])
    expect(undoNames()).toEqual(['Unplanned 2 delayed tasks'])
    expect(await planned(a)).toEqual(HELD)
    expect(await planned(b)).toEqual(NO_PLAN)
    expect(await planned(c)).toEqual(onDay(MON))
    expect(await planned(d)).toEqual(NO_PLAN)

    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(a)).toEqual(onDay(FRI))
    expect(await planned(b)).toEqual(onDay(FRI))
    expect(await planned(c)).toEqual(HELD)
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(a)).toEqual(HELD)
    expect(await planned(b)).toEqual(NO_PLAN)
    expect(await planned(c)).toEqual(onDay(MON))
    expect(undoNames()).toEqual(['Unplanned 2 delayed tasks'])
  })

  it('one task without a description is named by its plan', async () => {
    const [a] = await tasks('A') as [number]
    await store().setPlans([{ id: a, plan: 'unplanned' }])
    expect(undoNames()).toEqual(['Unplanned “A”'])
  })
})

describe('completing a repeating task clears the plan state of the next occurrence', () => {
  const DUE = new Date(2026, 10, 12)
  const NEXT_DUE = new Date(2026, 10, 19)
  const weekly = { dueDate: DUE, recurrenceRule: { every: { count: 1, unit: 'w' as const } } }

  /** The task's due date and plan fields, stored and shown. */
  async function occurrence(id: number) {
    const { doDate, unplanned } = await planned(id)
    const stored = await db.todos.get(id)
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate?.getTime()).toBe(stored?.dueDate?.getTime())
    return { dueDate: stored?.dueDate, doDate, unplanned, isCompleted: stored?.isCompleted }
  }
  const next = { dueDate: NEXT_DUE, doDate: undefined, unplanned: undefined, isCompleted: false }

  it('its checkbox: the planned day goes with the advance, the undo puts it back, the redo clears it again', async () => {
    const [id] = await tasks('Weekly report') as [number]
    await patch(id, { ...weekly, doDate: FRI })
    later(1)
    await store().toggleComplete(id)
    expect(await occurrence(id)).toEqual(next)
    later(2)
    await useUndoStore.getState().undo()
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: FRI, unplanned: undefined, isCompleted: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await occurrence(id)).toEqual(next)
    expect(undoNames()).toEqual(['Advance recurring "Weekly report"'])
  })

  it('its checkbox: a task held in Unplanned is no longer held, the undo holds it again, the redo lets it go', async () => {
    const [id] = await tasks('Weekly report') as [number]
    await patch(id, { ...weekly, unplanned: true })
    later(1)
    await store().toggleComplete(id)
    expect(await occurrence(id)).toEqual(next)
    later(2)
    await useUndoStore.getState().undo()
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: undefined, unplanned: true, isCompleted: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await occurrence(id)).toEqual(next)
  })

  it('its checkbox, the write failing: the plan stays', async () => {
    const [planned1, held] = await tasks('Weekly report', 'Weekly sync') as [number, number]
    await patch(planned1, { ...weekly, doDate: FRI })
    await patch(held, { ...weekly, unplanned: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full'))
    await expect(store().toggleComplete(planned1)).rejects.toThrow('disk full')
    await expect(store().toggleComplete(held)).rejects.toThrow('disk full')
    expect(await occurrence(planned1)).toEqual({ dueDate: DUE, doDate: FRI, unplanned: undefined, isCompleted: false })
    expect(await occurrence(held)).toEqual({ dueDate: DUE, doDate: undefined, unplanned: true, isCompleted: false })
  })

  it('a bulk completion (the bulk bar, a check-in reply): the repeating tasks’ plans go, a plain task keeps its own; the undo and redo follow', async () => {
    const [repeating, plain, bare, held] = await tasks('Weekly report', 'Send the quote', 'Weekly sync', 'Weekly call') as [number, number, number, number]
    await patch(repeating, { ...weekly, doDate: FRI })
    await patch(plain, { doDate: MON })
    await patch(bare, weekly)
    await patch(held, { ...weekly, unplanned: true })
    later(1)
    await store().bulkSetCompleted([repeating, plain, bare, held], true)
    expect(await occurrence(repeating)).toEqual(next)
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, unplanned: undefined, isCompleted: true })
    expect(await occurrence(bare)).toEqual(next)
    expect(await occurrence(held)).toEqual(next)
    later(2)
    await useUndoStore.getState().undo()
    expect(await occurrence(repeating)).toEqual({ dueDate: DUE, doDate: FRI, unplanned: undefined, isCompleted: false })
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, unplanned: undefined, isCompleted: false })
    expect(await occurrence(bare)).toEqual({ dueDate: DUE, doDate: undefined, unplanned: undefined, isCompleted: false })
    expect(await occurrence(held)).toEqual({ dueDate: DUE, doDate: undefined, unplanned: true, isCompleted: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await occurrence(repeating)).toEqual(next)
    expect(await occurrence(held)).toEqual(next)
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, unplanned: undefined, isCompleted: true })
  })

  it('a bulk completion, the write failing: the plan stays', async () => {
    const [id, held] = await tasks('Weekly report', 'Weekly call') as [number, number]
    await patch(id, { ...weekly, doDate: FRI })
    await patch(held, { ...weekly, unplanned: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    // The rollback's own doing: the reload after it would mask a miss.
    vi.spyOn(useTodoStore.getState(), 'loadAll').mockResolvedValue()
    await expect(store().bulkSetCompleted([id, held], true)).rejects.toThrow('disk full')
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: FRI, unplanned: undefined, isCompleted: false })
    expect(await occurrence(held)).toEqual({ dueDate: DUE, doDate: undefined, unplanned: true, isCompleted: false })
  })

  it('a plain task completed by its checkbox keeps its plan', async () => {
    const [a, b] = await tasks('Send the quote', 'Call back') as [number, number]
    await patch(a, { doDate: FRI })
    await patch(b, { unplanned: true })
    await store().toggleComplete(a)
    await store().toggleComplete(b)
    expect(await occurrence(a)).toMatchObject({ doDate: FRI, isCompleted: true })
    expect(await occurrence(b)).toMatchObject({ unplanned: true, isCompleted: true })
  })
})

describe('what leaves the plan state behind', () => {
  it('Duplicate: the copy is neither planned nor held', async () => {
    const [a, b] = await tasks('Quote', 'Call') as [number, number]
    await patch(a, { doDate: FRI, dueDate: MON, notes: 'n' })
    await patch(b, { unplanned: true, nextFollowupAt: MON })
    for (const [id, title] of [[a, 'Quote'], [b, 'Call']] as const) {
      const copy = await store().duplicate(id)
      expect(copy).toBeDefined()
      const stored = await db.todos.get(copy!)
      expect(stored).toMatchObject({ title })
      expect('doDate' in stored!).toBe(false)
      expect('unplanned' in stored!).toBe(false)
      const shown = useTodoStore.getState().todos.find((t) => t.id === copy)
      expect(shown?.doDate).toBeUndefined()
      expect(shown?.unplanned).toBeUndefined()
    }
    expect((await planned(a)).doDate).toEqual(FRI)
    expect((await planned(b)).unplanned).toBe(true)
  })

  it('Make subtask of…: it goes with the task unnamed — a task holding only its title and a plan state asks nothing', async () => {
    const [a, b] = await tasks('Quote', 'Call') as [number, number]
    await patch(a, { doDate: FRI, nextFollowupAt: undefined, statusId: undefined })
    await patch(b, { unplanned: true, nextFollowupAt: undefined, statusId: undefined })
    expect(droppedFields(a)).toEqual([])
    expect(droppedFields(b)).toEqual([])
  })
})
