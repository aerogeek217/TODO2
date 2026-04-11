import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('backupRepository', () => {
  async function seedDb() {
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1, createdAt: new Date('2025-01-01') } as any)
    await db.todos.add(makeTodo({ id: 1, canvasId }))
    return canvasId
  }

  describe('createSnapshot', () => {
    it('createSnapshot_emptyDb_returnsNumericId', async () => {
      const id = await backupRepository.createSnapshot('auto')
      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThan(0)
    })

    it('createSnapshot_withData_storesBackupWithCorrectTrigger', async () => {
      await seedDb()
      const id = await backupRepository.createSnapshot('pre-destructive')
      const backup = await db.backups.get(id)
      expect(backup).toBeDefined()
      expect(backup!.trigger).toBe('pre-destructive')
    })

    it('createSnapshot_withData_storesSerializedJson', async () => {
      await seedDb()
      const id = await backupRepository.createSnapshot('auto')
      const backup = await db.backups.get(id)
      const parsed = JSON.parse(backup!.data)
      expect(parsed.todos).toHaveLength(1)
      expect(parsed.canvases).toHaveLength(1)
    })

    it('createSnapshot_recordsSizeBytes', async () => {
      const id = await backupRepository.createSnapshot('auto')
      const backup = await db.backups.get(id)
      expect(backup!.sizeBytes).toBeGreaterThan(0)
    })

    it('createSnapshot_setsCreatedAtToIsoString', async () => {
      const before = new Date().toISOString()
      const id = await backupRepository.createSnapshot('auto')
      const after = new Date().toISOString()
      const backup = await db.backups.get(id)
      expect(backup!.createdAt >= before).toBe(true)
      expect(backup!.createdAt <= after).toBe(true)
    })
  })

  describe('listSnapshots', () => {
    it('listSnapshots_noBackups_returnsEmptyArray', async () => {
      const list = await backupRepository.listSnapshots()
      expect(list).toHaveLength(0)
    })

    it('listSnapshots_multipleBackups_returnsNewestFirst', async () => {
      await backupRepository.createSnapshot('auto')
      await backupRepository.createSnapshot('pre-destructive')
      await backupRepository.createSnapshot('auto')

      const list = await backupRepository.listSnapshots()
      expect(list).toHaveLength(3)
      // Ordered newest-first; each entry has a createdAt string
      expect(list[0].createdAt >= list[1].createdAt).toBe(true)
    })

    it('listSnapshots_doesNotIncludeDataField', async () => {
      await backupRepository.createSnapshot('auto')
      const list = await backupRepository.listSnapshots()
      expect((list[0] as any).data).toBeUndefined()
    })

    it('listSnapshots_includesIdTriggerSizeBytesCreatedAt', async () => {
      const id = await backupRepository.createSnapshot('manual' as any)
      const list = await backupRepository.listSnapshots()
      expect(list[0].id).toBe(id)
      expect(list[0].trigger).toBe('manual')
      expect(list[0].sizeBytes).toBeGreaterThan(0)
      expect(typeof list[0].createdAt).toBe('string')
    })
  })

  describe('getSnapshot', () => {
    it('getSnapshot_existingId_returnsFullBackupWithData', async () => {
      const id = await backupRepository.createSnapshot('auto')
      const backup = await backupRepository.getSnapshot(id)
      expect(backup).toBeDefined()
      expect(backup!.id).toBe(id)
      expect(typeof backup!.data).toBe('string')
      expect(backup!.data.length).toBeGreaterThan(0)
    })

    it('getSnapshot_nonExistentId_returnsUndefined', async () => {
      const backup = await backupRepository.getSnapshot(9999)
      expect(backup).toBeUndefined()
    })
  })

  describe('restoreSnapshot', () => {
    it('restoreSnapshot_validSnapshot_returnsOkTrue', async () => {
      await seedDb()
      const id = await backupRepository.createSnapshot('auto')
      const result = await backupRepository.restoreSnapshot(id)
      expect(result.ok).toBe(true)
    })

    it('restoreSnapshot_validSnapshot_restoresDataToDb', async () => {
      await seedDb()
      const id = await backupRepository.createSnapshot('auto')

      // Clear the DB between snapshot and restore
      await db.todos.clear()
      await db.canvases.clear()

      const result = await backupRepository.restoreSnapshot(id)
      expect(result.ok).toBe(true)
      const todos = await db.todos.toArray()
      expect(todos).toHaveLength(1)
    })

    it('restoreSnapshot_nonExistentId_returnsOkFalseWithError', async () => {
      const result = await backupRepository.restoreSnapshot(9999)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })

    it('restoreSnapshot_corruptedData_returnsOkFalseWithError', async () => {
      const id = await db.backups.add({
        createdAt: new Date().toISOString(),
        trigger: 'auto',
        sizeBytes: 5,
        data: 'NOT_JSON{{{',
      } as any) as number
      const result = await backupRepository.restoreSnapshot(id)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeTruthy()
      }
    })
  })

  describe('deleteSnapshot', () => {
    it('deleteSnapshot_existingSnapshot_removesIt', async () => {
      const id = await backupRepository.createSnapshot('auto')
      await backupRepository.deleteSnapshot(id)
      const backup = await backupRepository.getSnapshot(id)
      expect(backup).toBeUndefined()
    })

    it('deleteSnapshot_nonExistentId_doesNotThrow', async () => {
      await expect(backupRepository.deleteSnapshot(9999)).resolves.toBeUndefined()
    })
  })

  describe('pruneSnapshots', () => {
    it('pruneSnapshots_belowKeepCount_removesNothing', async () => {
      await backupRepository.createSnapshot('auto')
      await backupRepository.createSnapshot('auto')
      const removed = await backupRepository.pruneSnapshots(5)
      expect(removed).toBe(0)
      const list = await backupRepository.listSnapshots()
      expect(list).toHaveLength(2)
    })

    it('pruneSnapshots_aboveKeepCount_removesOldest', async () => {
      for (let i = 0; i < 5; i++) {
        await backupRepository.createSnapshot('auto')
      }
      const removed = await backupRepository.pruneSnapshots(3)
      expect(removed).toBe(2)
      const list = await backupRepository.listSnapshots()
      expect(list).toHaveLength(3)
    })

    it('pruneSnapshots_exactlyKeepCount_removesNothing', async () => {
      await backupRepository.createSnapshot('auto')
      await backupRepository.createSnapshot('auto')
      const removed = await backupRepository.pruneSnapshots(2)
      expect(removed).toBe(0)
    })

    it('pruneSnapshots_emptyDb_returnsZero', async () => {
      const removed = await backupRepository.pruneSnapshots(10)
      expect(removed).toBe(0)
    })
  })
})
