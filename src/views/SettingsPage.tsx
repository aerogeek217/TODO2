import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useSettingsStore, type ThemeMode } from '../stores/settings-store'
import { useFileStorageStore } from '../stores/file-storage-store'
import { useFileOpsStore } from '../stores/file-ops-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import type { ImportData } from '../data/import-validation'
import { prepareImportText } from '../data/import-pipeline'
import type { UnsupportedImportInfo } from '../services/migration-check'
import { MigrationDialog } from '../components/overlays/MigrationDialog'
import { AuditIssueDetailDialog } from '../components/overlays/AuditIssueDetailDialog'
import type { AuditIssue } from '../data/audit'
import { buildExportData, buildMarkdownExport, selfCheckExportJson } from '../services/export-import'
import { saveLastPickerHandle } from '../services/file-handle-idb'
import { getOpenFilePicker } from '../utils/file-picker'
import { getPickerStartIn, saveTextFile } from '../services/save-file'
import { exportAndPurgeCompleted } from '../services/purge-completed'
import { findAppendDuplicatesInDb, runAppendImport, type AppendCandidate, type AppendChoice } from '../services/append-import'
import { AppendImportDialog } from '../components/overlays/AppendImportDialog'
import { useIsMobile } from '../hooks/use-is-mobile'
import { FileSyncPausedControls } from '../components/layout/FileSyncPausedControls'
import { PeopleEditor } from '../components/settings/PeopleEditor'
import { TagEditor } from '../components/settings/TagEditor'
import { ThemeColorsEditor } from '../components/settings/ThemeColorsEditor'
import { KeyboardShortcutsModal } from '../components/settings/KeyboardShortcutsModal'
import { NlpSyntaxModal } from '../components/settings/NlpSyntaxModal'
import { StatusEditor } from '../components/settings/StatusEditor'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { useStatusStore } from '../stores/status-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useUIStore } from '../stores/ui-store'
import { BYTES_PER_KB } from '../constants'
import { isExpiredCompleted, retentionCutoff, selectExpiredCompleted } from '../utils/completed-at'
import { FollowupIntervalSetting } from '../components/settings/FollowupIntervalSetting'
import styles from './SettingsPage.module.css'

const retentionOptions: { value: string; label: string }[] = [
  { value: '', label: 'Keep forever' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
]

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Pending append import: the prepared file waiting in the duplicate picker. */
interface PendingAppend {
  fileName: string
  data: ImportData
  candidates: AppendCandidate[]
  warnings: string[]
}

export function SettingsPage() {
  const { load, themeMode, setThemeMode, defaultStatusId, setDefaultStatusId, completedRetentionDays, setCompletedRetentionDays, weekStartsOn, setWeekStartsOn } = useSettingsStore()
  const fileStorage = useFileStorageStore()
  const todos = useTodoStore((s) => s.todos)
  const purgeCompleted = useTodoStore((s) => s.purgeCompleted)
  const peopleCount = usePersonStore((s) => s.people.length)
  const tagCount = useTagStore((s) => s.tags.length)
  const statusCount = useStatusStore((s) => s.statuses.length)
  const statuses = useStatusStore((s) => s.statuses)
  const loadStatuses = useStatusStore((s) => s.load)
  const [exportMsg, setExportMsg] = useState('')
  /** Persistent: set when the last JSON export failed its re-import self-check. */
  const [exportWarning, setExportWarning] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const appendImportRef = useRef<HTMLInputElement>(null)
  const [pendingAppend, setPendingAppend] = useState<PendingAppend | null>(null)
  const [appendBusy, setAppendBusy] = useState(false)
  const [appendError, setAppendError] = useState<string | null>(null)
  const [showPeopleEditor, setShowPeopleEditor] = useState(false)
  const [showTagEditor, setShowTagEditor] = useState(false)
  const [showThemeColors, setShowThemeColors] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showNlpSyntax, setShowNlpSyntax] = useState(false)
  const [showStatusEditor, setShowStatusEditor] = useState(false)
  const listsEditorOpen = useUIStore((s) => s.listsEditorOpen)
  const listsEditorInitialId = useUIStore((s) => s.listsEditorInitialId)
  const openListsEditor = useUIStore((s) => s.openListsEditor)
  const closeListsEditor = useUIStore((s) => s.closeListsEditor)
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  const listDefinitionCount = useListDefinitionStore((s) => s.listDefinitions.length)
  const loadListDefinitions = useListDefinitionStore((s) => s.load)
  const backups = useFileOpsStore((s) => s.backups)
  const auditReport = useFileOpsStore((s) => s.auditReport)
  const loadBackups = useFileOpsStore((s) => s.loadBackups)
  const createBackup = useFileOpsStore((s) => s.createBackup)
  const deleteBackup = useFileOpsStore((s) => s.deleteBackup)
  const peekBackupData = useFileOpsStore((s) => s.peekBackupData)
  const restoreBackup = useFileOpsStore((s) => s.restoreBackup)
  const runAudit = useFileOpsStore((s) => s.runAudit)
  const setAuditReport = useFileOpsStore((s) => s.setAuditReport)
  const cleanupCurrentAudit = useFileOpsStore((s) => s.cleanupCurrentAudit)
  const restoreFromImport = useFileOpsStore((s) => s.restoreFromImport)
  const [backupMsg, setBackupMsg] = useState('')
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null)
  const [auditMsg, setAuditMsg] = useState('')
  const [auditRunning, setAuditRunning] = useState(false)
  const [selectedAuditIssue, setSelectedAuditIssue] = useState<AuditIssue | null>(null)
  const [showCleanupPopup, setShowCleanupPopup] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(30)
  const [confirmingCleanup, setConfirmingCleanup] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const [cleanupMsg, setCleanupMsg] = useState('')
  const [pendingMigration, setPendingMigration] = useState<{ info: UnsupportedImportInfo; action: () => Promise<void> } | null>(null)
  const timerRefs = useRef<number[]>([])
  const track = (fn: () => void, ms: number) => {
    timerRefs.current.push(window.setTimeout(fn, ms))
  }

  const isMobile = useIsMobile()
  const loadPeople = usePersonStore((s) => s.load)
  const loadTags = useTagStore((s) => s.load)

  useEffect(() => {
    load()
    loadPeople()
    loadTags()
    loadStatuses()
    loadListDefinitions()
    loadBackups()
    const timers = timerRefs.current
    return () => {
      timers.forEach(clearTimeout)
    }
  }, [load, loadPeople, loadTags, loadStatuses, loadListDefinitions, loadBackups])

  const retentionStats = useMemo(() => {
    if (completedRetentionDays == null) return null
    const now = new Date()
    const cutoff = retentionCutoff(completedRetentionDays, now)
    const weekFromNow = new Date(now)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    const expiringCutoff = retentionCutoff(completedRetentionDays, weekFromNow)

    const completed = todos.filter((t) => t.isCompleted)
    const expired = completed.filter((t) => isExpiredCompleted(t, cutoff))
    const expiringThisWeek = completed.filter(
      (t) => !isExpiredCompleted(t, cutoff) && isExpiredCompleted(t, expiringCutoff),
    )
    return { expired: expired.length, expiringThisWeek: expiringThisWeek.length, total: completed.length }
  }, [todos, completedRetentionDays])

  const completedCount = useMemo(() => todos.filter((t) => t.isCompleted).length, [todos])

  const cleanupMatches = useMemo(() => selectExpiredCompleted(todos, cleanupDays), [todos, cleanupDays])
  const cleanupMatchCount = cleanupMatches.length

  const closeCleanupPopup = useCallback(() => {
    setShowCleanupPopup(false)
    setCleanupDays(30)
    setConfirmingCleanup(false)
    setCleanupError(null)
  }, [])

  const showCleanupMsg = (msg: string) => {
    setCleanupMsg(msg)
    track(() => setCleanupMsg(''), 5000)
  }

  const handleCleanup = async () => {
    if (cleanupMatchCount === 0) return
    if (!confirmingCleanup) {
      setConfirmingCleanup(true)
      return
    }
    const deleted = await purgeCompleted(cleanupMatches.map((t) => t.id))
    closeCleanupPopup()
    showCleanupMsg(`Deleted ${plural(deleted, 'completed task')}.`)
  }

  /** Settings cleanup's "Export & delete": archive file first, then delete. */
  const handleCleanupExport = async () => {
    if (cleanupMatchCount === 0) return
    setCleanupBusy(true)
    setCleanupError(null)
    try {
      const result = await exportAndPurgeCompleted(cleanupMatches.map((t) => t.id))
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        setCleanupError(result.message)
        return
      }
      closeCleanupPopup()
      showCleanupMsg(`Saved ${plural(result.deleted, 'task')} to ${result.fileName} and deleted them.`)
    } catch (err) {
      setCleanupError(`Nothing was deleted — ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCleanupBusy(false)
    }
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

    const saved = await saveTextFile({
      text: json,
      suggestedName: `todo2-backup-${timestamp}.json`,
      description: 'JSON',
      mimeType: 'application/json',
      extension: '.json',
    })
    if (saved === 'cancelled') return
    setExportMsg('Exported!')
    track(() => setExportMsg(''), 2000)
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

  const handleImportClick = () => pickJsonFile(importRef.current, doImport)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await doImport(file)
    if (importRef.current) importRef.current.value = ''
  }

  const showAppendPicker = async (fileName: string, data: ImportData, warnings: string[]) => {
    const candidates = await findAppendDuplicatesInDb(data.todos)
    setAppendError(null)
    setPendingAppend({ fileName, data, candidates, warnings })
  }

  /** Settings → "Import tasks (append)…": prepare, then open the duplicate picker. */
  const doAppendImport = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        setExportMsg('Import failed — file too large (50 MB max).')
        track(() => setExportMsg(''), 3000)
        return
      }
      const result = prepareImportText(await file.text(), { purpose: 'append' })
      if (!result.ok) {
        setExportMsg(`Import failed — ${result.error}`)
        track(() => setExportMsg(''), result.reason === 'invalid' ? 10000 : 5000)
        return
      }
      if (result.data.todos.length === 0) {
        setExportMsg('Nothing to import — the file has no tasks.')
        track(() => setExportMsg(''), 4000)
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
      setExportMsg(`Import failed — ${err instanceof Error ? err.message : 'could not read the file'}`)
      track(() => setExportMsg(''), 5000)
    }
  }

  const handleAppendImportClick = () => pickJsonFile(appendImportRef.current, doAppendImport)

  const handleAppendImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await doAppendImport(file)
    if (appendImportRef.current) appendImportRef.current.value = ''
  }

  const confirmAppendImport = async (choices: Map<string, AppendChoice>) => {
    if (!pendingAppend) return
    setAppendBusy(true)
    setAppendError(null)
    try {
      const result = await runAppendImport(pendingAppend.data, choices)
      const { warnings } = pendingAppend
      setPendingAppend(null)
      const skipped = result.skipped > 0 ? ` Skipped ${plural(result.skipped, 'duplicate')}.` : ''
      setExportMsg(`Imported ${plural(result.imported, 'task')}.${skipped}${warnings.length > 0 ? ` ${warnings.join(' ')}` : ''}`)
      track(() => setExportMsg(''), 6000)
    } catch (err) {
      setAppendError(`Import failed — ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAppendBusy(false)
    }
  }

  const executeImport = async (data: ImportData, warnings: string[]) => {
    await restoreFromImport(data)
    setExportMsg(warnings.length > 0
      ? `Imported successfully. ${warnings.join(' ')}`
      : 'Imported successfully!')
    track(() => setExportMsg(''), warnings.length > 0 ? 8000 : 4000)
  }

  const doImport = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        setExportMsg('Import failed — file too large (50 MB max).')
        track(() => setExportMsg(''), 3000)
        return
      }

      const text = await file.text()
      const result = prepareImportText(text)

      if (!result.ok) {
        setExportMsg(`Import failed — ${result.error}`)
        track(() => setExportMsg(''), result.reason === 'invalid' ? 10000 : 5000)
        return
      }

      if (result.legacy) {
        setPendingMigration({
          info: result.legacy,
          action: () => executeImport(result.data, result.warnings),
        })
        return
      }

      await executeImport(result.data, result.warnings)
    } catch (err) {
      setExportMsg(`Import failed — ${err instanceof Error ? err.message : 'could not read the file'}`)
      track(() => setExportMsg(''), 5000)
    }
  }

  const handleExportMarkdown = async () => {
    const md = await buildMarkdownExport()
    const saved = await saveTextFile({
      text: md,
      suggestedName: `todos-${new Date().toISOString().split('T')[0]}.md`,
      description: 'Markdown',
      mimeType: 'text/markdown',
      extension: '.md',
    })
    if (saved === 'cancelled') return
    setExportMsg('Markdown exported!')
    track(() => setExportMsg(''), 2000)
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.pageTitle}>Settings</div>

        {/* People & Tags — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>People, Statuses & Tags</div>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowPeopleEditor(true)}>
              Manage People{peopleCount > 0 && ` (${peopleCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowStatusEditor(true)}>
              Manage Statuses{statusCount > 0 && ` (${statusCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowTagEditor(true)}>
              Manage Tags{tagCount > 0 && ` (${tagCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => openListsEditor()}>
              Lists{listDefinitionCount > 0 && ` (${listDefinitionCount})`}
            </button>
          </div>
        </div>
        )}

        {/* Appearance & Shortcuts */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Appearance</div>
          <div className={styles.themeToggle}>
            {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                className={`${styles.themeOption} ${themeMode === mode ? styles.themeOptionActive : ''}`}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'light' ? '☀' : mode === 'dark' ? '☾' : '◑'}{' '}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowThemeColors(true)}>
              Theme Colors
            </button>
            {!isMobile && (
              <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowShortcuts(true)}>
                Keyboard Shortcuts
              </button>
            )}
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowNlpSyntax(true)}>
              Quick-Add Syntax
            </button>
          </div>
        </div>

        {/* Task Defaults — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Task Defaults</div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Default status for new tasks</span>
            <select
              className={styles.settingSelect}
              value={defaultStatusId ?? ''}
              onChange={(e) => setDefaultStatusId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">None</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <FollowupIntervalSetting
            rowClassName={styles.settingRow}
            labelClassName={styles.settingLabel}
            inputClassName={styles.settingSelect}
            hintClassName={styles.retentionMuted}
          />
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Week starts on</span>
            <select
              className={styles.settingSelect}
              value={weekStartsOn}
              onChange={(e) => setWeekStartsOn(Number(e.target.value) === 0 ? 0 : 1)}
            >
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </div>
        </div>
        )}

        {/* Completed Tasks — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Completed Tasks</div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Offer to delete completed tasks after</span>
            <select
              className={styles.settingSelect}
              value={completedRetentionDays ?? ''}
              onChange={(e) => setCompletedRetentionDays(e.target.value ? Number(e.target.value) : null)}
            >
              {retentionOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {retentionStats && (
            <div className={styles.retentionInfo}>
              {retentionStats.expired > 0 && (
                <span className={styles.retentionWarning}>
                  {retentionStats.expired} completed task{retentionStats.expired !== 1 ? 's' : ''} past retention (you'll be asked on next launch)
                </span>
              )}
              {retentionStats.expiringThisWeek > 0 && (
                <span className={styles.retentionMuted}>
                  {retentionStats.expiringThisWeek} more will expire in the next 7 days
                </span>
              )}
              {retentionStats.expired === 0 && retentionStats.expiringThisWeek === 0 && (
                <span className={styles.retentionMuted}>
                  {retentionStats.total} completed task{retentionStats.total !== 1 ? 's' : ''}, none expiring soon
                </span>
              )}
            </div>
          )}
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            disabled={completedCount === 0}
            onClick={() => setShowCleanupPopup(true)}
            style={{ marginTop: 'var(--space-4)' }}
          >
            Delete Completed Tasks
          </button>
          {cleanupMsg && <div className={styles.successMsg}>{cleanupMsg}</div>}
        </div>
        )}

        {/* Database Location */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Database {isMobile ? '& File Sync' : 'Location'}</div>
          {isMobile && fileStorage.isConnected && (
            <div className={styles.fileInfo}>
              <span className={styles.fileStatus}>
                Syncing to: {fileStorage.fileName}
              </span>
            </div>
          )}
          {!fileStorage.isSupported ? (
            <div className={styles.fileInfo}>
              <span className={styles.fileStatus}>
                {isMobile ? 'File sync is not supported on this browser. Use Import/Export instead.' : 'File sync requires Chrome or Edge (File System Access API)'}
              </span>
            </div>
          ) : fileStorage.needsPermission ? (
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{fileStorage.fileName}</span>
              <span className={styles.fileStatus}>Permission needed to sync to this file</span>
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={fileStorage.reconnect}
                  disabled={fileStorage.isLoading}
                >
                  Grant Access
                </button>
              </div>
            </div>
          ) : fileStorage.paused ? (
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{fileStorage.fileName}</span>
              <span className={styles.fileStatus}>{fileStorage.paused.message}</span>
              <div className={styles.buttonRow}>
                <FileSyncPausedControls
                  buttonClassName={`${styles.button} ${styles.buttonSecondary}`}
                  primaryButtonClassName={`${styles.button} ${styles.buttonPrimary}`}
                />
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={fileStorage.disconnect}
                  disabled={fileStorage.isLoading}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : fileStorage.isConnected ? (
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{fileStorage.fileName}</span>
              {fileStorage.lastSavedAt && (
                <span className={styles.fileStatus}>
                  Last saved: {fileStorage.lastSavedAt.toLocaleTimeString()}
                </span>
              )}
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={fileStorage.openFile}
                  disabled={fileStorage.isLoading}
                >
                  Attach to Different File
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.fileInfo}>
              <span className={styles.fileStatus}>Using browser storage only</span>
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={fileStorage.openFile}
                  disabled={fileStorage.isLoading}
                >
                  Attach to File
                </button>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={fileStorage.createFile}
                  disabled={fileStorage.isLoading}
                >
                  Create New File
                </button>
              </div>
            </div>
          )}
          {fileStorage.error && <div className={styles.errorMsg}>{fileStorage.error}</div>}
        </div>

        {/* Import / Export */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Import / Export</div>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleExport}>
              Export JSON
            </button>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleImportClick}
              title="Replace all data with a full backup"
            >
              Import JSON
            </button>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleAppendImportClick}
              title="Add the tasks from a task archive or backup to your current data"
            >
              Import tasks (append)…
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleExportMarkdown}>
              Export Markdown
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <input
              ref={appendImportRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleAppendImport}
              data-testid="append-import-input"
            />
          </div>
          {exportMsg && <div className={styles.successMsg}>{exportMsg}</div>}
          {exportWarning && (
            <div className={`${styles.errorMsg} ${styles.exportWarning}`} role="alert" data-testid="export-self-check-warning">
              <span>
                The file was saved, but it would not import back: {exportWarning}
              </span>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setExportWarning(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Data Audit — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Data Integrity</div>
          {auditReport == null ? (
            <div className={styles.buttonRow} style={{ marginTop: 0 }}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={async () => {
                  setAuditRunning(true)
                  try {
                    await runAudit()
                  } finally {
                    setAuditRunning(false)
                  }
                }}
                disabled={auditRunning}
              >
                {auditRunning ? 'Scanning...' : 'Run Audit'}
              </button>
            </div>
          ) : auditReport.totalOrphans === 0 ? (
            <>
              <div className={styles.auditClean}>No issues found.</div>
              <div className={styles.buttonRow} style={{ marginTop: 0 }}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => setAuditReport(null)}
                >
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.auditList}>
                {auditReport.issues.map((issue, i) => {
                  const severe = issue.fix === 'drop-store'
                    || issue.description.startsWith('Rows in "')
                    || issue.description.startsWith('Unrecognized settings')
                  const hasDetail = (issue.samples?.length ?? 0) > 0
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`${styles.auditRow} ${severe ? styles.auditRowSevere : ''} ${hasDetail ? styles.auditRowClickable : ''}`}
                      onClick={hasDetail ? () => setSelectedAuditIssue(issue) : undefined}
                      disabled={!hasDetail}
                      aria-label={hasDetail ? `View ${issue.count} offending records: ${issue.description}` : issue.description}
                    >
                      <span className={styles.auditCount}>{issue.count}</span>
                      <span className={styles.auditDesc}>{issue.description}</span>
                      {hasDetail && <span className={styles.auditViewHint} aria-hidden="true">View →</span>}
                    </button>
                  )
                })}
              </div>
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={async () => {
                    const runCleanup = async () => {
                      const cleaned = await cleanupCurrentAudit()
                      setAuditMsg(`Cleaned up ${cleaned} orphaned record${cleaned !== 1 ? 's' : ''}.`)
                      track(() => setAuditMsg(''), 4000)
                    }
                    const hasDropStore = auditReport.issues.some((i) => i.fix === 'drop-store')
                    if (hasDropStore) {
                      showBulkConfirmation('custom', [], {
                        title: 'Confirm destructive cleanup',
                        message: `Cleaning will permanently delete ${auditReport.totalOrphans} record${auditReport.totalOrphans !== 1 ? 's' : ''} this build doesn't recognize. This is irreversible.`,
                        confirmLabel: 'Confirm',
                        onConfirm: () => { void runCleanup() },
                      })
                    } else {
                      await runCleanup()
                    }
                  }}
                >
                  Clean Up {auditReport.totalOrphans} Issue{auditReport.totalOrphans !== 1 ? 's' : ''}
                </button>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => setAuditReport(null)}
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
          {auditMsg && <div className={styles.successMsg}>{auditMsg}</div>}
        </div>
        )}

        {/* Backups — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Backups</div>
          {backups.length === 0 ? (
            <div className={styles.backupEmpty}>No backups yet. Backups are created automatically every 24 hours and before destructive operations.</div>
          ) : (
            <div className={styles.backupList}>
              {backups.map((b) => (
                <div key={b.id} className={styles.backupRow}>
                  <span className={styles.backupTime}>
                    {new Date(b.createdAt).toLocaleString()}
                  </span>
                  <span className={`${styles.backupBadge}${b.trigger === 'pre-destructive' ? ` ${styles.backupBadgeDestructive}` : ''}`}>
                    {b.trigger === 'pre-destructive' ? 'pre-op' : b.trigger}
                  </span>
                  <span className={styles.backupSize}>
                    {b.sizeBytes < BYTES_PER_KB ? `${b.sizeBytes} B` : `${Math.round(b.sizeBytes / BYTES_PER_KB)} KB`}
                  </span>
                  <div className={styles.backupActions}>
                    {confirmRestoreId === b.id ? (
                      <>
                        <button
                          className={styles.backupBtn}
                          onClick={async () => {
                            setConfirmRestoreId(null)
                            const data = await peekBackupData(b.id)
                            if (!data) { setBackupMsg('Backup not found'); track(() => setBackupMsg(''), 3000); return }
                            const runRestore = async () => {
                              const result = await restoreBackup(b.id)
                              if (result.ok) setBackupMsg('Restored successfully!')
                              else setBackupMsg(`Restore failed: ${result.error}`)
                              track(() => setBackupMsg(''), 3000)
                            }
                            // Same pipeline as the restore itself; checked up
                            // front so a below-floor snapshot prompts first.
                            const prepared = prepareImportText(data)
                            if (prepared.ok && prepared.legacy) {
                              setPendingMigration({ info: prepared.legacy, action: runRestore })
                              return
                            }
                            await runRestore()
                          }}
                        >
                          Confirm
                        </button>
                        <button className={styles.backupBtn} onClick={() => setConfirmRestoreId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={styles.backupBtn} onClick={() => setConfirmRestoreId(b.id)}>
                          Restore
                        </button>
                        <button
                          className={`${styles.backupBtn} ${styles.backupBtnDanger}`}
                          onClick={async () => {
                            await deleteBackup(b.id)
                          }}
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
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={async () => {
                await createBackup('manual')
                setBackupMsg('Backup created!')
                track(() => setBackupMsg(''), 2000)
              }}
            >
              Create Backup Now
            </button>
          </div>
          {backupMsg && <div className={styles.successMsg}>{backupMsg}</div>}
        </div>
        )}

        {/* About */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>About</div>
          <div className={styles.aboutSection}>
            TODO2 — A spatial todo app<br />
            Data stored {fileStorage.isConnected ? `in ${fileStorage.fileName}` : 'locally in your browser (IndexedDB)'}<br />
            No account, no server, fully offline
          </div>
        </div>
      </div>

      {showThemeColors && <ThemeColorsEditor onClose={() => setShowThemeColors(false)} />}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showNlpSyntax && <NlpSyntaxModal onClose={() => setShowNlpSyntax(false)} />}
      {showPeopleEditor && <PeopleEditor onClose={() => setShowPeopleEditor(false)} />}
      {showStatusEditor && <StatusEditor onClose={() => setShowStatusEditor(false)} />}
      {showTagEditor && <TagEditor onClose={() => setShowTagEditor(false)} />}
      {listsEditorOpen && (
        <DashboardListsEditor
          onClose={closeListsEditor}
          initialSelectedId={listsEditorInitialId ?? undefined}
        />
      )}

      {showCleanupPopup && (
        <div className={styles.cleanupOverlay} onClick={() => { if (!cleanupBusy) closeCleanupPopup() }}>
          <div className={styles.cleanupPopup} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cleanupTitle}>Delete Completed Tasks</div>
            <div className={styles.settingRow}>
              <span className={styles.settingLabel}>Older than</span>
              <select
                className={styles.settingSelect}
                value={cleanupDays}
                onChange={(e) => { setCleanupDays(Number(e.target.value)); setConfirmingCleanup(false) }}
              >
                <option value="0">All completed</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
            <div className={styles.cleanupCount}>
              {cleanupMatchCount > 0
                ? `${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''} will be deleted. A backup will be created. Export & delete also saves them to a file you can add back with "Import tasks (append)…".`
                : 'No matching tasks.'}
            </div>
            {cleanupError && <div className={styles.errorMsg} role="alert">{cleanupError}</div>}
            <div className={styles.buttonRow}>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={cleanupMatchCount === 0 || cleanupBusy}
                onClick={handleCleanupExport}
              >
                {`Export & delete ${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''}`}
              </button>
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={cleanupMatchCount === 0 || cleanupBusy}
                onClick={handleCleanup}
              >
                {confirmingCleanup
                  ? `Confirm — permanently delete ${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''}`
                  : `Delete ${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''}`}
              </button>
              <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={closeCleanupPopup} disabled={cleanupBusy}>
                Cancel
              </button>
            </div>
          </div>
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

      <AuditIssueDetailDialog
        issue={selectedAuditIssue}
        onClose={() => setSelectedAuditIssue(null)}
      />
    </div>
  )
}
