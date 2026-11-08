import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { removePeopleAndTags } from '../../services/remove-entities'
import { makeTaskFromSubtask } from '../../services/subtask-convert'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import type { TodoEvent } from '../../models'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * The history log H3 through the stores (D26 P7): the row pickers, the
 * editor and the bulk bar write people, tags, markers and follow-ups
 * through these, and each undo / redo logs the reversing change.
 */

const typed = async (todoId: number, ...types: TodoEvent['type'][]) =>
  (await db.todoEvents.where('todoId').equals(todoId).sortBy('id'))
    .filter((e) => types.includes(e.type))
    .map((e) => [e.type, e.fromValue, e.toValue])

let ann = 0
let ops = 0

beforeEach(async () => {
  await resetDb()
  resetStores()
  useSettingsStore.setState({ autoFollowup: false })
  ann = await usePersonStore.getState().add('Ann', 'AN')
  ops = await useTagStore.getState().add('ops')
})

const undo = () => useUndoStore.getState().undo()
const redo = () => useUndoStore.getState().redo()

describe('undo / redo log the reversing change', () => {
  it('a person assigned (a row’s picker, the editor)', async () => {
    const id = await addTask('Quote')
    await usePersonStore.getState().assignPerson(id, ann)
    await undo()
    await redo()
    expect(await typed(id, 'person')).toEqual([
      ['person', null, ann],
      ['person', ann, null],
      ['person', null, ann],
    ])
  })

  it('a tag assigned in bulk (the bulk bar)', async () => {
    const a = await addTask('A')
    const b = await addTask('B')
    await useTagStore.getState().bulkAssignTag([a, b], ops)
    await undo()
    for (const id of [a, b]) expect(await typed(id, 'tag')).toEqual([['tag', null, ops], ['tag', ops, null]])
  })

  it('a marker set in bulk', async () => {
    const id = await addTask('Quote')
    await useTodoStore.getState().bulkSetFocus([id], true)
    await undo()
    await redo()
    expect(await typed(id, 'marker')).toEqual([['marker', null, 'focus'], ['marker', 'focus', null], ['marker', null, 'focus']])
  })

  it('a follow-up marked (Mark followed up)', async () => {
    const id = await addTask('Quote')
    await useTodoStore.getState().markFollowedUp([id])
    const [[, , last]] = await typed(id, 'followedUp') as [[string, null, string]]
    expect(typeof last).toBe('string')
    await undo()
    expect(await typed(id, 'followedUp')).toEqual([['followedUp', null, last], ['followedUp', last, null]])
  })

  it('a person deleted (Settings), then the delete undone', async () => {
    const id = await addTask('Quote')
    await usePersonStore.getState().assignPerson(id, ann)
    await usePersonStore.getState().remove(ann)
    await undo()
    expect(await typed(id, 'person')).toEqual([['person', null, ann], ['person', ann, null], ['person', null, ann]])
  })

  it('unused people and tags removed, then the removal undone', async () => {
    const id = await addTask('Done one')
    await useTagStore.getState().assignTag(id, ops)
    await removePeopleAndTags([], [ops])
    await undo()
    expect(await typed(id, 'tag')).toEqual([['tag', null, ops], ['tag', ops, null], ['tag', null, ops]])
  })
})

describe('copies log their people and tags as created with them', () => {
  it('Duplicate', async () => {
    const id = await addTask('Quote')
    await usePersonStore.getState().assignPerson(id, ann)
    await useTagStore.getState().assignTag(id, ops)
    await useTodoStore.getState().update(id, { urgent: true })
    const copy = await useTodoStore.getState().duplicate(id)
    expect(copy).toBeDefined()
    const created = (await db.todos.get(copy!))!.createdAt.toISOString()
    const events = await db.todoEvents.where('todoId').equals(copy!).sortBy('id')
    expect(events.map((e) => [e.type, e.toValue, e.timestamp])).toEqual([
      ['created', null, created],
      ['person', ann, created],
      ['tag', ops, created],
    ])
  })

  it('Make a task (a subtask with the parent’s people, tags and flags)', async () => {
    const parent = await addTask('Parent')
    await usePersonStore.getState().assignPerson(parent, ann)
    await useTagStore.getState().assignTag(parent, ops)
    await useSubtaskStore.getState().add(parent, 'Child')
    const sub = useSubtaskStore.getState().byTodo.get(parent)?.[0]
    const made = await makeTaskFromSubtask(sub!.id)
    expect(await typed(made!, 'person', 'tag')).toEqual([['person', null, ann], ['tag', null, ops]])
  })
})
