import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { orgRepository } from '../../data/org-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('orgRepository', () => {
  it('insert and retrieve org by id', async () => {
    const id = await orgRepository.insert({ name: 'Engineering' })
    const org = await orgRepository.getById(id)
    expect(org).toBeDefined()
    expect(org!.name).toBe('Engineering')
  })

  it('getAll returns sorted by name', async () => {
    await orgRepository.insert({ name: 'Zebra' })
    await orgRepository.insert({ name: 'Alpha' })
    await orgRepository.insert({ name: 'Middle' })

    const all = await orgRepository.getAll()
    expect(all.map(o => o.name)).toEqual(['Alpha', 'Middle', 'Zebra'])
  })

  it('update modifies fields', async () => {
    const id = await orgRepository.insert({ name: 'Engineering' })
    await orgRepository.update({ id, name: 'Platform', color: '#ff0000' })
    const org = await orgRepository.getById(id)
    expect(org!.name).toBe('Platform')
    expect(org!.color).toBe('#ff0000')
  })

  it('delete removes org, clears personOrgs, removes todoOrgs', async () => {
    const orgId = await orgRepository.insert({ name: 'Engineering' })
    const personId = (await db.people.add({ name: 'Alice', initials: 'A' })) as number
    await orgRepository.assignPersonToOrg(personId, orgId)
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await orgRepository.assignOrg(todoId, orgId)

    await orgRepository.delete(orgId)
    expect(await orgRepository.getById(orgId)).toBeUndefined()

    const personOrgLinks = await db.personOrgs.where('personId').equals(personId).toArray()
    expect(personOrgLinks).toHaveLength(0)

    const todoOrgLinks = await db.todoOrgs.where('orgId').equals(orgId).toArray()
    expect(todoOrgLinks).toHaveLength(0)
  })

  it('getPersonCount returns count of people in org', async () => {
    const orgId = await orgRepository.insert({ name: 'Engineering' })
    const p1 = (await db.people.add({ name: 'Alice', initials: 'A' })) as number
    const p2 = (await db.people.add({ name: 'Bob', initials: 'B' })) as number
    await db.people.add({ name: 'Charlie', initials: 'C' }) // no org
    await orgRepository.assignPersonToOrg(p1, orgId)
    await orgRepository.assignPersonToOrg(p2, orgId)

    expect(await orgRepository.getPersonCount(orgId)).toBe(2)
  })

  it('multi-org: person can belong to multiple orgs', async () => {
    const org1 = await orgRepository.insert({ name: 'Engineering' })
    const org2 = await orgRepository.insert({ name: 'Design' })
    const personId = (await db.people.add({ name: 'Alice', initials: 'A' })) as number

    await orgRepository.setPersonOrgs(personId, [org1, org2])
    const orgs = await orgRepository.getOrgsForPerson(personId)
    expect(orgs).toHaveLength(2)
    expect(orgs.map(o => o.name).sort()).toEqual(['Design', 'Engineering'])
  })

  it('getPersonOrgMap returns map of personId → orgId[]', async () => {
    const org1 = await orgRepository.insert({ name: 'Eng' })
    const org2 = await orgRepository.insert({ name: 'Design' })
    const p1 = (await db.people.add({ name: 'Alice', initials: 'A' })) as number
    const p2 = (await db.people.add({ name: 'Bob', initials: 'B' })) as number

    await orgRepository.setPersonOrgs(p1, [org1, org2])
    await orgRepository.setPersonOrgs(p2, [org1])

    const map = await orgRepository.getPersonOrgMap()
    expect(map.get(p1)).toHaveLength(2)
    expect(map.get(p2)).toHaveLength(1)
  })

  it('setPersonOrgs replaces existing assignments', async () => {
    const org1 = await orgRepository.insert({ name: 'Eng' })
    const org2 = await orgRepository.insert({ name: 'Design' })
    const personId = (await db.people.add({ name: 'Alice', initials: 'A' })) as number

    await orgRepository.setPersonOrgs(personId, [org1])
    expect(await orgRepository.getOrgsForPerson(personId)).toHaveLength(1)

    await orgRepository.setPersonOrgs(personId, [org1, org2])
    expect(await orgRepository.getOrgsForPerson(personId)).toHaveLength(2)

    await orgRepository.setPersonOrgs(personId, [])
    expect(await orgRepository.getOrgsForPerson(personId)).toHaveLength(0)
  })

  it('getAssignedOrgsForTodos returns map of todoId → Org[]', async () => {
    const org1 = await orgRepository.insert({ name: 'Eng' })
    const org2 = await orgRepository.insert({ name: 'Design' })
    const t1 = (await db.todos.add({
      title: 'Task 1', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    const t2 = (await db.todos.add({
      title: 'Task 2', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 2,
    })) as number

    await orgRepository.assignOrg(t1, org1)
    await orgRepository.assignOrg(t1, org2)
    await orgRepository.assignOrg(t2, org1)

    const map = await orgRepository.getAssignedOrgsForTodos([t1, t2])
    expect(map.get(t1)).toHaveLength(2)
    expect(map.get(t2)).toHaveLength(1)
  })

  it('getAssignedOrgsForTodos returns empty map for empty input', async () => {
    const map = await orgRepository.getAssignedOrgsForTodos([])
    expect(map.size).toBe(0)
  })

  it('assignOrg creates todoOrg link; idempotent on duplicate', async () => {
    const orgId = await orgRepository.insert({ name: 'Eng' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await orgRepository.assignOrg(todoId, orgId)
    await orgRepository.assignOrg(todoId, orgId) // duplicate
    const links = await db.todoOrgs.where('todoId').equals(todoId).toArray()
    expect(links).toHaveLength(1)
  })

  it('unassignOrg removes todoOrg link', async () => {
    const orgId = await orgRepository.insert({ name: 'Eng' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await orgRepository.assignOrg(todoId, orgId)

    await orgRepository.unassignOrg(todoId, orgId)
    const links = await db.todoOrgs.where('todoId').equals(todoId).toArray()
    expect(links).toHaveLength(0)
  })
})
