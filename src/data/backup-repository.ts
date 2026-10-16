import { db } from './database'
import { buildExportData, selfCheckExportJson } from './export-data'
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

/**
 * Deletes all but the newest `keepCount` backups made by `trigger` (newest =
 * most recently stored); other kinds are never touched. Returns how many
 * were deleted. Reads keys only, never the snapshot data.
 */
async function pruneSnapshots(trigger: BackupTrigger, keepCount: number): Promise<number> {
  const ids = (await db.backups.where('trigger').equals(trigger).primaryKeys()) as number[]
  if (ids.length <= keepCount) return 0
  const toDelete = ids.sort((a, b) => b - a).slice(keepCount)
  await db.backups.bulkDelete(toDelete)
  return toDelete.length
}

/**
 * When the newest backup made by `trigger` was taken, or `null` if there is
 * none. Reads index keys only, never the snapshot data.
 */
async function newestSnapshotAt(trigger: BackupTrigger): Promise<Date | null> {
  return db.transaction('r', db.backups, async () => {
    const ofTrigger = new Set(await db.backups.where('trigger').equals(trigger).primaryKeys())
    if (ofTrigger.size === 0) return null
    // The createdAt index's keys and their rows' ids, in the same order.
    const times = await db.backups.orderBy('createdAt').keys()
    const ids = await db.backups.orderBy('createdAt').primaryKeys()
    for (let i = ids.length - 1; i >= 0; i--) {
      if (ofTrigger.has(ids[i] as number)) return new Date(String(times[i]))
    }
    return null
  })
}

/** Whether the newest backup made by `trigger` holds exactly `data` (reads that one row). */
async function newestSnapshotDataIs(trigger: BackupTrigger, data: string): Promise<boolean> {
  const ids = (await db.backups.where('trigger').equals(trigger).primaryKeys()) as number[]
  if (ids.length === 0) return false
  const newest = await db.backups.get(Math.max(...ids))
  return newest?.data === data
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
  newestSnapshotAt,
  newestSnapshotDataIs,
}
