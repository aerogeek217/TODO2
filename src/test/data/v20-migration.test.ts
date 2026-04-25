import { describe, it, expect, beforeEach } from 'vitest'
import { db, runV20Migration, ensureSeededStatuses } from '../../data/database'
import type { Status } from '../../models'
import { makeTodo } from '../helpers'

describe('v20 migration', () => {
  let canvasId: number

  beforeEach(async () => {
    await db.delete()
    await db.open()
    canvasId = await db.canvases.add({ name: 'Main', sortOrder: 0, createdAt: new Date() } as any)
  })

  async function runMigration() {
    await db.transaction('rw', [db.todos, db.statuses, db.listInsets, db.settings], async (tx) => {
      await runV20Migration(tx)
    })
  }

  async function getSeededIds() {
    const assigned = await db.settings.get('seededAssignedStatusId')
    const followup = await db.settings.get('seededFollowupStatusId')
    return {
      assignedId: assigned ? Number(assigned.value) : null,
      followupId: followup ? Number(followup.value) : null,
    }
  }

  it('seeds Assigned and Followup statuses with correct fields', async () => {
    await runMigration()
    const { assignedId, followupId } = await getSeededIds()

    const assigned = await db.statuses.get(assignedId!)
    expect(assigned).toBeDefined()
    expect(assigned!.name).toBe('Assigned')
    expect(assigned!.color).toBe('#537FE7')
    expect(assigned!.icon).toBe('person')
    expect(assigned!.hideByDefault).toBe(true)

    const followup = await db.statuses.get(followupId!)
    expect(followup).toBeDefined()
    expect(followup!.name).toBe('Follow-up')
    expect(followup!.color).toBe('#F5A623')
    expect(followup!.icon).toBe('message-bubble')
    expect(followup!.hideByDefault).toBe(false)
  })

  it('writes distinct seeded-ID settings keys', async () => {
    await runMigration()
    const { assignedId, followupId } = await getSeededIds()
    expect(assignedId).toBeGreaterThan(0)
    expect(followupId).toBeGreaterThan(0)
    expect(assignedId).not.toBe(followupId)
  })

  it('star precedence: isStarred=true wins over isAssigned=true and existing statusId', async () => {
    const existingStatusId = await db.statuses.add({ name: 'InProgress', color: '#00FF00', sortOrder: 0 } as Status)
    const todoId = await db.todos.add(makeTodo({
      id: 1, canvasId, isStarred: true, isAssigned: true, statusId: existingStatusId,
    } as any))

    await runMigration()
    const { followupId } = await getSeededIds()
    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBe(followupId)
  })

  it('assign precedence: isAssigned=true when not starred', async () => {
    const existingStatusId = await db.statuses.add({ name: 'InProgress', color: '#00FF00', sortOrder: 0 } as Status)
    const todoId = await db.todos.add(makeTodo({
      id: 1, canvasId, isStarred: false, isAssigned: true, statusId: existingStatusId,
    } as any))

    await runMigration()
    const { assignedId } = await getSeededIds()
    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBe(assignedId)
  })

  it('preserves existing statusId when neither starred nor assigned', async () => {
    const existingStatusId = await db.statuses.add({ name: 'InProgress', color: '#00FF00', sortOrder: 0 } as Status)
    const todoId = await db.todos.add(makeTodo({
      id: 1, canvasId, isStarred: false, isAssigned: false, statusId: existingStatusId,
    } as any))

    await runMigration()
    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBe(existingStatusId)
  })

  it('unflagged task keeps undefined statusId after migration', async () => {
    const todoId = await db.todos.add(makeTodo({
      id: 1, canvasId, isStarred: false, isAssigned: false,
    } as any))

    await runMigration()
    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBeUndefined()
  })

  it('strips isStarred and isAssigned fields from all migrated rows', async () => {
    await db.todos.add(makeTodo({ id: 1, canvasId, isStarred: true } as any))
    await db.todos.add(makeTodo({ id: 2, canvasId, isAssigned: true } as any))
    await db.todos.add(makeTodo({ id: 3, canvasId, isStarred: false } as any))

    await runMigration()
    const todos = await db.todos.toArray()
    for (const todo of todos) {
      expect('isStarred' in todo).toBe(false)
      expect('isAssigned' in todo).toBe(false)
    }
  })

  it('deletes starred list insets and preserves others', async () => {
    await db.listInsets.add({
      name: 'Starred', preset: 'starred', canvasId,
      x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as any)
    await db.listInsets.add({
      name: 'High Priority', preset: 'high-priority', canvasId,
      x: 400, y: 0, width: 300, height: 400, isCollapsed: false,
    } as any)

    await runMigration()
    const insets = await db.listInsets.toArray() as unknown as Record<string, unknown>[]
    expect(insets).toHaveLength(1)
    expect(insets[0]!.preset).toBe('high-priority')
  })

  it('does not duplicate seeded statuses on re-run (idempotent)', async () => {
    await runMigration()
    const firstIds = await getSeededIds()
    const firstCount = (await db.statuses.toArray()).length

    await runMigration()
    const secondIds = await getSeededIds()
    const secondCount = (await db.statuses.toArray()).length

    expect(secondIds.assignedId).toBe(firstIds.assignedId)
    expect(secondIds.followupId).toBe(firstIds.followupId)
    expect(secondCount).toBe(firstCount)
  })

  it('does not co-opt a user-created status named "Assigned"', async () => {
    const userAssignedId = await db.statuses.add({
      name: 'Assigned', color: '#FF0000', sortOrder: 0,
    } as Status)

    await runMigration()
    const { assignedId } = await getSeededIds()

    expect(assignedId).not.toBe(userAssignedId)

    const userStatus = await db.statuses.get(userAssignedId)
    expect(userStatus!.name).toBe('Assigned')
    expect(userStatus!.color).toBe('#FF0000')
    expect(userStatus!.icon).toBeUndefined()
    expect(userStatus!.hideByDefault).toBeUndefined()
  })

  it('reuses existing settings pointer on re-run of ensureSeededStatuses', async () => {
    await runMigration()
    const firstIds = await getSeededIds()
    const countBefore = (await db.statuses.toArray()).length

    await db.transaction('rw', [db.statuses, db.settings], async () => {
      await ensureSeededStatuses(db.statuses, db.settings)
    })

    const secondIds = await getSeededIds()
    const countAfter = (await db.statuses.toArray()).length

    expect(secondIds.assignedId).toBe(firstIds.assignedId)
    expect(secondIds.followupId).toBe(firstIds.followupId)
    expect(countAfter).toBe(countBefore)
  })

  it('preserves dangling statusId pointing at nonexistent status', async () => {
    const todoId = await db.todos.add(makeTodo({
      id: 1, canvasId, isStarred: false, isAssigned: false, statusId: 999,
    } as any))

    await runMigration()
    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBe(999)
  })

  it('completes without transaction errors when all touched tables have data', async () => {
    await db.todos.add(makeTodo({ id: 1, canvasId, isStarred: true } as any))
    await db.listInsets.add({
      name: 'Starred', preset: 'starred', canvasId,
      x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as any)
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    await runMigration()

    const todos = await db.todos.toArray()
    expect(todos).toHaveLength(1)
    expect('isStarred' in todos[0]!).toBe(false)
  })

  it('appends seeded statuses after existing user statuses in sortOrder', async () => {
    await db.statuses.add({ name: 'Custom 1', color: '#111111', sortOrder: 5 } as Status)
    await db.statuses.add({ name: 'Custom 2', color: '#222222', sortOrder: 10 } as Status)

    await runMigration()
    const { assignedId, followupId } = await getSeededIds()

    const assigned = await db.statuses.get(assignedId!)
    const followup = await db.statuses.get(followupId!)
    expect(assigned!.sortOrder).toBeGreaterThan(10)
    expect(followup!.sortOrder).toBeGreaterThan(assigned!.sortOrder)
  })
})
