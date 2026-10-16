import { useEffect, useRef, useState } from 'react'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { MAX_IMPORT_SIZE_BYTES } from '../../../data/import-validation'
import type { ImportData } from '../../../data/import-validation'
import { prepareImportText } from '../../../data/import-pipeline'
import type { UnsupportedImportInfo } from '../../../data/file-version'
import { MigrationDialog } from '../../overlays/MigrationDialog'
import { buildExportData, selfCheckExportJson } from '../../../data/export-data'
import { buildMarkdownExport } from '../../../services/markdown-export'
import { saveLastPickerHandle } from '../../../services/file-handle-idb'
import { getOpenFilePicker } from '../../../utils/file-picker'
import { downloadedMessage, getPickerStartIn, saveTextFile } from '../../../services/save-file'
import { findAppendDuplicatesInDb, runAppendImport, type AppendCandidate, type AppendChoice } from '../../../services/append-import'
import { AppendImportDialog } from '../../overlays/AppendImportDialog'
import { NO_BACKUP_NOTE } from '../../../services/safety-snapshot'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import { plural } from './plural'
import styles from './sections.module.css'

/** Pending append import: the prepared file waiting in the duplicate picker. */
interface PendingAppend {
  fileName: string
  data: ImportData
  candidates: AppendCandidate[]
  warnings: string[]
}

/**
 * Export JSON (with a re-import self-check) / Markdown, Import JSON (full
 * restore) and Import tasks (append — the duplicate picker).
 */
/** A plain download's message stays long enough to read the file name. */
const DOWNLOADED_MESSAGE_MS = 8000

export function ImportExportSection() {
  const restoreFromImport = useFileOpsStore((s) => s.restoreFromImport)
  const [message, setMessage] = useState('')
  /** Persistent: set when the last JSON export failed its re-import self-check. */
  const [exportWarning, setExportWarning] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const appendImportRef = useRef<HTMLInputElement>(null)
  const [pendingAppend, setPendingAppend] = useState<PendingAppend | null>(null)
  const [appendBusy, setAppendBusy] = useState(false)
  const [appendError, setAppendError] = useState<string | null>(null)
  const [pendingMigration, setPendingMigration] = useState<{ info: UnsupportedImportInfo; action: () => Promise<void> } | null>(null)
  const timer = useRef<number | null>(null)
  useStackedLayer(pendingAppend !== null || pendingMigration !== null)

  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current) }, [])

  const showMessage = (msg: string, ms: number) => {
    setMessage(msg)
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), ms)
  }

  const handleExport = async () => {
    const tables = await buildExportData()
    const now = new Date()
    const data = { ...tables, exportedAt: now.toISOString() }
    const json = JSON.stringify(data, null, 2)
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')

    // Self-check: the file is saved regardless, but if it would not import
    // back, say so persistently (until dismissed / the next export).
    const problem = selfCheckExportJson(json)
    if (problem) console.warn(`[export] export would not re-import: ${problem}`)
    setExportWarning(problem)

    const fileName = `todo2-backup-${timestamp}.json`
    const saved = await saveTextFile({
      text: json,
      suggestedName: fileName,
      description: 'JSON',
      mimeType: 'application/json',
      extension: '.json',
    })
    if (saved === 'cancelled') return
    if (saved === 'downloaded') showMessage(downloadedMessage(fileName), DOWNLOADED_MESSAGE_MS)
    else showMessage('Exported!', 2000)
  }

  /** Open a JSON file via the picker, or the hidden `<input>` fallback. */
  const pickJsonFile = async (fallbackInput: HTMLInputElement | null, onFile: (file: File) => Promise<void>) => {
    const showOpenFilePicker = getOpenFilePicker()
    if (showOpenFilePicker) {
      try {
        const startIn = await getPickerStartIn()
        const [handle] = await showOpenFilePicker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          startIn,
        })
        if (!handle) return
        saveLastPickerHandle(handle).catch(() => {})
        const file = await handle.getFile()
        await onFile(file)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return // user cancelled
      }
    } else {
      fallbackInput?.click()
    }
  }

  const executeImport = async (data: ImportData, warnings: string[]) => {
    const result = await restoreFromImport(data)
    if (result.status === 'cancelled') {
      showMessage('Import cancelled — nothing changed.', 4000)
      return
    }
    const notes = [...(result.noBackup ? [NO_BACKUP_NOTE] : []), ...warnings]
    showMessage(
      notes.length > 0 ? `Imported successfully. ${notes.join(' ')}` : 'Imported successfully!',
      notes.length > 0 ? 8000 : 4000,
    )
  }

  const doImport = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        showMessage('Import failed — file too large (50 MB max).', 3000)
        return
      }
      const result = prepareImportText(await file.text())
      if (!result.ok) {
        showMessage(`Import failed — ${result.error}`, result.reason === 'invalid' ? 10000 : 5000)
        return
      }
      if (result.legacy) {
        setPendingMigration({ info: result.legacy, action: () => executeImport(result.data, result.warnings) })
        return
      }
      await executeImport(result.data, result.warnings)
    } catch (err) {
      showMessage(`Import failed — ${err instanceof Error ? err.message : 'could not read the file'}`, 5000)
    }
  }

  const showAppendPicker = async (fileName: string, data: ImportData, warnings: string[]) => {
    const candidates = await findAppendDuplicatesInDb(data.todos)
    setAppendError(null)
    setPendingAppend({ fileName, data, candidates, warnings })
  }

  /** "Import tasks (append)…": prepare, then open the duplicate picker. */
  const doAppendImport = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        showMessage('Import failed — file too large (50 MB max).', 3000)
        return
      }
      const result = prepareImportText(await file.text(), { purpose: 'append' })
      if (!result.ok) {
        showMessage(`Import failed — ${result.error}`, result.reason === 'invalid' ? 10000 : 5000)
        return
      }
      if (result.data.todos.length === 0) {
        showMessage('Nothing to import — the file has no tasks.', 4000)
        return
      }
      if (result.legacy) {
        setPendingMigration({
          info: result.legacy,
          action: () => showAppendPicker(file.name, result.data, result.warnings),
        })
        return
      }
      await showAppendPicker(file.name, result.data, result.warnings)
    } catch (err) {
      showMessage(`Import failed — ${err instanceof Error ? err.message : 'could not read the file'}`, 5000)
    }
  }

  const confirmAppendImport = async (choices: Map<string, AppendChoice>) => {
    if (!pendingAppend) return
    setAppendBusy(true)
    setAppendError(null)
    try {
      const result = await runAppendImport(pendingAppend.data, choices)
      if (result.status === 'cancelled') {
        // Back in the duplicate picker, nothing imported.
        setAppendError('Nothing was imported — the backup could not be saved.')
        return
      }
      const { warnings } = pendingAppend
      setPendingAppend(null)
      const skipped = result.skipped > 0 ? ` Skipped ${plural(result.skipped, 'duplicate')}.` : ''
      const notes = [...(result.noBackup ? [NO_BACKUP_NOTE] : []), ...warnings]
      showMessage(`Imported ${plural(result.imported, 'task')}.${skipped}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`, notes.length > 0 ? 8000 : 6000)
    } catch (err) {
      setAppendError(`Import failed — ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAppendBusy(false)
    }
  }

  const handleExportMarkdown = async () => {
    const md = await buildMarkdownExport()
    const fileName = `todos-${new Date().toISOString().split('T')[0]}.md`
    const saved = await saveTextFile({
      text: md,
      suggestedName: fileName,
      description: 'Markdown',
      mimeType: 'text/markdown',
      extension: '.md',
    })
    if (saved === 'cancelled') return
    if (saved === 'downloaded') showMessage(downloadedMessage(fileName), DOWNLOADED_MESSAGE_MS)
    else showMessage('Markdown exported!', 2000)
  }

  const secondary = `${styles.button} ${styles.buttonSecondary}`

  return (
    <div className={styles.section}>
      <SettingRow label="Export" help="A full backup (JSON) you can import again, or a readable Markdown list.">
        <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleExport}>
          Export JSON
        </button>
        <button type="button" className={secondary} onClick={handleExportMarkdown}>
          Export Markdown
        </button>
      </SettingRow>
      <SettingRow label="Import" help="Import JSON replaces all data with a backup. Append adds the tasks from a backup or task archive.">
        <button
          type="button"
          className={secondary}
          onClick={() => pickJsonFile(importRef.current, doImport)}
          title="Replace all data with a full backup"
        >
          Import JSON
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => pickJsonFile(appendImportRef.current, doAppendImport)}
          title="Add the tasks from a task archive or backup to your current data"
        >
          Import tasks (append)…
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            await doImport(file)
            if (importRef.current) importRef.current.value = ''
          }}
        />
        <input
          ref={appendImportRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            await doAppendImport(file)
            if (appendImportRef.current) appendImportRef.current.value = ''
          }}
          data-testid="append-import-input"
        />
      </SettingRow>
      {message && <div className={styles.successMsg}>{message}</div>}
      {exportWarning && (
        <div className={`${styles.errorMsg} ${styles.exportWarning}`} role="alert" data-testid="export-self-check-warning">
          <span>The file was saved, but it would not import back: {exportWarning}</span>
          <button type="button" className={secondary} onClick={() => setExportWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      {pendingAppend && (
        <AppendImportDialog
          fileName={pendingAppend.fileName}
          candidates={pendingAppend.candidates}
          busy={appendBusy}
          error={appendError}
          onConfirm={(choices) => { void confirmAppendImport(choices) }}
          onCancel={() => setPendingAppend(null)}
        />
      )}
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
