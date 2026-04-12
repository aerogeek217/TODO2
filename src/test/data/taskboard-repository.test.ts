import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { taskboardRepository } from '../../data/taskboard-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('taskboardRepository', () => {
  describe('getAll', () => {
    it('returns entries sorted by sortOrder', async () => {
      await db.taskboardEntries.bulkAdd([
        { todoId: 10, sortOrder: 3000 },
        { todoId: 20, sortOrder: 1000 },
        { todoId: 30, sortOrder: 2000 },
      ])

      const entries = await taskboardRepository.getAll()
      expect(entries.map(e => e.todoId)).toEqual([20, 30, 10])
    })

    it('returns empty array when no entries', async () => {
      const entries = await taskboardRepository.getAll()
      expect(entries).toEqual([])
    })
  })

  describe('findByTodoId', () => {
    it('returns the entry matching the todoId', async () => {
      await db.taskboardEntries.add({ todoId: 42, sortOrder: 1000 })

      const entry = await taskboardRepository.findByTodoId(42)
      expect(entry).toBeDefined()
      expect(entry!.todoId).toBe(42)
    })

    it('returns undefined for non-existent todoId', async () => {
      const entry = await taskboardRepository.findByTodoId(999)
      expect(entry).toBeUndefined()
    })
  })

  describe('addEntry', () => {
    it('adds entry with sortOrder after the highest existing', async () => {
      await db.taskboardEntries.add({ todoId: 1, sortOrder: 2000 })

      const id = await taskboardRepository.addEntry(5)

      const entry = await db.taskboardEntries.get(id)
      expect(entry).toBeDefined()
      expect(entry!.todoId).toBe(5)
      expect(entry!.sortOrder).toBe(3000) // 2000 + 1000
    })

    it('adds first entry with sortOrder 1000', async () => {
      const id = await taskboardRepository.addEntry(1)

      const entry = await db.taskboardEntries.get(id)
      expect(entry!.sortOrder).toBe(1000) // 0 + 1000
    })
  })

  describe('removeByTodoId', () => {
    it('removes the entry with the given todoId', async () => {
      await db.taskboardEntries.add({ todoId: 7, sortOrder: 1000 })

      await taskboardRepository.removeByTodoId(7)

      const entry = await taskboardRepository.findByTodoId(7)
      expect(entry).toBeUndefined()
    })

    it('does not affect other entries', async () => {
      await db.taskboardEntries.bulkAdd([
        { todoId: 1, sortOrder: 1000 },
        { todoId: 2, sortOrder: 2000 },
      ])

      await taskboardRepository.removeByTodoId(1)

      const entries = await taskboardRepository.getAll()
      expect(entries).toHaveLength(1)
      expect(entries[0].todoId).toBe(2)
    })
  })

  describe('reorder', () => {
    it('updates sortOrder for specified entries', async () => {
      const id1 = await db.taskboardEntries.add({ todoId: 1, sortOrder: 1000 })
      const id2 = await db.taskboardEntries.add({ todoId: 2, sortOrder: 2000 })

      await taskboardRepository.reorder([
        { id: id1, sortOrder: 2000 },
        { id: id2, sortOrder: 1000 },
      ])

      const entries = await taskboardRepository.getAll()
      expect(entries[0].todoId).toBe(2) // sortOrder 1000 first
      expect(entries[1].todoId).toBe(1) // sortOrder 2000 second
    })
  })
})
