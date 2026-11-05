import { useEffect, useRef, useState } from 'react'
import type { TooNewDBInfo } from '../../services/migration-check'
import { onDatabaseChangedElsewhere, tooNewDatabaseMessage, tooOldDatabaseMessage, type DatabaseChangeElsewhere } from '../../data/database'
import type { ImportData } from '../../data/import-validation'
import { readRawDatabaseExport, replaceUnreadableDatabase } from '../../data/old-database'
import { exportFileTimestamp, readImportFile } from '../../services/data-files'
import { downloadTextFile } from '../../services/save-file'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import styles from './DatabaseVersionDialog.module.css'

/**
 * The browser's database was saved by a newer version of TODO2: this one
 * reads and writes none of it — the only way on is the newer version
 * (Reload). Nothing to close.
 */
export function DatabaseTooNewDialog({ info }: { info: TooNewDBInfo }) {
  return (
    <Dialog open onClose={() => {}} blockBackdropClose size="md" title="Data from a newer version of TODO2">
      <DialogBody>
        {tooNewDatabaseMessage(info.storedVersion, info.buildVersion)} If the newer version is open in another tab, use that one.
      </DialogBody>
      <DialogActions>
        <button className={styles.primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Another tab upgraded the database (a newer TODO2 opened it) or deleted it
 * while this tab had it open: this tab's connection is closed and nothing it
 * writes from now on is saved, so the page is blocked until a Reload
 * (`onDatabaseChangedElsewhere`). Mounted for the app's lifetime; renders
 * nothing until then.
 */
export function DatabaseChangedElsewhereGuard() {
  const [change, setChange] = useState<DatabaseChangeElsewhere | null>(null)
  useEffect(() => onDatabaseChangedElsewhere((c) => setChange((prev) => prev ?? c)), [])
  if (!change) return null
  const what = change === 'upgraded'
    ? 'A newer version of TODO2 opened this browser’s data in another tab or window.'
    : 'This browser’s TODO2 data was deleted or replaced in another tab or window.'
  return (
    <Dialog open onClose={() => {}} blockBackdropClose size="md" title="TODO2 changed in another tab">
      <DialogBody>
        {what} This tab can’t save any more: reload it to go on with the data as it is now.
      </DialogBody>
      <DialogActions>
        <button className={styles.primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </DialogActions>
    </Dialog>
  )
}

/** A file picked to replace the browser's data, read and checked (`prepareImport`). */
interface PickedFile {
  name: string
  data: ImportData
  warnings: string[]
}

/**
 * The browser's database is below the floor (`storedVersion` `null` when
 * only its open told): this version reads and writes none of it — the
 * message names the build that still upgrades it. The ways on from here:
 * **Download this data** (the old data as a file, read raw — the older
 * build imports it), **Import a file…** (an export or backup replaces the
 * browser's data; it asks first, with the download beside Replace, since the
 * old data is deleted), or Reload. Nothing to close.
 */
export function DatabaseTooOldDialog({ info }: { info: { storedVersion: number | null; floorVersion?: number } }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<'download' | 'replace' | null>(null)
  const [downloaded, setDownloaded] = useState(false)

  const download = async () => {
    setBusy('download')
    setProblem(null)
    try {
      const old = await readRawDatabaseExport()
      if (!old) {
        setProblem('There is no data in this browser to download.')
        return
      }
      downloadTextFile(old.json, `todo2-old-data-v${old.storedVersion}-${exportFileTimestamp()}.json`, 'application/json')
      setDownloaded(true)
    } catch (err) {
      setProblem(`The data could not be downloaded — ${err instanceof Error ? err.message : 'it could not be read'}.`)
    } finally {
      setBusy(null)
    }
  }

  const pick = async (file: File) => {
    setProblem(null)
    try {
      const result = await readImportFile(file)
      if (!result.ok) {
        setProblem(result.reason === 'file-too-large'
          ? 'That file is too large (50 MB max).'
          : `That file can’t be imported — ${result.error}`)
        return
      }
      setPicked({ name: file.name, data: result.data, warnings: result.warnings })
    } catch (err) {
      setProblem(`That file can’t be imported — ${err instanceof Error ? err.message : 'it could not be read'}.`)
    }
  }

  const replace = async (file: PickedFile) => {
    setBusy('replace')
    setProblem(null)
    try {
      await replaceUnreadableDatabase(file.data)
      window.location.reload()
    } catch (err) {
      setBusy(null)
      setProblem(`The import failed — ${err instanceof Error ? err.message : 'the data could not be written'}. Reload and try again.`)
    }
  }

  const taskCount = picked?.data.todos.length ?? 0
  return (
    <Dialog open onClose={() => {}} blockBackdropClose size="md" title="Data from an older version of TODO2">
      {picked ? (
        <DialogBody>
          <p className={styles.paragraph}>
            Replace this browser’s data with <strong>{picked.name}</strong> ({taskCount} {taskCount === 1 ? 'task' : 'tasks'})?
          </p>
          <p className={styles.paragraph}>
            The data in this browser now — which this version can’t read — will be deleted, its automatic backups too.
            {downloaded ? ' You downloaded a copy of it.' : ' Download it first to keep a copy.'}
          </p>
          {picked.warnings.length > 0 && <p className={styles.note}>{picked.warnings.join(' ')}</p>}
          {problem && <p className={styles.problem} role="alert">{problem}</p>}
        </DialogBody>
      ) : (
        <DialogBody>
          <p className={styles.paragraph}>{tooOldDatabaseMessage(info.storedVersion, info.floorVersion)}</p>
          <p className={styles.paragraph}>Or start from a file: import a TODO2 export or backup. It replaces the data in this browser.</p>
          {downloaded && <p className={styles.note}>Downloaded the data in this browser.</p>}
          {problem && <p className={styles.problem} role="alert">{problem}</p>}
        </DialogBody>
      )}
      <DialogActions>
        <button type="button" className={styles.secondaryButton} onClick={() => void download()} disabled={busy !== null}>
          {busy === 'download' ? 'Downloading…' : 'Download this data'}
        </button>
        <span className={styles.spacer} />
        {picked ? (
          <>
            <button type="button" className={styles.secondaryButton} onClick={() => { setPicked(null); setProblem(null) }} disabled={busy !== null}>
              Cancel
            </button>
            <button type="button" className={styles.dangerButton} onClick={() => void replace(picked)} disabled={busy !== null}>
              {busy === 'replace' ? 'Importing…' : 'Replace'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.secondaryButton} onClick={() => fileInputRef.current?.click()} disabled={busy !== null}>
              Import a file…
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => window.location.reload()}>
              Reload
            </button>
          </>
        )}
      </DialogActions>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pick(file)
        }}
      />
    </Dialog>
  )
}
