import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useStatusStore } from '../../stores/status-store'
import { useUndoStore } from '../../stores/undo-store'
import { Priority } from '../../models/priority'

const now = new Date()

beforeEach(async () => {
  await db.delete()
  await db.open()
  useStatusStore.setState({ statuses: [], loading: false, error: null })
  useUndoStore.getState().clear()
})

describe('useStatusStore', () => {
  describe('load', () => {
    it('loads statuses from database', async () => {
      await db.statuses.add({ name: 'Open', color: '#00ff00', sortOrder: 0 })
      await db.statuses.add({ name: 'Closed', color: '#ff0000', sortOrder: 1 })

      await useStatusStore.getState().load()

      const { statuses } = useStatusStore.getState()
      expect(statuses).toHaveLength(2)
      expect(statuses.map(s => s.name)).toContain('Open')
      expect(statuses.map(s => s.name)).toContain('Closed')
    })

    it('loads empty array when no statuses exist', async () => {
      await useStatusStore.getState().load()

      expect(useStatusStore.getState().statuses).toHaveLength(0)
    })
  })

  describe('add', () => {
    it('creates a status with auto-incremented sortOrder', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      await useStatusStore.getState().add('In Progress', '#0000ff')

      const { statuses } = useStatusStore.getState()
      expect(statuses).toHaveLength(2)
      expect(statuses[0].name).toBe('Open')
      expect(statuses[1].name).toBe('In Progress')
      expect(statuses[1].sortOrder).toBeGreaterThan(statuses[0].sortOrder)
    })

    it('persists status to database', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')

      const rows = await db.statuses.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Open')
      expect(rows[0].color).toBe('#00ff00')
    })

    it('returns the new status id', async () => {
      const id = await useStatusStore.getState().add('Open', '#00ff00')

      expect(id).toBeGreaterThan(0)
      expect(useStatusStore.getState().statuses[0].id).toBe(id)
    })

    it('uses default color when none provided', async () => {
      await useStatusStore.getState().add('Open')

      const { statuses } = useStatusStore.getState()
      expect(statuses[0].color).toBe('#537FE7')
    })

    it('rejects duplicate name (case-insensitive)', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')

      await expect(useStatusStore.getState().add('open', '#ff0000')).rejects.toThrow('already exists')
      expect(useStatusStore.getState().statuses).toHaveLength(1)
    })
  })

  describe('update', () => {
    it('updates status name and color', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const status = useStatusStore.getState().statuses[0]

      await useStatusStore.getState().update({ ...status, name: 'Active', color: '#0000ff' })

      const updated = useStatusStore.getState().statuses[0]
      expect(updated.name).toBe('Active')
      expect(updated.color).toBe('#0000ff')
    })

    it('persists update to database', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const status = useStatusStore.getState().statuses[0]

      await useStatusStore.getState().update({ ...status, name: 'Renamed' })

      const row = await db.statuses.get(status.id!)
      expect(row!.name).toBe('Renamed')
    })

    it('rejects duplicate name on update (case-insensitive)', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      await useStatusStore.getState().add('Closed', '#ff0000')
      const open = useStatusStore.getState().statuses[0]

      await expect(
        useStatusStore.getState().update({ ...open, name: 'closed' })
      ).rejects.toThrow('already exists')
      // Name should not have changed
      expect(useStatusStore.getState().statuses[0].name).toBe('Open')
    })

    it('allows updating to same name on same status', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const status = useStatusStore.getState().statuses[0]

      // Change color but keep name — should not throw
      await useStatusStore.getState().update({ ...status, color: '#0000ff' })

      expect(useStatusStore.getState().statuses[0].color).toBe('#0000ff')
    })
  })

  describe('remove', () => {
    it('removes status from state and database', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const id = useStatusStore.getState().statuses[0].id!

      await useStatusStore.getState().remove(id)

      expect(useStatusStore.getState().statuses).toHaveLength(0)
      expect(await db.statuses.get(id)).toBeUndefined()
    })

    it('clears statusId on affected todos', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const statusId = useStatusStore.getState().statuses[0].id!

      const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
      const todoId = await db.todos.add({
        title: 'Task', priority: Priority.Normal, isCompleted: false,
        isStarred: false, sortOrder: 0, createdAt: now, modifiedAt: now,
        canvasId, statusId,
      } as any)

      await useStatusStore.getState().remove(statusId)

      const todo = await db.todos.get(todoId)
      expect(todo!.statusId).toBeUndefined()
    })

    it('registers undo action', async () => {
      await useStatusStore.getState().add('Open', '#00ff00')
      const id = useStatusStore.getState().statuses[0].id!

      await useStatusStore.getState().remove(id)

      expect(useUndoStore.getState().canUndo()).toBe(true)
    })
  })

  describe('reorder', () => {
    it('swaps status positions', async () => {
      await useStatusStore.getState().add('First', '#ff0000')
      await useStatusStore.getState().add('Second', '#00ff00')
      await useStatusStore.getState().add('Third', '#0000ff')

      await useStatusStore.getState().reorder(0, 2)

      const { statuses } = useStatusStore.getState()
      const sorted = [...statuses].sort((a, b) => a.sortOrder - b.sortOrder)
      expect(sorted[0].name).toBe('Second')
      expect(sorted[1].name).toBe('Third')
      expect(sorted[2].name).toBe('First')
    })

    it('persists new sort order to database', async () => {
      await useStatusStore.getState().add('A', '#ff0000')
      await useStatusStore.getState().add('B', '#00ff00')

      await useStatusStore.getState().reorder(0, 1)

      const rows = await db.statuses.orderBy('sortOrder').toArray()
      expect(rows[0].name).toBe('B')
      expect(rows[1].name).toBe('A')
    })

    it('ignores out-of-range indices', async () => {
      await useStatusStore.getState().add('Only', '#ff0000')

      await useStatusStore.getState().reorder(-1, 5)

      expect(useStatusStore.getState().statuses).toHaveLength(1)
      expect(useStatusStore.getState().statuses[0].name).toBe('Only')
    })
  })
})
