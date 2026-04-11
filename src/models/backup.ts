export type BackupTrigger = 'auto' | 'manual' | 'pre-destructive'

export interface Backup {
  id?: number
  createdAt: string
  trigger: BackupTrigger
  sizeBytes: number
  data: string // serialized JSON snapshot
}
