import { useEffect, useRef, useState } from 'react'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { prepareImportText } from '../../../data/import-pipeline'
import type { UnsupportedImportInfo } from '../../../services/migration-check'
import { MigrationDialog } from '../../overlays/MigrationDialog'
import { BYTES_PER_KB } from '../../../constants'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

/** Automatic and manual snapshots of the database: restore, delete, create. */
export function BackupsSection() {
  const backups = useFileOpsStore((s) => s.backups)
  const loadBackups = useFileOpsStore((s) => s.loadBackups)
  const createBackup = useFileOpsStore((s) => s.createBackup)
  const deleteBackup = useFileOpsStore((s) => s.deleteBackup)
  const peekBackupData = useFileOpsStore((s) => s.peekBackupData)
  const restoreBackup = useFileOpsStore((s) => s.restoreBackup)
  const [message, setMessage] = useState('')
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null)
  const [pendingMigration, setPendingMigration] = useState<{ info: UnsupportedImportInfo; action: () => Promise<void> } | null>(null)
  const timer = useRef<number | null>(null)
  useStackedLayer(pendingMigration !== null)

  useEffect(() => {
    void loadBackups()
  }, [loadBackups])
  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current) }, [])

  const showMessage = (msg: string, ms: number) => {
    setMessage(msg)
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), ms)
  }

  const restore = async (id: number) => {
    setConfirmRestoreId(null)
    const data = await peekBackupData(id)
    if (!data) { showMessage('Backup not found', 3000); return }
    const runRestore = async () => {
      const result = await restoreBackup(id)
      showMessage(result.ok ? 'Restored successfully!' : `Restore failed: ${result.error}`, 3000)
    }
    // Same pipeline as the restore itself; checked up front so a below-floor
    // snapshot prompts first.
    const prepared = prepareImportText(data)
    if (prepared.ok && prepared.legacy) {
      setPendingMigration({ info: prepared.legacy, action: runRestore })
      return
    }
    await runRestore()
  }

  return (
    <div className={styles.section}>
      {backups.length === 0 ? (
        <div className={styles.muted}>No backups yet. Backups are created automatically every 24 hours and before destructive operations.</div>
      ) : (
        <div className={styles.backupList}>
          {backups.map((b) => (
            <div key={b.id} className={styles.backupRow}>
              <span className={styles.backupTime}>{new Date(b.createdAt).toLocaleString()}</span>
              <span className={`${styles.backupBadge}${b.trigger === 'pre-destructive' ? ` ${styles.backupBadgeDestructive}` : ''}`}>
                {b.trigger === 'pre-destructive' ? 'pre-op' : b.trigger}
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
            await createBackup('manual')
            showMessage('Backup created!', 2000)
          }}
        >
          Create Backup Now
        </button>
      </div>
      {message && <div className={styles.successMsg}>{message}</div>}

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
