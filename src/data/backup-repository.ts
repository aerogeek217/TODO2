import { db } from './database'
import { parseAndRestore } from './restore'
import { buildExportData } from '../services/export-import'
import type { Backup, BackupTrigger } from '../models'

export interface BackupSummary {
  id: number
  createdAt: string
  trigger: BackupTrigger
  sizeBytes: number
}

async function createSnapshot(trigger: BackupTrigger): Promise<number> {
  const tables = await buildExportData()
  const data = JSON.stringify(tables)
  const backup: Backup = {
    createdAt: new Date().toISOString(),
    trigger,
    sizeBytes: new Blob([data]).size,
    data,
  }
  return await db.backups.add(backup) as number
}

async function listSnapshots(): Promise<BackupSummary[]> {
  const summaries: BackupSummary[] = []
  await db.backups.orderBy('createdAt').reverse().each(({ id, createdAt, trigger, sizeBytes }) => {
    summaries.push({ id: id!, createdAt, trigger, sizeBytes })
  })
  return summaries
}

async function getSnapshot(id: number): Promise<Backup | undefined> {
  return await db.backups.get(id)
}

async function restoreSnapshot(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const backup = await db.backups.get(id)
  if (!backup) return { ok: false, error: 'Backup not found' }

  return await parseAndRestore(backup.data)
}

async function deleteSnapshot(id: number): Promise<void> {
  await db.backups.delete(id)
}

async function pruneSnapshots(keepCount: number): Promise<number> {
  const allIds: number[] = []
  await db.backups.orderBy('createdAt').reverse().eachPrimaryKey((id) => {
    allIds.push(id as number)
  })
  if (allIds.length <= keepCount) return 0

  const toDelete = allIds.slice(keepCount)
  await db.backups.bulkDelete(toDelete)
  return toDelete.length
}

export const backupRepository = {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  pruneSnapshots,
}
