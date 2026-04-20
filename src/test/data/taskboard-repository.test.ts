import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { taskboardRepository } from '../../data/taskboard-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('taskboardRepository', () => {
  describe('create + getById', () => {
    it('creates an empty board and reads it back', async () => {
      const id = await taskboardRepository.create('Work')
      const row = await taskboardRepository.getById(id)
      expect(row?.name).toBe('Work')
      expect(row?.entries).toEqual([])
      expect(row?.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('getAll', () => {
    it('returns all boards ordered by id', async () => {
      const idA = await taskboardRepository.create('A')
      const idB = await taskboardRepository.create('B')
      const all = await taskboardRepository.getAll()
      expect(all.map((t) => t.id)).toEqual([idA, idB])
    })
  })

  describe('writeEntries', () => {
    it('replaces the entries list and bumps updatedAt', async () => {
      const id = await taskboardRepository.create('Queue')
      const before = (await taskboardRepository.getById(id))!.updatedAt.getTime()
      await new Promise((r) => setTimeout(r, 2))
      await taskboardRepository.writeEntries(id, [
        { todoId: 10, sortOrder: 1000 },
        { todoId: 20, sortOrder: 2000 },
      ])
      const after = await taskboardRepository.getById(id)
      expect(after!.entries.map((e) => e.todoId)).toEqual([10, 20])
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before)
    })
  })

  describe('rename', () => {
    it('renames and bumps updatedAt, leaves entries alone', async () => {
      const id = await taskboardRepository.create('Old')
      await taskboardRepository.writeEntries(id, [{ todoId: 1, sortOrder: 1000 }])
      await taskboardRepository.rename(id, 'New')
      const row = await taskboardRepository.getById(id)
      expect(row?.name).toBe('New')
      expect(row?.entries).toHaveLength(1)
    })
  })

  describe('remove', () => {
    it('deletes the board row', async () => {
      const id = await taskboardRepository.create('Temp')
      await taskboardRepository.remove(id)
      expect(await taskboardRepository.getById(id)).toBeUndefined()
    })
  })
})
