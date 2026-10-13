import { db } from './database'
import { buildExportData, selfCheckExportJson } from '../services/export-import'
import type { Backup, BackupTrigger } from '../models'

export interface BackupSummary {
  id: number
  createdAt: string
  trigger: BackupTrigger
  sizeBytes: number
}

type SnapshotWarningListener = (message: string) => void
const snapshotWarningListeners = new Set<SnapshotWarningListener>()

/**
 * Subscribes `listener` to backup warnings (`reportSnapshotWarning`);
 * returns its unsubscribe. `file-ops-store` subscribes for the app's
 * lifetime and `FileSyncBanner` surfaces the warning. Each subscriber only
 * removes itself, so another subscriber coming and going can't silence it.
 */
function onSnapshotWarning(listener: SnapshotWarningListener): () => void {
  snapshotWarningListeners.add(listener)
  return () => { snapshotWarningListeners.delete(listener) }
}

/**
 * Raises a backup warning: a snapshot that would not restore, or a
 * destructive operation the user let go ahead without a backup
 * (`services/safety-snapshot`).
 */
function reportSnapshotWarning(message: string): void {
  for (const listener of snapshotWarningListeners) listener(message)
}

async function createSnapshot(trigger: BackupTrigger): Promise<number> {
  const tables = await buildExportData()
  const data = JSON.stringify(tables)
  // The snapshot is still saved — a partially-restorable backup beats none —
  // but a backup that would fail to restore must not fail silently.
  const problem = selfCheckExportJson(data)
  if (problem) {
    const message = `Backup snapshot (${trigger}) would not restore: ${problem}`
    console.warn(`[backup] ${message}`)
    reportSnapshotWarning(message)
  }
  const backup: Backup = {
    createdAt: new Date().toISOString(),
    trigger,
    sizeBytes: new Blob([data]).size,
    data,
  }
  return await db.backups.add(backup) as number
}

/**
 * Stores arbitrary already-serialized data (e.g. a sync file's raw text,
 * about to be overwritten with browser data) as a snapshot. No self-check —
 * the content may be unreadable by this build; preserving it is the point.
 * Restoring it later goes through the normal import pipeline.
 */
async function createSnapshotFromJson(data: string, trigger: BackupTrigger): Promise<number> {
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
  onSnapshotWarning,
  reportSnapshotWarning,
  createSnapshot,
  createSnapshotFromJson,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  pruneSnapshots,
}
