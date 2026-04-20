import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTaskboardStore } from '../../stores/taskboard-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTaskboardStore.setState({ boards: new Map(), defaultBoardId: null, loading: false, error: null })
})

describe('useTaskboardStore', () => {
  async function seedDefaultBoard(): Promise<number> {
    const now = new Date()
    const id = await db.taskboards.add({ name: 'Default', entries: [], createdAt: now, updatedAt: now })
    await db.settings.put({ key: 'defaultTaskboardId', value: String(id) })
    await useTaskboardStore.getState().load()
    return id
  }

  describe('load', () => {
    it('loads all boards and resolves defaultBoardId from settings', async () => {
      const now = new Date()
      const idA = await db.taskboards.add({ name: 'A', entries: [{ todoId: 10, sortOrder: 1000 }], createdAt: now, updatedAt: now })
      const idB = await db.taskboards.add({ name: 'B', entries: [], createdAt: now, updatedAt: now })
      await db.settings.put({ key: 'defaultTaskboardId', value: String(idB) })

      await useTaskboardStore.getState().load()

      const { boards, defaultBoardId } = useTaskboardStore.getState()
      expect(boards.size).toBe(2)
      expect(boards.get(idA!)?.entries[0].todoId).toBe(10)
      expect(defaultBoardId).toBe(idB)
    })

    it('falls back to the first row when the setting is missing', async () => {
      const now = new Date()
      const id = await db.taskboards.add({ name: 'Only', entries: [], createdAt: now, updatedAt: now })
      await useTaskboardStore.getState().load()
      expect(useTaskboardStore.getState().defaultBoardId).toBe(id)
    })
  })

  describe('multi-instance isolation', () => {
    it('mutating one board does not touch another', async () => {
      const now = new Date()
      const idA = await db.taskboards.add({ name: 'A', entries: [], createdAt: now, updatedAt: now })
      const idB = await db.taskboards.add({ name: 'B', entries: [], createdAt: now, updatedAt: now })
      await useTaskboardStore.getState().load()

      await useTaskboardStore.getState().add(idA!, 100)
      await useTaskboardStore.getState().add(idA!, 200)

      const { boards } = useTaskboardStore.getState()
      expect(boards.get(idA!)?.entries.map((e) => e.todoId)).toEqual([100, 200])
      expect(boards.get(idB!)?.entries).toEqual([])
    })
  })

  describe('add', () => {
    it('adds a new entry to the targeted board', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 42)
      const entries = useTaskboardStore.getState().getEntries(id)
      expect(entries).toEqual([{ todoId: 42, sortOrder: 1000 }])
      const row = await db.taskboards.get(id)
      expect(row?.entries[0].todoId).toBe(42)
    })

    it('does not add duplicate todoId', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 42)
      await useTaskboardStore.getState().add(id, 42)
      expect(useTaskboardStore.getState().getEntries(id)).toHaveLength(1)
    })
  })

  describe('removeEntry', () => {
    it('removes an entry from the store and database', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 42)
      await useTaskboardStore.getState().removeEntry(id, 42)
      expect(useTaskboardStore.getState().getEntries(id)).toHaveLength(0)
      const row = await db.taskboards.get(id)
      expect(row?.entries).toEqual([])
    })

    it('does nothing when todoId not in taskboard', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 1)
      await useTaskboardStore.getState().removeEntry(id, 999)
      expect(useTaskboardStore.getState().getEntries(id)).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('removes all entries from the targeted board', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 1)
      await useTaskboardStore.getState().add(id, 2)
      await useTaskboardStore.getState().clear(id)
      expect(useTaskboardStore.getState().getEntries(id)).toHaveLength(0)
      const row = await db.taskboards.get(id)
      expect(row?.entries).toEqual([])
    })

    it('is a no-op on an already-empty board', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().clear(id)
      expect(useTaskboardStore.getState().getEntries(id)).toEqual([])
    })
  })

  describe('has', () => {
    it('returns true when todoId is in the targeted board', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 42)
      expect(useTaskboardStore.getState().has(id, 42)).toBe(true)
    })
    it('returns false for unknown board or todo', async () => {
      const id = await seedDefaultBoard()
      expect(useTaskboardStore.getState().has(id, 999)).toBe(false)
      expect(useTaskboardStore.getState().has(99999, 1)).toBe(false)
    })
  })

  describe('addAt', () => {
    it('normalizes sortOrders when consecutive values collide', async () => {
      const now = new Date()
      const id = await db.taskboards.add({
        name: 'D',
        entries: [
          { todoId: 10, sortOrder: 1000 },
          { todoId: 20, sortOrder: 1001 },
        ],
        createdAt: now,
        updatedAt: now,
      })
      await db.settings.put({ key: 'defaultTaskboardId', value: String(id) })
      await useTaskboardStore.getState().load()

      await useTaskboardStore.getState().addAt(id!, 30, 1)

      const entries = useTaskboardStore.getState().getEntries(id!)
      expect(entries.map((e) => e.todoId)).toEqual([10, 30, 20])
      expect(entries[0].sortOrder).toBeLessThan(entries[1].sortOrder)
      expect(entries[1].sortOrder).toBeLessThan(entries[2].sortOrder)
    })

    it('addAt without collision does not normalize', async () => {
      const now = new Date()
      const id = await db.taskboards.add({
        name: 'D',
        entries: [
          { todoId: 10, sortOrder: 1000 },
          { todoId: 20, sortOrder: 3000 },
        ],
        createdAt: now,
        updatedAt: now,
      })
      await db.settings.put({ key: 'defaultTaskboardId', value: String(id) })
      await useTaskboardStore.getState().load()

      await useTaskboardStore.getState().addAt(id!, 30, 1)
      const entries = useTaskboardStore.getState().getEntries(id!)
      expect(entries.map((e) => e.todoId)).toEqual([10, 30, 20])
      expect(entries[1].sortOrder).toBe(2000)
    })
  })

  describe('reorder', () => {
    it('moves an entry from one position to another', async () => {
      const id = await seedDefaultBoard()
      await useTaskboardStore.getState().add(id, 1)
      await useTaskboardStore.getState().add(id, 2)
      await useTaskboardStore.getState().add(id, 3)

      await useTaskboardStore.getState().reorder(id, 2, 0)

      const entries = useTaskboardStore.getState().getEntries(id)
      expect(entries.map((e) => e.todoId)).toEqual([3, 1, 2])
    })
  })
})
