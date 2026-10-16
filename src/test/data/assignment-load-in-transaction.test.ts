import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { tagRepository } from '../../data/tag-repository'
import { personRepository } from '../../data/person-repository'
import { useTagStore } from '../../stores/tag-store'
import { usePersonStore } from '../../stores/person-store'

/**
 * Assignment loads are snapshot reads for the UI. They can be started while
 * a transaction over other tables (here todos / todoPeople / todoEvents) is open —
 * the store writes inside it re-render React synchronously, and effects such
 * as `useBuiltList`'s tag load run in that transaction's Dexie zone. They
 * must read outside it instead of failing on a table it doesn't cover.
 */
describe('assignment loads started inside a write transaction', () => {
  let todoId: number
  let tagId: number
  let personId: number

  beforeEach(async () => {
    await db.delete()
    await db.open()
    todoId = 7
    tagId = await db.tags.add({ name: 'ops', color: '#fff' })
    personId = await db.people.add({ name: 'Dana Kim', initials: 'DK' })
    await db.todoTags.add({ todoId, tagId })
    await db.todoPeople.add({ todoId, personId })
    useTagStore.setState({ tags: [{ id: tagId, name: 'ops', color: '#fff' }], assignedTagsMap: new Map() })
    usePersonStore.setState({ people: [{ id: personId, name: 'Dana Kim', initials: 'DK' }], assignedPeopleMap: new Map() })
  })

  // Like a React effect: started inside the transaction's zone, not awaited by it.
  async function startedInside<T>(load: () => Promise<T>): Promise<T> {
    let started: Promise<T> | undefined
    await db.transaction('rw', [db.todos, db.todoPeople, db.todoEvents], async () => {
      await db.todos.add({ id: 99, title: 'x', isCompleted: false, sortOrder: 0, uid: 'u99', createdAt: new Date(), modifiedAt: new Date() } as never)
      started = load()
    })
    expect(await db.todos.get(99)).toBeDefined() // the transaction still commits
    return started!
  }

  it('reads tag assignments (todoTags / tags are outside its scope)', async () => {
    const map = await startedInside(() => tagRepository.getAssignedTagsForTodos([todoId]))
    expect(map.get(todoId)?.map((t) => t.name)).toEqual(['ops'])
  })

  it('reads people assignments (people is outside its scope)', async () => {
    const map = await startedInside(() => personRepository.getAssignedPeopleForTodos([todoId]))
    expect(map.get(todoId)?.map((p) => p.name)).toEqual(['Dana Kim'])
  })

  it('the tag store load completes and the map reflects the joins', async () => {
    await startedInside(() => useTagStore.getState().loadAssignments([todoId]))
    expect(useTagStore.getState().assignedTagsMap.get(todoId)?.map((t) => t.name)).toEqual(['ops'])
  })
})
