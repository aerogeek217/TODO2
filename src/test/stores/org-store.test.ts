import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useOrgStore } from '../../stores/org-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), loading: false, error: null })
})

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('useOrgStore', () => {
  it('load populates orgs from DB', async () => {
    await db.orgs.add({ name: 'Engineering' })
    await db.orgs.add({ name: 'Design' })

    await useOrgStore.getState().load()
    expect(useOrgStore.getState().orgs).toHaveLength(2)
  })

  it('add inserts org', async () => {
    const id = await useOrgStore.getState().add('Engineering', '#ff0000')
    expect(useOrgStore.getState().orgs).toHaveLength(1)
    expect(useOrgStore.getState().orgs[0].name).toBe('Engineering')
    expect(id).toBeGreaterThan(0)
  })

  it('update modifies org in store array', async () => {
    const id = await useOrgStore.getState().add('Engineering')
    await useOrgStore.getState().update({ id, name: 'Platform', color: '#00ff00' })
    expect(useOrgStore.getState().orgs[0].name).toBe('Platform')
  })

  it('remove deletes from store array', async () => {
    const id = await useOrgStore.getState().add('Engineering')
    await useOrgStore.getState().remove(id)
    expect(useOrgStore.getState().orgs).toHaveLength(0)
  })

  it('remove prunes the deleted org from assignedOrgsMap', async () => {
    const engId = await useOrgStore.getState().add('Engineering')
    const designId = await useOrgStore.getState().add('Design')
    const todoId = await addTodo()
    await useOrgStore.getState().loadAssignments([todoId])
    await useOrgStore.getState().assignOrg(todoId, engId)
    await useOrgStore.getState().assignOrg(todoId, designId)
    expect(useOrgStore.getState().assignedOrgsMap.get(todoId)).toHaveLength(2)

    await useOrgStore.getState().remove(engId)
    const remaining = useOrgStore.getState().assignedOrgsMap.get(todoId) ?? []
    expect(remaining.map((o) => o.id)).toEqual([designId])
  })

  it('loadAssignments populates assignedOrgsMap', async () => {
    const orgId = await useOrgStore.getState().add('Engineering')
    const todoId = await addTodo()
    await db.todoOrgs.add({ todoId, orgId } as any)

    await useOrgStore.getState().loadAssignments([todoId])
    const map = useOrgStore.getState().assignedOrgsMap
    expect(map.get(todoId)).toHaveLength(1)
    expect(map.get(todoId)![0].name).toBe('Engineering')
  })

  it('assignOrg adds to assignedOrgsMap', async () => {
    const orgId = await useOrgStore.getState().add('Engineering')
    const todoId = await addTodo()
    await useOrgStore.getState().loadAssignments([todoId])

    await useOrgStore.getState().assignOrg(todoId, orgId)
    expect(useOrgStore.getState().assignedOrgsMap.get(todoId)).toHaveLength(1)
  })

  it('unassignOrg removes from assignedOrgsMap', async () => {
    const orgId = await useOrgStore.getState().add('Engineering')
    const todoId = await addTodo()
    await useOrgStore.getState().loadAssignments([todoId])
    await useOrgStore.getState().assignOrg(todoId, orgId)

    await useOrgStore.getState().unassignOrg(todoId, orgId)
    expect(useOrgStore.getState().assignedOrgsMap.get(todoId) ?? []).toHaveLength(0)
  })

  it('getAssignedOrgs returns orgs for a todoId, empty array if none', async () => {
    const orgId = await useOrgStore.getState().add('Engineering')
    const todoId = await addTodo()
    await useOrgStore.getState().loadAssignments([todoId])
    await useOrgStore.getState().assignOrg(todoId, orgId)

    expect(useOrgStore.getState().getAssignedOrgs(todoId)).toHaveLength(1)
    expect(useOrgStore.getState().getAssignedOrgs(99999)).toEqual([])
  })
})
