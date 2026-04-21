import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTaskboardStore } from '../../stores/taskboard-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTaskboardStore.setState({ board: null, loading: false, error: null })
})

describe('useTaskboardStore (singleton)', () => {
  async function seedBoard(entries: { todoId: number; sortOrder: number }[] = []): Promise<number> {
    const now = new Date()
    const id = (await db.taskboards.add({ entries, createdAt: now, updatedAt: now } as never)) as number
    await useTaskboardStore.getState().load()
    return id
  }

  describe('load', () => {
    it('loads the single taskboard row', async () => {
      await seedBoard([{ todoId: 10, sortOrder: 1000 }])
      const { board } = useTaskboardStore.getState()
      expect(board?.entries[0].todoId).toBe(10)
    })

    it('leaves board null when no row exists', async () => {
      await useTaskboardStore.getState().load()
      expect(useTaskboardStore.getState().board).toBeNull()
    })
  })

  describe('ensureLoaded', () => {
    it('seeds an empty row when the table is empty', async () => {
      const row = await useTaskboardStore.getState().ensureLoaded()
      expect(row.id).toBeDefined()
      expect(row.entries).toEqual([])
      expect((await db.taskboards.count())).toBe(1)
    })

    it('returns the existing row when present', async () => {
      const id = await seedBoard([{ todoId: 5, sortOrder: 1000 }])
      const row = await useTaskboardStore.getState().ensureLoaded()
      expect(row.id).toBe(id)
    })
  })

  describe('add', () => {
    it('adds a new entry', async () => {
      await seedBoard()
      await useTaskboardStore.getState().add(42)
      expect(useTaskboardStore.getState().getEntries()).toEqual([{ todoId: 42, sortOrder: 1000 }])
    })

    it('does not add duplicate todoId', async () => {
      await seedBoard()
      await useTaskboardStore.getState().add(42)
      await useTaskboardStore.getState().add(42)
      expect(useTaskboardStore.getState().getEntries()).toHaveLength(1)
    })

    it('seeds the board on first add when none exists', async () => {
      await useTaskboardStore.getState().add(7)
      expect(useTaskboardStore.getState().getEntries()).toEqual([{ todoId: 7, sortOrder: 1000 }])
      expect((await db.taskboards.count())).toBe(1)
    })
  })

  describe('removeEntry', () => {
    it('removes an entry from the store and database', async () => {
      const id = await seedBoard()
      await useTaskboardStore.getState().add(42)
      await useTaskboardStore.getState().removeEntry(42)
      expect(useTaskboardStore.getState().getEntries()).toHaveLength(0)
      const row = await db.taskboards.get(id)
      expect(row?.entries).toEqual([])
    })

    it('does nothing when todoId not in taskboard', async () => {
      await seedBoard()
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().removeEntry(999)
      expect(useTaskboardStore.getState().getEntries()).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('removes all entries', async () => {
      const id = await seedBoard()
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().add(2)
      await useTaskboardStore.getState().clear()
      expect(useTaskboardStore.getState().getEntries()).toHaveLength(0)
      const row = await db.taskboards.get(id)
      expect(row?.entries).toEqual([])
    })

    it('is a no-op on an empty board', async () => {
      await seedBoard()
      await useTaskboardStore.getState().clear()
      expect(useTaskboardStore.getState().getEntries()).toEqual([])
    })
  })

  describe('has', () => {
    it('returns true when todoId is on the board', async () => {
      await seedBoard()
      await useTaskboardStore.getState().add(42)
      expect(useTaskboardStore.getState().has(42)).toBe(true)
    })
    it('returns false otherwise', async () => {
      await seedBoard()
      expect(useTaskboardStore.getState().has(999)).toBe(false)
    })
  })

  describe('addAt', () => {
    it('normalizes sortOrders when consecutive values collide', async () => {
      await seedBoard([
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 1001 },
      ])
      await useTaskboardStore.getState().addAt(30, 1)
      const entries = useTaskboardStore.getState().getEntries()
      expect(entries.map((e) => e.todoId)).toEqual([10, 30, 20])
      expect(entries[0].sortOrder).toBeLessThan(entries[1].sortOrder)
      expect(entries[1].sortOrder).toBeLessThan(entries[2].sortOrder)
    })

    it('addAt without collision does not normalize', async () => {
      await seedBoard([
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 3000 },
      ])
      await useTaskboardStore.getState().addAt(30, 1)
      const entries = useTaskboardStore.getState().getEntries()
      expect(entries.map((e) => e.todoId)).toEqual([10, 30, 20])
      expect(entries[1].sortOrder).toBe(2000)
    })
  })

  describe('reorder', () => {
    it('moves an entry from one position to another', async () => {
      await seedBoard()
      await useTaskboardStore.getState().add(1)
      await useTaskboardStore.getState().add(2)
      await useTaskboardStore.getState().add(3)

      await useTaskboardStore.getState().reorder(2, 0)

      const entries = useTaskboardStore.getState().getEntries()
      expect(entries.map((e) => e.todoId)).toEqual([3, 1, 2])
    })
  })
})
