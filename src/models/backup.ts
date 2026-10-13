/**
 * What made a backup: `auto` — the daily automatic snapshot (and the one at
 * startup when that is due); `manual` — Settings → Backups → Create Backup
 * Now; `pre-destructive` — the database before a destructive operation
 * (import, restore, purge, bulk delete, the sync file loaded over browser
 * data); `sync-file` — the sync file's raw text before the file is
 * rewritten or overwritten. Each kind keeps its own newest few
 * (`services/backup-scheduler`).
 */
export type BackupTrigger = 'auto' | 'manual' | 'pre-destructive' | 'sync-file'

export interface Backup {
  id?: number
  createdAt: string
  trigger: BackupTrigger
  sizeBytes: number
  data: string // serialized JSON snapshot
}
