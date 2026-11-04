import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { droppedFields, makeSubtaskOf, makeSubtaskPrompt, makeTaskFromSubtask } from '../../services/subtask-convert'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore, type ConfirmPrompt } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { addDays, startOfToday } from '../../utils/date'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  // New tasks get no next follow-up here, so a bare task holds only its title.
  useSettingsStore.setState({ autoFollowup: false })
})

const todos = () => useTodoStore.getState().todos
const titles = (todoId: number) => (useSubtaskStore.getState().byTodo.get(todoId) ?? []).map((s) => [s.title, s.isCompleted])
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)

/** Answers the next confirmation with `answer`; returns the prompt asked. */
function answerNext(answer: boolean): { asked: () => ConfirmPrompt | undefined } {
  let seen: ConfirmPrompt | undefined
  const unsub = useUIStore.subscribe((s) => {
    const first = s.confirmPrompts[0]
    if (first && first !== seen) {
      seen = first
      s.answerConfirmation(answer)
    }
  })
  setTimeout(unsub, 0)
  return { asked: () => seen }
}

describe('droppedFields', () => {
  it('names everything a task holds beyond its title and done state', async () => {
    const id = await useTodoStore.getState().add('Book travel')
    const other = await useTodoStore.getState().add('Other')
    const lena = await usePersonStore.getState().getOrCreate('Lena Vogel')
    await usePersonStore.getState().assignPerson(id, lena)
    const ops = await useTagStore.getState().add('ops')
    const travel = await useTagStore.getState().add('travel')
    await useTagStore.getState().assignTag(id, ops)
    await useTagStore.getState().assignTag(id, travel)
    const statusId = await useStatusStore.getState().add('Waiting', '#888')
    await useTodoStore.getState().update(id, {
      dueDate: new Date(2026, 10, 20), recurrenceRule: { type: 'weekly' }, nextFollowupAt: new Date(2026, 10, 10),
      lastFollowupAt: new Date(2026, 10, 3), statusId, urgent: true, focus: true, notes: 'bring the deck',
    })
    await useStatusUpdateStore.getState().add(id, { date: startOfToday(), text: 'asked' })
    await useStatusUpdateStore.getState().add(id, { date: startOfToday(), text: 'asked again' })
    expect(droppedFields(id)).toEqual([
      'Due 11/20', 'Repeats', 'Next follow-up 11/10', 'Last follow-up 11/03', 'Lena Vogel', '2 tags', 'Status: Waiting',
      'Focus', 'Urgent', '2 status updates', 'Notes',
    ])
    expect(droppedFields(other)).toEqual([])
    expect(droppedFields(9999)).toEqual([])
    const prompt = makeSubtaskPrompt('Book travel', 'Offsite', ['Due 11/20'], 2)
    expect(prompt.title).toBe('Make “Book travel” a subtask of “Offsite”?')
    expect(prompt.message).toContain('These go with the task: Due 11/20.')
    expect(prompt.message).toContain('Its 2 subtasks move to “Offsite” too.')
    expect(prompt.confirmLabel).toBe('Make subtask')
  })
})

describe('makeSubtaskOf', () => {
  it('a title-only task converts without asking: it becomes the parent’s last subtask, done as it was, as one undo step', async () => {
    const parent = await useTodoStore.getState().add('Offsite')
    await useSubtaskStore.getState().add(parent, 'Pick a date')
    const task = await useTodoStore.getState().add('Book travel')
    await useTodoStore.getState().toggleComplete(task)
    useUndoStore.getState().clear()

    expect(await makeSubtaskOf(task, parent)).toBe(true)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(todos().map((t) => t.title)).toEqual(['Offsite'])
    expect(await db.todos.get(task)).toBeUndefined()
    expect(titles(parent)).toEqual([['Pick a date', false], ['Book travel', true]])
    expect(undoNames()).toEqual(['Made “Book travel” a subtask of “Offsite”'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Made “Book travel” a subtask of “Offsite”')

    await useUndoStore.getState().undo()
    expect((await db.todos.get(task))?.title).toBe('Book travel')
    expect(todos().find((t) => t.id === task)?.isCompleted).toBe(true)
    expect(titles(parent)).toEqual([['Pick a date', false]])
    await useUndoStore.getState().redo()
    expect(await db.todos.get(task)).toBeUndefined()
    expect(titles(parent)).toEqual([['Pick a date', false], ['Book travel', true]])
  })

  it('a task with more asks first, listing what goes; its own subtasks move to the parent; Undo brings everything back', async () => {
    const parent = await useTodoStore.getState().add('Offsite')
    const task = await useTodoStore.getState().add('Book travel')
    const lena = await usePersonStore.getState().getOrCreate('Lena')
    await usePersonStore.getState().assignPerson(task, lena)
    await useTodoStore.getState().update(task, { dueDate: new Date(2026, 10, 20), notes: 'window seat' })
    await useStatusUpdateStore.getState().add(task, { date: startOfToday(), text: 'quotes in' })
    await useSubtaskStore.getState().add(task, 'Flights')
    await useSubtaskStore.getState().add(task, 'Hotel')
    useUndoStore.getState().clear()

    const { asked } = answerNext(true)
    expect(await makeSubtaskOf(task, parent)).toBe(true)
    expect(asked()?.title).toBe('Make “Book travel” a subtask of “Offsite”?')
    expect(asked()?.message).toContain('Due 11/20 · Lena · 1 status update · Notes')
    expect(asked()?.message).toContain('Its 2 subtasks move to “Offsite” too.')
    expect(titles(parent)).toEqual([['Flights', false], ['Hotel', false], ['Book travel', false]])
    expect(await db.todos.get(task)).toBeUndefined()
    expect(await db.statusUpdates.where('todoId').equals(task).count()).toBe(0)
    expect(undoNames()).toHaveLength(1)

    await useUndoStore.getState().undo()
    expect((await db.todos.get(task))).toMatchObject({ title: 'Book travel', notes: 'window seat' })
    expect(titles(task)).toEqual([['Flights', false], ['Hotel', false]])
    expect(titles(parent)).toEqual([])
    expect((await db.statusUpdates.where('todoId').equals(task).toArray()).map((u) => u.text)).toEqual(['quotes in'])
    expect(usePersonStore.getState().assignedPeopleMap.get(task)?.map((p) => p.name)).toEqual(['Lena'])
  })

  it('Cancel in the prompt changes nothing; the task itself or a missing task is refused', async () => {
    const parent = await useTodoStore.getState().add('Offsite')
    const task = await useTodoStore.getState().add('Book travel')
    await useTodoStore.getState().update(task, { dueDate: new Date(2026, 10, 20) })
    useUndoStore.getState().clear()
    answerNext(false)
    expect(await makeSubtaskOf(task, parent)).toBe(false)
    expect((await db.todos.get(task))?.title).toBe('Book travel')
    expect(titles(parent)).toEqual([])
    expect(undoNames()).toEqual([])
    expect(await makeSubtaskOf(task, task)).toBe(false)
    expect(await makeSubtaskOf(9999, parent)).toBe(false)
    expect(await makeSubtaskOf(task, 9999)).toBe(false)
  })
})

describe('makeTaskFromSubtask', () => {
  it('a subtask becomes a task with its title and done state, the parent’s people and tags, the new-task defaults; one undo step takes it back', async () => {
    useSettingsStore.setState({ autoFollowup: true, followupDefaultInterval: { count: 2, unit: 'w' } })
    const parent = await useTodoStore.getState().add('Offsite')
    const lena = await usePersonStore.getState().getOrCreate('Lena')
    await usePersonStore.getState().assignPerson(parent, lena)
    const ops = await useTagStore.getState().add('ops')
    await useTagStore.getState().assignTag(parent, ops)
    const statusId = await useStatusStore.getState().add('To do', '#888')
    useSettingsStore.setState({ defaultStatusId: statusId })
    const a = await useSubtaskStore.getState().add(parent, 'Book the venue')
    const b = await useSubtaskStore.getState().add(parent, 'Send invites')
    await useSubtaskStore.getState().setDone(b!.id, true)
    useUndoStore.getState().clear()

    const id = await makeTaskFromSubtask(a!.id)
    expect(id).not.toBeNull()
    const made = todos().find((t) => t.id === id)!
    expect(made).toMatchObject({ title: 'Book the venue', isCompleted: false, statusId })
    expect(made.nextFollowupAt).toEqual(addDays(startOfToday(), 14))
    expect(usePersonStore.getState().assignedPeopleMap.get(id!)?.map((p) => p.name)).toEqual(['Lena'])
    expect(useTagStore.getState().assignedTagsMap.get(id!)?.map((t) => t.name)).toEqual(['ops'])
    expect(titles(parent)).toEqual([['Send invites', true]])
    expect(undoNames()).toEqual(['Made “Book the venue” a task'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Made “Book the venue” a task')

    // A done subtask makes a completed task, with no next follow-up.
    const done = await makeTaskFromSubtask(b!.id)
    const doneTask = todos().find((t) => t.id === done)!
    expect(doneTask.isCompleted).toBe(true)
    expect(doneTask.completedAt).toBeInstanceOf(Date)
    expect(doneTask.nextFollowupAt).toBeUndefined()
    expect(titles(parent)).toEqual([])

    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    expect(todos().map((t) => t.title)).toEqual(['Offsite'])
    expect(titles(parent)).toEqual([['Book the venue', false], ['Send invites', true]])
    expect(await db.todos.count()).toBe(1)
  })

  it('a missing subtask makes nothing', async () => {
    expect(await makeTaskFromSubtask(9999)).toBeNull()
    expect(undoNames()).toEqual([])
  })

  it('a failed create takes nothing and says so', async () => {
    const parent = await useTodoStore.getState().add('Offsite')
    const a = await useSubtaskStore.getState().add(parent, 'Book the venue')
    useUndoStore.getState().clear()
    const spy = vi.spyOn(useTodoStore.getState(), 'addMany').mockRejectedValueOnce(new Error('disk full'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await makeTaskFromSubtask(a!.id)).toBeNull()
    expect(titles(parent)).toEqual([['Book the venue', false]])
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn’t make “Book the venue” a task.')
    expect(undoNames()).toEqual([])
    spy.mockRestore()
    err.mockRestore()
  })
})
