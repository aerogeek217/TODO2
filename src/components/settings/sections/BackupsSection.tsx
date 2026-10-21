import { useEffect, useState } from 'react'
import { useFlashMessage } from '../../../hooks/use-flash-message'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { legacyImportInfo } from '../../../services/data-files'
import type { UnsupportedImportInfo } from '../../../data/file-version'
import { MigrationDialog } from '../../overlays/MigrationDialog'
import { BYTES_PER_KB } from '../../../constants'
import type { BackupTrigger } from '../../../models'
import { NO_BACKUP_NOTE } from '../../../stores/safety-snapshot'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'
import { restoreBackup } from '../../../services/replace-data'

const TRIGGER_LABEL: Record<BackupTrigger, string> = {
  auto: 'auto',
  manual: 'manual',
  'pre-destructive': 'pre-op',
  'sync-file': 'sync file',
  'sync-file-original': 'sync file, older version',
}

/** Automatic and manual snapshots of the database: restore, delete, create. */
export function BackupsSection() {
  const backups = useFileOpsStore((s) => s.backups)
  const loadBackups = useFileOpsStore((s) => s.loadBackups)
  const createBackup = useFileOpsStore((s) => s.createBackup)
  const deleteBackup = useFileOpsStore((s) => s.deleteBackup)
  const peekBackupData = useFileOpsStore((s) => s.peekBackupData)
  const [message, flash] = useFlashMessage<{ text: string; error?: boolean } | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null)
  const [pendingMigration, setPendingMigration] = useState<{ info: UnsupportedImportInfo; action: () => Promise<void> } | null>(null)
  useStackedLayer(pendingMigration !== null)

  useEffect(() => {
    void loadBackups()
  }, [loadBackups])

  const showMessage = (text: string, ms: number, error = false) => flash({ text, error }, ms)

  const restore = async (id: number) => {
    setConfirmRestoreId(null)
    const data = await peekBackupData(id)
    if (!data) { showMessage('Backup not found', 3000); return }
    const runRestore = async () => {
      const result = await restoreBackup(id)
      if (result.status === 'error') showMessage(`Restore failed: ${result.error}`, 3000)
      else if (result.status === 'cancelled') showMessage('Restore cancelled — nothing changed.', 4000)
      else if (result.noBackup) showMessage(`Restored. ${NO_BACKUP_NOTE}`, 8000)
      else showMessage('Restored successfully! The data it replaced was backed up first.', 5000)
    }
    // Same pipeline as the restore itself; checked up front so a below-floor
    // snapshot prompts first.
    const legacy = legacyImportInfo(data)
    if (legacy) {
      setPendingMigration({ info: legacy, action: runRestore })
      return
    }
    await runRestore()
  }

  return (
    <div className={styles.section}>
      {backups.length === 0 ? (
        <div className={styles.muted}>No backups yet. Backups are created automatically every 24 hours, before destructive operations, and before the sync file is rewritten.</div>
      ) : (
        <div className={styles.backupList}>
          {backups.map((b) => (
            <div key={b.id} className={styles.backupRow} data-trigger={b.trigger}>
              <span className={styles.backupTime}>{new Date(b.createdAt).toLocaleString()}</span>
              <span className={`${styles.backupBadge}${b.trigger === 'pre-destructive' || b.trigger === 'sync-file' || b.trigger === 'sync-file-original' ? ` ${styles.backupBadgeDestructive}` : ''}`}>
                {TRIGGER_LABEL[b.trigger]}
              </span>
              <span className={styles.backupSize}>
                {b.sizeBytes < BYTES_PER_KB ? `${b.sizeBytes} B` : `${Math.round(b.sizeBytes / BYTES_PER_KB)} KB`}
              </span>
              <div className={styles.backupActions}>
                {confirmRestoreId === b.id ? (
                  <>
                    <button type="button" className={styles.backupBtn} onClick={() => { void restore(b.id) }}>Confirm</button>
                    <button type="button" className={styles.backupBtn} onClick={() => setConfirmRestoreId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={styles.backupBtn} onClick={() => setConfirmRestoreId(b.id)}>Restore</button>
                    <button
                      type="button"
                      className={`${styles.backupBtn} ${styles.backupBtnDanger}`}
                      onClick={() => { void deleteBackup(b.id) }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={async () => {
            try {
              await createBackup()
              showMessage('Backup created!', 2000)
            } catch (err) {
              console.warn('[backup] manual backup failed', err)
              showMessage('The backup could not be saved — browser storage may be full.', 8000, true)
            }
          }}
        >
          Create Backup Now
        </button>
      </div>
      {message && <div className={message.error ? styles.errorMsg : styles.successMsg} role={message.error ? 'alert' : undefined}>{message.text}</div>}

      {pendingMigration && (
        <MigrationDialog
          mode="legacy-import"
          info={pendingMigration.info}
          onProceed={async () => {
            const action = pendingMigration.action
            setPendingMigration(null)
            await action()
          }}
          onCancel={() => setPendingMigration(null)}
        />
      )}
    </div>
  )
}
