import { db } from './database'
import type { Org, PersonOrg } from '../models'
import { createRepository } from './create-repository'
import { createJoinOps, buildAssignmentMap } from './join-helpers'

const base = createRepository<Org>(db.orgs, 'name')
const todoOrgOps = createJoinOps(db.todoOrgs, 'todoId', 'orgId')
const personOrgOps = createJoinOps(db.personOrgs, 'personId', 'orgId')

export const orgRepository = {
  ...base,

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.orgs, db.personOrgs, db.todoOrgs], async () => {
      // Remove person-org memberships for this org
      await db.personOrgs.where('orgId').equals(id).delete()
      // Remove all task assignments for this org
      await db.todoOrgs.where('orgId').equals(id).delete()
      await db.orgs.delete(id)
    })
  },

  async getPersonCount(id: number): Promise<number> {
    return db.personOrgs.where('orgId').equals(id).count()
  },

  async getOrgsForPerson(personId: number): Promise<Org[]> {
    const links = await db.personOrgs.where('personId').equals(personId).toArray()
    if (links.length === 0) return []
    const orgs = await db.orgs.where('id').anyOf(links.map((l) => l.orgId)).toArray()
    return orgs
  },

  async getPersonOrgMap(): Promise<Map<number, number[]>> {
    const links = await db.personOrgs.toArray()
    const map = new Map<number, number[]>()
    for (const link of links) {
      const list = map.get(link.personId) ?? []
      list.push(link.orgId)
      map.set(link.personId, list)
    }
    return map
  },

  async assignPersonToOrg(personId: number, orgId: number): Promise<void> {
    await personOrgOps.assign(personId, orgId)
  },

  async unassignPersonFromOrg(personId: number, orgId: number): Promise<void> {
    await personOrgOps.unassign(personId, orgId)
  },

  async setPersonOrgs(personId: number, orgIds: number[]): Promise<void> {
    await db.transaction('rw', db.personOrgs, async () => {
      await db.personOrgs.where('personId').equals(personId).delete()
      if (orgIds.length > 0) {
        await db.personOrgs.bulkAdd(orgIds.map((orgId) => ({ personId, orgId }) as PersonOrg))
      }
    })
  },

  async getAssignedOrgsForTodos(todoIds: number[]): Promise<Map<number, Org[]>> {
    return buildAssignmentMap(db.todoOrgs, db.orgs, 'todoId', 'orgId', todoIds)
  },

  async assignOrg(todoId: number, orgId: number): Promise<void> {
    await todoOrgOps.assign(todoId, orgId)
  },

  async unassignOrg(todoId: number, orgId: number): Promise<void> {
    await todoOrgOps.unassign(todoId, orgId)
  },
}
