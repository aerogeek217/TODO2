import { db } from './database'
import type { Person } from '../models'
import { createRepository } from './create-repository'
import { createJoinOps, buildAssignmentMap, type JoinCapture } from './join-helpers'

const base = createRepository<Person>(db.people, 'name')
const todoPeopleOps = createJoinOps(db.todoPeople, 'todoId', 'personId')

export const personRepository = {
  ...base,

  /**
   * Atomic lookup-or-insert by name: a person whose trimmed name matches
   * case-insensitively is returned as stored; otherwise a new person with the
   * given initials (and no color) is inserted. One `rw` transaction on
   * `people`, so two concurrent creates of the same name insert one row.
   */
  async getOrCreate(name: string, initials: string): Promise<Person & { id: number }> {
    const trimmed = name.trim()
    const target = trimmed.toLowerCase()
    return db.transaction('rw', db.people, async () => {
      const all = await db.people.toArray()
      const existing = all.find((p) => p.id != null && p.name.trim().toLowerCase() === target)
      if (existing?.id != null) return { ...existing, id: existing.id }
      const person: Person = { name: trimmed, initials }
      const id = (await db.people.add(person)) as number
      return { ...person, id }
    })
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.people, db.todoPeople], async () => {
      await db.todoPeople.where('personId').equals(id).delete()
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

  async getTodoCountForPerson(personId: number): Promise<number> {
    return db.todoPeople.where('personId').equals(personId).count()
  },

  /**
   * Undo-restore for `delete`: re-insert the person row (preserving its id)
   * plus its captured `todoPeople` join rows inside one transaction.
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
