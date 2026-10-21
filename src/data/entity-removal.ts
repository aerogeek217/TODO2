import { db } from './database'
import { restoreNamedEntityWithJoins } from './join-helpers'
import type { Person, Tag, TodoPerson, TodoTag } from '../models'

/** People and tags removed together, as stored, with their join rows — what the undo puts back. */
export interface RemovedEntities {
  people: Person[]
  tags: Tag[]
  personJoins: TodoPerson[]
  tagJoins: TodoTag[]
}

/**
 * Deletes the people and tags (ids that are gone are skipped) and every task
 * assignment of theirs, in one transaction: all of it, or — on a failure —
 * nothing. Returns the rows as they were, for `restorePeopleAndTags`.
 * Filters that name them are left alone (they keep the ids).
 */
export async function deletePeopleAndTags(personIds: readonly number[], tagIds: readonly number[]): Promise<RemovedEntities> {
  return db.transaction('rw', [db.people, db.tags, db.todoPeople, db.todoTags], async () => {
    const people = personIds.length > 0 ? (await db.people.bulkGet([...personIds])).filter((p): p is Person => p != null) : []
    const tags = tagIds.length > 0 ? (await db.tags.bulkGet([...tagIds])).filter((t): t is Tag => t != null) : []
    const pIds = people.map((p) => p.id!)
    const tIds = tags.map((t) => t.id!)
    const personJoins = pIds.length > 0 ? await db.todoPeople.where('personId').anyOf(pIds).toArray() : []
    const tagJoins = tIds.length > 0 ? await db.todoTags.where('tagId').anyOf(tIds).toArray() : []
    if (personJoins.length > 0) await db.todoPeople.bulkDelete(personJoins.map((j) => j.id!))
    if (tagJoins.length > 0) await db.todoTags.bulkDelete(tagJoins.map((j) => j.id!))
    if (pIds.length > 0) await db.people.bulkDelete(pIds)
    if (tIds.length > 0) await db.tags.bulkDelete(tIds)
    return { people, tags, personJoins, tagJoins }
  })
}

/**
 * Undo for `deletePeopleAndTags`: every person and tag back with its id and
 * its join rows, in one transaction — each as a single delete's undo puts it
 * back (`restoreNamedEntityWithJoins`: one of the same name created
 * meanwhile is folded into it).
 */
export async function restorePeopleAndTags(removed: RemovedEntities): Promise<void> {
  await db.transaction('rw', [db.people, db.tags, db.todoPeople, db.todoTags], async () => {
    for (const person of removed.people) {
      const rows = removed.personJoins.filter((j) => j.personId === person.id)
      await restoreNamedEntityWithJoins(db.people, person, { table: db.todoPeople, entityKey: 'personId', linkKey: 'todoId' }, [{ table: db.todoPeople, rows }])
    }
    for (const tag of removed.tags) {
      const rows = removed.tagJoins.filter((j) => j.tagId === tag.id)
      await restoreNamedEntityWithJoins(db.tags, tag, { table: db.todoTags, entityKey: 'tagId', linkKey: 'todoId' }, [{ table: db.todoTags, rows }])
    }
  })
}
