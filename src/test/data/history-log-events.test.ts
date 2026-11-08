import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { personRepository } from '../../data/person-repository'
import { tagRepository } from '../../data/tag-repository'
import { captureJoinRows } from '../../data/join-helpers'
import { deletePeopleAndTags, restorePeopleAndTags } from '../../data/entity-removal'
import { decodeMarkerFlags, encodeMarkerFlags, type TodoEvent } from '../../models'
import { makeTodo, resetDb } from '../helpers'

/**
 * The history log H3 (D26 P7): the next and last follow-up dates, the
 * priority flags and the task's people and tags are logged on every write,
 * as the due date, the status and completion always were.
 */

const eventsOf = async (todoId: number, ...types: TodoEvent['type'][]) =>
  (await db.todoEvents.where('todoId').equals(todoId).sortBy('id'))
    .filter((e) => types.length === 0 || types.includes(e.type))
    .map(({ type, fromValue, toValue }) => ({ type, fromValue, toValue }))

beforeEach(resetDb)

describe('marker encoding', () => {
  it('names the set flags in a fixed order; none is null', () => {
    expect(encodeMarkerFlags({})).toBeNull()
    expect(encodeMarkerFlags({ focus: true, urgent: true })).toBe('urgent,focus')
    expect(encodeMarkerFlags({ urgent: true, important: true, focus: true })).toBe('urgent,important,focus')
    expect(encodeMarkerFlags({ important: false })).toBeNull()
  })

  it('decodes what it encodes; anything else reads as no flag', () => {
    expect(decodeMarkerFlags('important,focus')).toEqual({ urgent: false, important: true, focus: true })
    expect(decodeMarkerFlags(null)).toEqual({ urgent: false, important: false, focus: false })
    expect(decodeMarkerFlags(3)).toEqual({ urgent: false, important: false, focus: false })
  })
})

describe('todoRepository — the H3 fields', () => {
  it('logs the next and last follow-up dates as ISO strings (null when cleared)', async () => {
    const id = await todoRepository.insert(makeTodo())
    const next = new Date('2026-06-01T00:00:00Z')
    const last = new Date('2026-05-20T15:30:00Z')
    await todoRepository.update(id, { nextFollowupAt: next, lastFollowupAt: last })
    await todoRepository.update(id, { nextFollowupAt: undefined })
    expect(await eventsOf(id, 'followup', 'followedUp')).toEqual([
      { type: 'followup', fromValue: null, toValue: next.toISOString() },
      { type: 'followedUp', fromValue: null, toValue: last.toISOString() },
      { type: 'followup', fromValue: next.toISOString(), toValue: null },
    ])
  })

  it('logs the flag set before and after, once per write, and nothing when it is unchanged', async () => {
    const id = await todoRepository.insert(makeTodo({ important: true }))
    await todoRepository.update(id, { urgent: true, focus: true })
    await todoRepository.update(id, { important: undefined })
    await todoRepository.update(id, { urgent: true })
    expect(await eventsOf(id, 'marker')).toEqual([
      { type: 'marker', fromValue: 'important', toValue: 'urgent,important,focus' },
      { type: 'marker', fromValue: 'urgent,important,focus', toValue: 'urgent,focus' },
    ])
  })

  it('bulkUpdate logs each task’s own change', async () => {
    const a = await todoRepository.insert(makeTodo({ focus: true }))
    const b = await todoRepository.insert(makeTodo())
    await todoRepository.bulkUpdate([{ todoId: a, changes: { focus: true } }, { todoId: b, changes: { focus: true } }])
    expect(await eventsOf(a, 'marker')).toEqual([])
    expect(await eventsOf(b, 'marker')).toEqual([{ type: 'marker', fromValue: null, toValue: 'focus' }])
  })

  it('a create logs its people and tags as adds at the create timestamp', async () => {
    const createdAt = new Date('2026-04-02T08:00:00Z')
    const [row] = await todoRepository.insertManyWithAssignments([{
      todo: { title: 't', isCompleted: false, createdAt, modifiedAt: createdAt, urgent: true },
      personIds: [4, 4, 5],
      tagIds: [9],
    }])
    const events = await db.todoEvents.where('todoId').equals(row!.id).sortBy('id')
    expect(events.map((e) => [e.type, e.fromValue, e.toValue, e.timestamp])).toEqual([
      ['created', null, null, createdAt.toISOString()],
      ['person', null, 4, createdAt.toISOString()],
      ['person', null, 5, createdAt.toISOString()],
      ['tag', null, 9, createdAt.toISOString()],
    ])
  })
})

describe('assignment writes', () => {
  async function task(): Promise<number> {
    return todoRepository.insert(makeTodo())
  }

  it('assign / unassign log a person add / remove; a no-op logs nothing', async () => {
    const id = await task()
    await personRepository.assignPerson(id, 3)
    await personRepository.assignPerson(id, 3)
    await personRepository.unassignPerson(id, 3)
    await personRepository.unassignPerson(id, 3)
    expect(await eventsOf(id, 'person')).toEqual([
      { type: 'person', fromValue: null, toValue: 3 },
      { type: 'person', fromValue: 3, toValue: null },
    ])
  })

  it('bulk assign / unassign log only the tasks they changed', async () => {
    const a = await task()
    const b = await task()
    await tagRepository.assignTag(a, 7)
    await tagRepository.bulkAssignTag([a, b], 7)
    expect(await eventsOf(a, 'tag')).toEqual([{ type: 'tag', fromValue: null, toValue: 7 }])
    expect(await eventsOf(b, 'tag')).toEqual([{ type: 'tag', fromValue: null, toValue: 7 }])
    await tagRepository.bulkUnassignTag([a, b], 7)
    expect(await eventsOf(b, 'tag')).toEqual([
      { type: 'tag', fromValue: null, toValue: 7 },
      { type: 'tag', fromValue: 7, toValue: null },
    ])
  })

  it('an assignment to a task that doesn’t exist logs nothing', async () => {
    await personRepository.assignPerson(999, 3)
    expect(await db.todoEvents.count()).toBe(0)
  })

  it('a person delete logs a remove on each of its tasks; its undo logs the adds', async () => {
    const personId = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    const a = await task()
    const b = await task()
    await personRepository.bulkAssignPerson([a, b], personId)
    const person = (await db.people.get(personId))!
    const joins = await captureJoinRows([{ table: db.todoPeople, key: 'personId', id: personId }])
    await personRepository.delete(personId)
    expect(await eventsOf(a, 'person')).toEqual([
      { type: 'person', fromValue: null, toValue: personId },
      { type: 'person', fromValue: personId, toValue: null },
    ])
    await personRepository.restoreWithJoins(person, joins)
    expect((await eventsOf(b, 'person')).at(-1)).toEqual({ type: 'person', fromValue: null, toValue: personId })
  })

  it('a tag restored over one of the same name made meanwhile logs the move', async () => {
    const tagId = await db.tags.add({ name: 'ops', color: '#fff' }) as number
    const a = await task()
    const b = await task()
    await tagRepository.assignTag(a, tagId)
    const tag = (await db.tags.get(tagId))!
    const joins = await captureJoinRows([{ table: db.todoTags, key: 'tagId', id: tagId }])
    await tagRepository.delete(tagId)
    const again = await db.tags.add({ name: 'Ops', color: '#000' }) as number
    await tagRepository.assignTag(b, again)
    await tagRepository.restoreWithJoins(tag, joins)
    // b's tag moved from the new "Ops" to the restored "ops".
    expect((await eventsOf(b, 'tag')).slice(-2)).toEqual([
      { type: 'tag', fromValue: again, toValue: null },
      { type: 'tag', fromValue: null, toValue: tagId },
    ])
    expect((await eventsOf(a, 'tag')).at(-1)).toEqual({ type: 'tag', fromValue: null, toValue: tagId })
  })

  it('removing unused people and tags logs their removes; the undo logs the adds', async () => {
    const personId = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    const tagId = await db.tags.add({ name: 'old', color: '#fff' }) as number
    const id = await task()
    await personRepository.assignPerson(id, personId)
    await tagRepository.assignTag(id, tagId)
    const removed = await deletePeopleAndTags([personId], [tagId])
    expect((await eventsOf(id, 'person', 'tag')).slice(-2)).toEqual([
      { type: 'person', fromValue: personId, toValue: null },
      { type: 'tag', fromValue: tagId, toValue: null },
    ])
    await restorePeopleAndTags(removed)
    expect((await eventsOf(id, 'person', 'tag')).slice(-2)).toEqual([
      { type: 'person', fromValue: null, toValue: personId },
      { type: 'tag', fromValue: null, toValue: tagId },
    ])
  })
})
