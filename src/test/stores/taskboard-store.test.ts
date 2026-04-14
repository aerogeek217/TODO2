import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTaskboardStore } from '../../stores/taskboard-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTaskboardStore.setState({ entries: [], loading: false, error: null })
})

describe('useTaskboardStore', () => {
  describe('load', () => {
    it('loads entries from database sorted by sortOrder', async () => {
      await db.taskboardEntries.bulkAdd([
        { todoId: 10, sortOrder: 2000 },
        { todoId: 20, sortOrder: 1000 },
      ])

      await useTaskboardStore.getState().load()

      const { entries } = useTaskboardStore.getState()
      expect(entries).toHaveLength(2)
      expect(entries[0].todoId).toBe(20)
      expect(entries[1].todoId).toBe(10)
    })

    it('sets loading to false after completion', async () => {
      await useTaskboardStore.getState().load()
      expect(useTaskboardStore.getState().loading).toBe(false)
    })
  })

  describe('add', () => {
    it('adds a new entry to the store and database', async () => {
      await useTaskboardStore.getState().add(42)

      const { entries } = useTaskboardStore.getState()
      expect(entries).toHaveLength(1)
      expect(entries[0].todoId).toBe(42)

      const dbEntry = await db.taskboardEntries.where('todoId').equals(42).first()
      expect(dbEntry).toBeDefined()
    })

    it('does not add duplicate todoId', async () => {
      await useTaskboardStore.getState().add(42)
      await useTaskboardStore.getState().add(42)

      const { entries } = useTaskboardStore.getState()
      expect(entries).toHaveLength(1)
    })
  })

  describe('remove', () => {
    it('removes an entry from the store and database', async () => {
      await useTaskboardStore.getState().add(42)
      await useTaskboardStore.getState().remove(42)

      expect(useTaskboardStore.getState().entries).toHaveLength(0)
      const dbEntry = await db.taskboardEntries.where('todoId').equals(42).first()
      expect(dbEntry).toBeUndefined()
    })

    it('does nothing when todoId not in taskboard', async () => {
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().remove(999)

      expect(useTaskboardStore.getState().entries).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('removes all entries from store and database', async () => {
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().add(2)
      await useTaskboardStore.getState().add(3)

      await useTaskboardStore.getState().clear()

      expect(useTaskboardStore.getState().entries).toHaveLength(0)
      const dbEntries = await db.taskboardEntries.toArray()
      expect(dbEntries).toHaveLength(0)
    })

    it('does nothing when already empty', async () => {
      await useTaskboardStore.getState().clear()
      expect(useTaskboardStore.getState().entries).toHaveLength(0)
    })
  })

  describe('has', () => {
    it('returns true when todoId is in taskboard', async () => {
      await useTaskboardStore.getState().add(42)
      expect(useTaskboardStore.getState().has(42)).toBe(true)
    })

    it('returns false when todoId is not in taskboard', () => {
      expect(useTaskboardStore.getState().has(999)).toBe(false)
    })
  })

  describe('addAt', () => {
    it('addAt with consecutive sortOrders normalizes to avoid collision', async () => {
      // Arrange: create entries with consecutive sortOrders (1000, 1001)
      await db.taskboardEntries.bulkAdd([
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 1001 },
      ])
      await useTaskboardStore.getState().load()

      // Act: insert between them — Math.floor((1000+1001)/2) = 1000, collides with prev
      await useTaskboardStore.getState().addAt(30, 1)

      // Assert: all three entries exist in correct order
      const { entries } = useTaskboardStore.getState()
      expect(entries).toHaveLength(3)
      expect(entries.map(e => e.todoId)).toEqual([10, 30, 20])

      // Verify sort orders are strictly increasing (normalization happened)
      expect(entries[0].sortOrder).toBeLessThan(entries[1].sortOrder)
      expect(entries[1].sortOrder).toBeLessThan(entries[2].sortOrder)

      // Verify database matches
      const dbEntries = await db.taskboardEntries.orderBy('sortOrder').toArray()
      expect(dbEntries.map(e => e.todoId)).toEqual([10, 30, 20])
    })

    it('addAt without collision does not normalize', async () => {
      // Arrange: entries with wide gap
      await db.taskboardEntries.bulkAdd([
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 3000 },
      ])
      await useTaskboardStore.getState().load()

      // Act: insert between — midpoint is 2000, no collision
      await useTaskboardStore.getState().addAt(30, 1)

      const { entries } = useTaskboardStore.getState()
      expect(entries).toHaveLength(3)
      expect(entries.map(e => e.todoId)).toEqual([10, 30, 20])
      // The inserted entry should have sortOrder 2000
      expect(entries[1].sortOrder).toBe(2000)
    })
  })

  describe('reorder', () => {
    it('moves an entry from one position to another', async () => {
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().add(2)
      await useTaskboardStore.getState().add(3)

      // Move item at index 2 (todoId=3) to index 0
      await useTaskboardStore.getState().reorder(2, 0)

      const { entries } = useTaskboardStore.getState()
      expect(entries.map(e => e.todoId)).toEqual([3, 1, 2])
    })

    it('updates sortOrders in database after reorder', async () => {
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().add(2)

      await useTaskboardStore.getState().reorder(1, 0)

      const dbEntries = await db.taskboardEntries.orderBy('sortOrder').toArray()
      expect(dbEntries[0].todoId).toBe(2)
      expect(dbEntries[1].todoId).toBe(1)
    })
  })
})
