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
 * or none (schema v89): `setPlan` / `setPlans` write only `doDate`, in the
 * task's one write, as one undo step, and planning is not an edit — the
 * write, its undo and its redo leave `modifiedAt` as it is, stored and in
 * the store, log no history event and touch no due date or follow-up.
 * Completing a repeating task clears the planned day of the next
 * occurrence; Duplicate and Make subtask of… leave it behind.
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
  modifiedAt: Date | undefined
}

/**
 * The task's planned day and `modifiedAt` — stored and shown, which must
 * agree; no planned day is no `doDate` on the stored row, and no write puts
 * an `unplanned` there.
 */
async function planned(id: number): Promise<Planned> {
  const stored = await db.todos.get(id)
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)
  expect(shown?.doDate?.getTime()).toBe(stored?.doDate?.getTime())
  expect(shown?.modifiedAt.getTime()).toBe(stored?.modifiedAt.getTime())
  if (stored?.doDate === undefined) expect('doDate' in stored!).toBe(false)
  expect('unplanned' in stored!).toBe(false)
  return { doDate: stored?.doDate, modifiedAt: stored?.modifiedAt }
}

const onDay = (day: Date): Planned => ({ doDate: day, modifiedAt: T0 })
const NO_PLAN: Planned = { doDate: undefined, modifiedAt: T0 }

const later = (minutes: number) => { vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000)) }
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const eventCount = (todoId: number) => db.todoEvents.where('todoId').equals(todoId).count()
const store = () => useTodoStore.getState()
/** The task as the store shows it now. */
const shown = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!

describe('setPlan', () => {
  it('plans a day at local midnight, stored and shown, as one quiet undo step', async () => {
    const [id] = await tasks('Quote') as [number]
    later(1)
    await store().setPlan([id], { day: new Date(2026, 10, 13, 15, 45) })
    expect(await planned(id)).toEqual(onDay(FRI))
    expect(undoNames()).toEqual(['Planned “Quote”'])
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('clears a plan with null, named', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    await store().setPlan([id], null)
    expect(await planned(id)).toEqual(NO_PLAN)
    expect(undoNames()).toEqual(['Cleared the plan of “Quote”'])
  })

  it('writes only the planned day, in the task’s one write', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')

    await store().setPlan([id], { day: MON })
    expect(await planned(id)).toEqual(onDay(MON))
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toEqual([{ todoId: id, changes: { doDate: MON } }])
    expect(Object.keys(write.mock.calls[0]?.[0][0]?.changes ?? {})).toEqual(['doDate'])

    await store().setPlan([id], null)
    expect(await planned(id)).toEqual(NO_PLAN)
    expect(write).toHaveBeenCalledTimes(2)
    expect(Object.keys(write.mock.calls[1]?.[0][0]?.changes ?? {})).toEqual(['doDate'])
    expect(write.mock.calls[1]?.[0][0]?.changes.doDate).toBeUndefined()
    expect(undoNames()).toHaveLength(2)
  })

  it('never stamps the task: not on the write, its undo or its redo — and the undo and redo put the day back', async () => {
    const [id] = await tasks('Quote') as [number]
    later(1)
    await store().setPlan([id], { day: FRI })
    expect(await planned(id)).toEqual(onDay(FRI))
    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(NO_PLAN)
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual(onDay(FRI))
    later(4)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(NO_PLAN)

    // From one planned day to another, and back.
    await patch(id, { doDate: MON })
    useUndoStore.getState().clear()
    await store().setPlan([id], { day: FRI })
    expect(await planned(id)).toEqual(onDay(FRI))
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual(onDay(MON))
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual(onDay(FRI))
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
    later(1)
    await store().setPlan([a, b], { day: MON })
    expect(undoNames()).toEqual(['Changed the plan of 2 tasks'])
    expect(await planned(a)).toEqual(onDay(MON))
    expect(await planned(b)).toEqual(onDay(MON))
    expect(await planned(c)).toEqual(NO_PLAN)
    await useUndoStore.getState().undo()
    expect(await planned(a)).toEqual(onDay(FRI))
    expect(await planned(b)).toEqual(NO_PLAN)
  })

  it('a task already in that state is not written: no step when nothing changes', async () => {
    const [a, c] = await tasks('A', 'C') as [number, number]
    await patch(a, { doDate: FRI })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')
    await store().setPlan([a], { day: new Date(2026, 10, 13, 8, 0) })
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

  it('logs no history event: not on a plan, a move, a clear, an undo or a redo', async () => {
    const [id] = await tasks('Quote') as [number]
    const before = await eventCount(id)
    await store().setPlan([id], { day: FRI })
    await store().setPlan([id], { day: MON })
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
    await store().setPlan([id], null)
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toMatchObject({ dueDate: due, nextFollowupAt: followup, doDate: MON })
  })

  it('a failed write puts the plan back, adds no step, and says so — it never rejects', async () => {
    const [id, other] = await tasks('Quote', 'Brief') as [number, number]
    await patch(id, { doDate: FRI })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await expect(store().setPlan([id], null)).resolves.toBe(false)
    expect(await planned(id)).toEqual(onDay(FRI))
    expect(undoNames()).toEqual([])
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't save the plan of “Quote”.", notice: true })
    // Several tasks: counted. A write that goes through resolves true.
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await expect(store().setPlan([id, other], { day: MON })).resolves.toBe(false)
    expect(useUndoStore.getState().snackbar?.description).toBe("Couldn't save the plan of 2 tasks.")
    expect(await planned(id)).toEqual(onDay(FRI))
    await expect(store().setPlan([id], { day: MON })).resolves.toBe(true)
    await expect(store().setPlans([])).resolves.toBe(true)
  })

  it('a failed write takes back only a day the task still holds from it: a plan made meanwhile stays', async () => {
    const [id] = await tasks('Quote') as [number]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The first write hangs, then fails; the second goes through meanwhile.
    let fail: (e: Error) => void = () => {}
    vi.spyOn(todoRepository, 'bulkUpdate').mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject }))
    const first = store().setPlan([id], { day: FRI })
    await expect(store().setPlan([id], { day: MON })).resolves.toBe(true)
    expect(shown(id).doDate).toEqual(MON)
    fail(new Error('disk full'))
    await expect(first).resolves.toBe(false)
    // The task holds the second's day, not the first's: nothing taken back.
    expect(await planned(id)).toEqual(onDay(MON))
    expect(undoNames()).toEqual(['Planned “Quote”'])
  })

  it('two overlapping failed writes leave the plan as stored: the tasks are read back from the database', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Both writes hang, then fail — the first one first.
    const fails: Array<(e: Error) => void> = []
    vi.spyOn(todoRepository, 'bulkUpdate').mockImplementation(() => new Promise<void>((_, reject) => { fails.push(reject) }))
    const first = store().setPlan([id], { day: MON })
    const second = store().setPlan([id], null)
    // Shown meanwhile: the second's plan.
    expect(shown(id).doDate).toBeUndefined()
    await vi.waitFor(() => expect(fails).toHaveLength(2))
    fails[0]!(new Error('disk full'))
    fails[1]!(new Error('disk full'))
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
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
    const write = vi.spyOn(todoRepository, 'bulkUpdate')
    later(1)
    await store().setPlans([
      { id: a, plan: { day: MON } },
      { id: b, plan: null },
      { id: c, plan: { day: FRI } },
      { id: d, plan: null }, // no plan already: not written
    ], 'Changed 3 plans')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0].map((m) => m.todoId)).toEqual([a, b, c])
    expect(undoNames()).toEqual(['Changed 3 plans'])
    expect(await planned(a)).toEqual(onDay(MON))
    expect(await planned(b)).toEqual(NO_PLAN)
    expect(await planned(c)).toEqual(onDay(FRI))
    expect(await planned(d)).toEqual(NO_PLAN)

    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(a)).toEqual(onDay(FRI))
    expect(await planned(b)).toEqual(onDay(FRI))
    expect(await planned(c)).toEqual(NO_PLAN)
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(a)).toEqual(onDay(MON))
    expect(await planned(b)).toEqual(NO_PLAN)
    expect(await planned(c)).toEqual(onDay(FRI))
    expect(undoNames()).toEqual(['Changed 3 plans'])
  })

  it('one task without a description is named by its plan', async () => {
    const [a] = await tasks('A') as [number]
    await store().setPlans([{ id: a, plan: { day: MON } }])
    await store().setPlans([{ id: a, plan: null }])
    expect(undoNames()).toEqual(['Planned “A”', 'Cleared the plan of “A”'])
  })
})

describe('completing a repeating task clears the planned day of the next occurrence', () => {
  const DUE = new Date(2026, 10, 12)
  const NEXT_DUE = new Date(2026, 10, 19)
  const weekly = { dueDate: DUE, recurrenceRule: { every: { count: 1, unit: 'w' as const } } }

  /** The task's due date and planned day, stored and shown. */
  async function occurrence(id: number) {
    const { doDate } = await planned(id)
    const stored = await db.todos.get(id)
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.dueDate?.getTime()).toBe(stored?.dueDate?.getTime())
    return { dueDate: stored?.dueDate, doDate, isCompleted: stored?.isCompleted }
  }
  const next = { dueDate: NEXT_DUE, doDate: undefined, isCompleted: false }

  it('its checkbox: the planned day goes with the advance, the undo puts it back, the redo clears it again', async () => {
    const [id] = await tasks('Weekly report') as [number]
    await patch(id, { ...weekly, doDate: FRI })
    later(1)
    await store().toggleComplete(id)
    expect(await occurrence(id)).toEqual(next)
    later(2)
    await useUndoStore.getState().undo()
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: FRI, isCompleted: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await occurrence(id)).toEqual(next)
    expect(undoNames()).toEqual(['Advance recurring "Weekly report"'])
  })

  it('its checkbox, the write failing: the plan stays', async () => {
    const [id] = await tasks('Weekly report') as [number]
    await patch(id, { ...weekly, doDate: FRI })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await expect(store().toggleComplete(id)).rejects.toThrow('disk full')
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: FRI, isCompleted: false })
  })

  it('a bulk completion (the bulk bar, a check-in reply): the repeating tasks’ plans go, a plain task keeps its own; the undo and redo follow', async () => {
    const [repeating, plain, bare] = await tasks('Weekly report', 'Send the quote', 'Weekly sync') as [number, number, number]
    await patch(repeating, { ...weekly, doDate: FRI })
    await patch(plain, { doDate: MON })
    await patch(bare, weekly)
    later(1)
    await store().bulkSetCompleted([repeating, plain, bare], true)
    expect(await occurrence(repeating)).toEqual(next)
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, isCompleted: true })
    expect(await occurrence(bare)).toEqual(next)
    later(2)
    await useUndoStore.getState().undo()
    expect(await occurrence(repeating)).toEqual({ dueDate: DUE, doDate: FRI, isCompleted: false })
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, isCompleted: false })
    expect(await occurrence(bare)).toEqual({ dueDate: DUE, doDate: undefined, isCompleted: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await occurrence(repeating)).toEqual(next)
    expect(await occurrence(plain)).toEqual({ dueDate: undefined, doDate: MON, isCompleted: true })
  })

  it('a bulk completion, the write failing: the plan stays', async () => {
    const [id, other] = await tasks('Weekly report', 'Weekly call') as [number, number]
    await patch(id, { ...weekly, doDate: FRI })
    await patch(other, { ...weekly, doDate: MON })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    // The rollback's own doing: the reload after it would mask a miss.
    vi.spyOn(useTodoStore.getState(), 'loadAll').mockResolvedValue()
    await expect(store().bulkSetCompleted([id, other], true)).rejects.toThrow('disk full')
    expect(await occurrence(id)).toEqual({ dueDate: DUE, doDate: FRI, isCompleted: false })
    expect(await occurrence(other)).toEqual({ dueDate: DUE, doDate: MON, isCompleted: false })
  })

  it('a plain task completed by its checkbox keeps its plan', async () => {
    const [a] = await tasks('Send the quote') as [number]
    await patch(a, { doDate: FRI })
    await store().toggleComplete(a)
    expect(await occurrence(a)).toMatchObject({ doDate: FRI, isCompleted: true })
  })
})

describe('what leaves the plan state behind', () => {
  it('Duplicate: the copy is not planned', async () => {
    const [a] = await tasks('Quote') as [number]
    await patch(a, { doDate: FRI, dueDate: MON, notes: 'n' })
    const copy = await store().duplicate(a)
    expect(copy).toBeDefined()
    const stored = await db.todos.get(copy!)
    expect(stored).toMatchObject({ title: 'Quote' })
    expect('doDate' in stored!).toBe(false)
    expect(useTodoStore.getState().todos.find((t) => t.id === copy)?.doDate).toBeUndefined()
    expect((await planned(a)).doDate).toEqual(FRI)
  })

  it('Make subtask of…: it goes with the task unnamed — a task holding only its title and a planned day asks nothing', async () => {
    const [a] = await tasks('Quote') as [number]
    await patch(a, { doDate: FRI, nextFollowupAt: undefined, statusId: undefined })
    expect(droppedFields(a)).toEqual([])
  })
})
