import { useState } from 'react'
import type { UnsupportedDBInfo, UnsupportedImportInfo } from '../../services/migration-check'
import { exportCurrentDatabase } from '../../services/migration-check'
import { OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { buildExportData } from '../../services/export-import'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { getSaveFilePicker } from '../../utils/file-picker'
import { OBJECT_URL_REVOKE_MS } from '../../constants'
import styles from './MigrationDialog.module.css'

interface SchemaUpgradeProps {
  mode: 'schema-upgrade'
  info: UnsupportedDBInfo
  onProceed: () => void
}

interface LegacyImportProps {
  mode: 'legacy-import'
  info: UnsupportedImportInfo
  onProceed: () => void
  onCancel: () => void
}

type MigrationDialogProps = SchemaUpgradeProps | LegacyImportProps

export function MigrationDialog(props: MigrationDialogProps) {
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      let json: string
      if (props.mode === 'schema-upgrade') {
        json = await exportCurrentDatabase(props.info.currentVersion)
      } else {
        const data = await buildExportData()
        json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      const filename = `todo2-pre-migration-${timestamp}.json`

      const showSaveFilePicker = getSaveFilePicker()
      if (showSaveFilePicker) {
        try {
          const handle = await showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          })
          const writable = await handle.createWritable()
          await writable.write(json)
          await writable.close()
          setExported(true)
          return
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return
        }
      }

      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS)
      setExported(true)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const handleCancel = () => {
    if (props.mode === 'legacy-import') {
      props.onCancel()
    } else {
      setCancelled(true)
    }
  }

  if (cancelled) {
    return (
      <Dialog
        open
        onClose={() => {}}
        blockBackdropClose
        title="Update required"
      >
        <DialogBody>
          TODO2 needs this database update to run. Reload the page when you're ready to proceed.
        </DialogBody>
        <DialogActions>
          <button className={styles.primaryButton} onClick={() => window.location.reload()}>
            Reload
          </button>
        </DialogActions>
      </Dialog>
    )
  }

  const title = props.mode === 'schema-upgrade'
    ? 'Database too old to load safely'
    : 'File too old to load safely'

  const body = props.mode === 'schema-upgrade'
    ? `Your on-disk database is at version ${props.info.currentVersion}. This build only supports databases at version ${OLDEST_SUPPORTED_DB_VERSION} or newer — translators for older versions have been removed. Proceeding upgrades the schema to version ${props.info.targetVersion}, but stale fields from the older shape stay in the records and may not be readable here. After the upgrade, the Data Integrity audit in Settings can sweep up any rows the current schema does not recognize. Some data may be permanently inaccessible.`
    : props.info.sourceVersion != null
      ? `The file you are loading is at schema version ${props.info.sourceVersion}. This build only supports imports at version ${OLDEST_SUPPORTED_DB_VERSION} or newer — translators for older versions have been removed. Proceeding will drop any fields the current schema does not recognize. Some data in this file may be lost.`
      : `The file you are loading is in an earlier format that this build no longer supports. Proceeding will drop any fields the current schema does not recognize. Some data in this file may be lost.`

  return (
    <Dialog
      open
      onClose={handleCancel}
      blockBackdropClose
      size="md"
      title={title}
    >
      <DialogBody>{body}</DialogBody>
      <div className={styles.exportSection}>
        <div className={styles.exportHint}>
          Export a backup before continuing — this is your only path back.
        </div>
        <button
          className={styles.primaryButton}
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : exported ? 'Exported!' : 'Export backup'}
        </button>
        {exportError && <div className={styles.exportError}>{exportError}</div>}
      </div>
      <DialogActions>
        <button className={styles.cancelButton} onClick={handleCancel}>
          Cancel
        </button>
        <button className={styles.primaryButton} onClick={props.onProceed}>
          {props.mode === 'schema-upgrade' ? 'Apply update' : 'Proceed'}
        </button>
      </DialogActions>
    </Dialog>
  )
}
