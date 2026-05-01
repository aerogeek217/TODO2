import { db } from './database'
import type { Person } from '../models'
import { createRepository } from './create-repository'
import { createJoinOps, buildAssignmentMap, type JoinCapture } from './join-helpers'

const base = createRepository<Person>(db.people, 'name')
const todoPeopleOps = createJoinOps(db.todoPeople, 'todoId', 'personId')

export const personRepository = {
  ...base,

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.people, db.todoPeople, db.personOrgs], async () => {
      await db.todoPeople.where('personId').equals(id).delete()
      await db.personOrgs.where('personId').equals(id).delete()
      await db.people.delete(id)
    })
  },

  // --- todoPeople join queries ---

  async getAssignedPeople(todoId: number): Promise<Person[]> {
    const links = await db.todoPeople.where('todoId').equals(todoId).toArray()
    const personIds = links.map((l) => l.personId)
    if (personIds.length === 0) return []
    return db.people.where('id').anyOf(personIds).toArray()
  },

  async getAssignedPeopleForTodos(todoIds: number[]): Promise<Map<number, Person[]>> {
    return buildAssignmentMap(db.todoPeople, db.people, 'todoId', 'personId', todoIds)
  },

  async assignPerson(todoId: number, personId: number): Promise<void> {
    await todoPeopleOps.assign(todoId, personId)
  },

  async unassignPerson(todoId: number, personId: number): Promise<void> {
    await todoPeopleOps.unassign(todoId, personId)
  },

  async removeAllAssignments(todoId: number): Promise<void> {
    await db.todoPeople.where('todoId').equals(todoId).delete()
  },

  async getTodoIdsForPerson(personId: number): Promise<number[]> {
    const links = await db.todoPeople.where('personId').equals(personId).toArray()
    return links.map((l) => l.todoId)
  },

  async getTodoCountForPerson(personId: number): Promise<number> {
    return db.todoPeople.where('personId').equals(personId).count()
  },

  /**
   * Undo-restore for `delete`: re-insert the person row (preserving its id)
   * plus every captured join row (`todoPeople` + `personOrgs`) inside one
   * transaction.
   */
  async restoreWithJoins(person: Person, joins: JoinCapture[]): Promise<void> {
    await db.transaction('rw', [db.people, ...joins.map(j => j.table)], async () => {
      await db.people.add(person)
      for (const { table, rows } of joins) {
        if (rows.length) await table.bulkAdd(rows)
      }
    })
  },
}
