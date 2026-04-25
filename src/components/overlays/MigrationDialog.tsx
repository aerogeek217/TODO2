import { useState } from 'react'
import type { MigrationInfo, LegacyImportInfo } from '../../services/migration-check'
import { exportCurrentDatabase } from '../../services/migration-check'
import { buildExportData } from '../../services/export-import'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import styles from './MigrationDialog.module.css'

interface SchemaUpgradeProps {
  mode: 'schema-upgrade'
  info: MigrationInfo
  onProceed: () => void
}

interface LegacyImportProps {
  mode: 'legacy-import'
  info: LegacyImportInfo
  onProceed: () => void
  onCancel: () => void
}

type MigrationDialogProps = SchemaUpgradeProps | LegacyImportProps

export function MigrationDialog(props: MigrationDialogProps) {
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const descriptions = props.mode === 'schema-upgrade'
    ? props.info.migrations.map(m => m.description)
    : props.info.descriptions

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

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as unknown as { showSaveFilePicker: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
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
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
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

  return (
    <Dialog
      open
      onClose={handleCancel}
      blockBackdropClose
      size="md"
      title={props.mode === 'schema-upgrade' ? 'Database update required' : 'Data migration required'}
    >
      <DialogBody>
        {props.mode === 'schema-upgrade'
          ? `Your database needs to be updated from version ${props.info.currentVersion} to version ${props.info.targetVersion}.`
          : 'The data you are loading contains legacy fields that will be converted.'}
      </DialogBody>
      <div className={styles.changeList}>
        {descriptions.map((desc, i) => (
          <div key={i} className={styles.changeItem}>
            {desc}
          </div>
        ))}
      </div>
      <div className={styles.exportSection}>
        <div className={styles.exportHint}>
          We recommend exporting a backup before proceeding.
        </div>
        <button
          className={styles.exportButton}
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
          Apply update
        </button>
      </DialogActions>
    </Dialog>
  )
}
