import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { planClearUrgent, clearUrgent, setUrgent } from '../../services/clear-urgent'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { db } from '../../data/database'

// Sat 10 Oct 2026; range 3 days.
const today = new Date(2026, 9, 10, 9)
const day = (offset: number) => new Date(2026, 9, 10 + offset)
const t = (title: string, patch: { urgent?: boolean; dueDate?: Date; isCompleted?: boolean } = {}) =>
  ({ title, isCompleted: false, ...patch })

describe('planClearUrgent — the case table', () => {
  it('one task, not flagged, urgent only by date: nothing clears; asks to remove the date', () => {
    const task = t('Pick up prescriptions', { dueDate: day(3) })
    const plan = planClearUrgent([task], today, 3)
    expect(plan.clearFlag).toEqual([])
    expect(plan.dueSoon).toEqual([task])
    expect(plan.prompt).toEqual({
      title: 'Remove the due date?',
      message: 'Pick up prescriptions is due Tue 13, within 3 days, so it counts as urgent. Removing the due date makes it not urgent.',
      confirmLabel: 'Remove due date',
      cancelLabel: 'Cancel',
    })
  })

  it('words today and overdue dates', () => {
    expect(planClearUrgent([t('A', { dueDate: day(0) })], today, 3).prompt!.message)
      .toBe('A is due today, so it counts as urgent. Removing the due date makes it not urgent.')
    expect(planClearUrgent([t('A', { dueDate: day(-2) })], today, 3).prompt!.message)
      .toBe('A is overdue (due Thu 8), so it counts as urgent. Removing the due date makes it not urgent.')
    expect(planClearUrgent([t('A', { dueDate: day(1) })], today, 1).prompt!.message)
      .toBe('A is due Sun 11, within 1 day, so it counts as urgent. Removing the due date makes it not urgent.')
  })

  it('one task, flagged and due within the range: the flag clears; "Still urgent" offers Keep / Remove', () => {
    const task = t('Headcount request', { urgent: true, dueDate: day(0) })
    const plan = planClearUrgent([task], today, 3)
    expect(plan.clearFlag).toEqual([task])
    expect(plan.dueSoon).toEqual([task])
    expect(plan.prompt).toEqual({
      title: 'Still urgent: due today',
      message: 'Headcount request is no longer flagged urgent, but it’s due today, so it still counts as urgent.',
      confirmLabel: 'Remove due date',
      cancelLabel: 'Keep due date',
    })
    expect(planClearUrgent([t('B', { urgent: true, dueDate: day(2) })], today, 3).prompt!.title).toBe('Still urgent: due Mon 12')
    const overdue = planClearUrgent([t('C', { urgent: true, dueDate: day(-1) })], today, 3).prompt!
    expect(overdue.title).toBe('Still urgent: overdue')
    expect(overdue.message).toBe('C is no longer flagged urgent, but it’s overdue (Fri 9), so it still counts as urgent.')
  })

  it('one task, flagged, due outside the range or never: the flag clears, no prompt', () => {
    for (const task of [t('A', { urgent: true, dueDate: day(4) }), t('B', { urgent: true })]) {
      const plan = planClearUrgent([task], today, 3)
      expect(plan.clearFlag).toEqual([task])
      expect(plan.prompt).toBeNull()
    }
  })

  it('one task, not urgent at all: nothing happens', () => {
    expect(planClearUrgent([t('A', { dueDate: day(9) })], today, 3)).toEqual({ clearFlag: [], dueSoon: [], prompt: null })
  })

  it('range off: clearing the flag is enough', () => {
    const plan = planClearUrgent([t('A', { urgent: true, dueDate: day(0) })], today, null)
    expect(plan.clearFlag).toHaveLength(1)
    expect(plan.prompt).toBeNull()
  })

  it('completed tasks are never urgent by date (no prompt for them)', () => {
    expect(planClearUrgent([t('A', { urgent: true, dueDate: day(-1), isCompleted: true })], today, 3).prompt).toBeNull()
  })

  it('several tasks: flags clear first; one prompt counts the ones still urgent by date', () => {
    const tasks = [
      t('flag, due soon', { urgent: true, dueDate: day(1) }),
      t('date only', { dueDate: day(-1) }),
      t('flag, no date', { urgent: true }),
      t('flag, later', { urgent: true, dueDate: day(10) }),
      t('not urgent'),
    ]
    const plan = planClearUrgent(tasks, today, 3)
    expect(plan.clearFlag.map((x) => x.title)).toEqual(['flag, due soon', 'flag, no date', 'flag, later'])
    expect(plan.dueSoon.map((x) => x.title)).toEqual(['flag, due soon', 'date only'])
    expect(plan.prompt).toEqual({
      title: 'Still urgent: due soon',
      message: '2 of 5 tasks stay urgent because of their due dates.',
      confirmLabel: 'Remove their due dates',
      cancelLabel: 'Keep due dates',
    })
    const one = planClearUrgent([tasks[0]!, tasks[2]!], today, 3).prompt!
    expect(one.message).toBe('1 of 2 tasks stays urgent because of its due date.')
    expect([one.confirmLabel, one.cancelLabel]).toEqual(['Remove its due date', 'Keep due date'])
    expect(planClearUrgent([tasks[2]!, tasks[3]!], today, 3).prompt).toBeNull()
  })
})

describe('clearUrgent / setUrgent on stored tasks', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: today, toFake: ['Date'] })
    await db.delete()
    await db.open()
    useTodoStore.setState(useTodoStore.getInitialState(), true)
    useUndoStore.setState(useUndoStore.getInitialState(), true)
    useUIStore.setState({ bulkConfirmation: null, selectedTodoIds: new Set() })
    useSettingsStore.setState({ urgentDueWithinDays: 3 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function addTask(title: string, patch: { urgent?: boolean; dueDate?: Date }) {
    const id = await useTodoStore.getState().add(title)
    const todo = useTodoStore.getState().todos.find((x) => x.id === id)!
    await useTodoStore.getState().update(todo.id, patch)
    return id
  }
  const mem = (id: number) => useTodoStore.getState().todos.find((x) => x.id === id)!

  it('flagged + due soon: clears the flag (undoable), asks, and Remove due date removes it as its own step', async () => {
    const id = await addTask('Headcount request', { urgent: true, dueDate: day(0) })
    await clearUrgent([id])
    expect(mem(id).urgent).toBeUndefined()
    const prompt = useUIStore.getState().bulkConfirmation!
    expect(prompt).toMatchObject({ action: 'custom', ids: [id], title: 'Still urgent: due today', cancelLabel: 'Keep due date' })

    prompt.onConfirm!()
    await vi.waitFor(() => expect(mem(id).dueDate).toBeUndefined())
    expect('dueDate' in (await db.todos.get(id))!).toBe(false)

    // Two undo steps: the due date, then the flag.
    await useUndoStore.getState().undo()
    expect(mem(id).dueDate).toEqual(day(0))
    expect(mem(id).urgent).toBeUndefined()
    await useUndoStore.getState().undo()
    expect(mem(id).urgent).toBe(true)
  })

  it('urgent only by date: nothing changes unless the date is removed', async () => {
    const id = await addTask('Pick up prescriptions', { dueDate: day(2) })
    const before = useUndoStore.getState().undoStack.length
    await clearUrgent([id])
    expect(useUndoStore.getState().undoStack.length).toBe(before)
    expect(useUIStore.getState().bulkConfirmation?.title).toBe('Remove the due date?')
    expect(mem(id).dueDate).toEqual(day(2))
  })

  it('flagged without a date: just clears, no prompt', async () => {
    const id = await addTask('Review analytics', { urgent: true })
    await clearUrgent([id])
    expect(mem(id).urgent).toBeUndefined()
    expect(useUIStore.getState().bulkConfirmation).toBeNull()
  })

  it('setUrgent(on) flags every task; setUrgent(off) runs the clearing path for all', async () => {
    const a = await addTask('A', {})
    const b = await addTask('B', { dueDate: day(1) })
    await setUrgent([a, b], true)
    expect([mem(a).urgent, mem(b).urgent]).toEqual([true, true])
    await setUrgent([a, b], false)
    expect([mem(a).urgent, mem(b).urgent]).toEqual([undefined, undefined])
    expect(useUIStore.getState().bulkConfirmation).toMatchObject({ ids: [b], message: '1 of 2 tasks stays urgent because of its due date.' })
  })
})
