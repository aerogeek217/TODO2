import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { taskboardRepository } from '../../data/taskboard-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('taskboardRepository (singleton)', () => {
  describe('ensureRow', () => {
    it('seeds an empty row when the table is empty after delete', async () => {
      await db.taskboards.clear()
      const row = await taskboardRepository.ensureRow()
      expect(row.id).toBeDefined()
      expect(row.entries).toEqual([])
      expect(row.createdAt).toBeInstanceOf(Date)
    })

    it('returns the existing row on repeated calls (idempotent)', async () => {
      await db.taskboards.clear()
      const first = await taskboardRepository.ensureRow()
      const second = await taskboardRepository.ensureRow()
      expect(second.id).toBe(first.id)
      expect(await db.taskboards.count()).toBe(1)
    })
  })

  describe('load', () => {
    it('returns the single row', async () => {
      await db.taskboards.clear()
      const row = await taskboardRepository.ensureRow()
      const loaded = await taskboardRepository.load()
      expect(loaded?.id).toBe(row.id)
    })

    it('returns undefined when no row exists', async () => {
      await db.taskboards.clear()
      expect(await taskboardRepository.load()).toBeUndefined()
    })
  })

  describe('writeEntries', () => {
    it('replaces the entries list and bumps updatedAt', async () => {
      await db.taskboards.clear()
      const row = await taskboardRepository.ensureRow()
      const before = row.updatedAt.getTime()
      await new Promise((r) => setTimeout(r, 2))
      await taskboardRepository.writeEntries([
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 2000 },
      ])
      const after = await taskboardRepository.load()
      expect(after!.entries.map((e) => e.todoId)).toEqual([10, 20])
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before)
    })

    it('seeds a row when none exists yet', async () => {
      await db.taskboards.clear()
      await taskboardRepository.writeEntries([{ todoId: 5, sortOrder: 1000 }])
      const row = await taskboardRepository.load()
      expect(row?.entries.map((e) => e.todoId)).toEqual([5])
    })
  })
})
