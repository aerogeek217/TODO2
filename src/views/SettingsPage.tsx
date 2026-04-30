import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useSettingsStore, type ThemeMode } from '../stores/settings-store'
import { useFileStorageStore } from '../stores/file-storage-store'
import { useFileOpsStore } from '../stores/file-ops-store'
import { useProjectStore } from '../stores/project-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { validateImportData, MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import type { ImportData } from '../data/import-validation'
import { detectUnsupportedImport } from '../services/migration-check'
import type { UnsupportedImportInfo } from '../services/migration-check'
import { MigrationDialog } from '../components/overlays/MigrationDialog'
import { buildExportData, buildMarkdownExport } from '../services/export-import'
import { loadLastPickerHandle, saveLastPickerHandle } from '../services/file-handle-idb'
import { getSaveFilePicker, getOpenFilePicker } from '../utils/file-picker'
import { useIsMobile } from '../hooks/use-is-mobile'
import { PeopleEditor } from '../components/settings/PeopleEditor'
import { OrgEditor } from '../components/settings/OrgEditor'
import { TagEditor } from '../components/settings/TagEditor'
import { ThemeColorsEditor } from '../components/settings/ThemeColorsEditor'
import { KeyboardShortcutsModal } from '../components/settings/KeyboardShortcutsModal'
import { StatusEditor } from '../components/settings/StatusEditor'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { useStatusStore } from '../stores/status-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useUIStore } from '../stores/ui-store'
import { GROUP_OPTIONS } from '../utils/task-grouping'
import type { ProjectGroupBy } from '../models'
import { MIN_CANVAS_MAX_EXTENT, MAX_CANVAS_MAX_EXTENT } from '../utils/canvas-bounds'
import styles from './SettingsPage.module.css'

const retentionOptions: { value: string; label: string }[] = [
  { value: '', label: 'Keep forever' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
]

async function getStartIn(): Promise<FileSystemHandle | 'documents'> {
  try {
    const saved = await loadLastPickerHandle()
    if (saved) return saved
  } catch { /* ignore */ }
  return 'documents'
}

export function SettingsPage() {
  const { load, themeMode, setThemeMode, defaultProjectId, setDefaultProjectId, defaultStatusId, setDefaultStatusId, completedRetentionDays, setCompletedRetentionDays, weekStartsOn, setWeekStartsOn, defaultProjectGroupBy, setDefaultProjectGroupBy, canvasMaxExtent, setCanvasMaxExtent } = useSettingsStore()
  const [canvasMaxExtentDraft, setCanvasMaxExtentDraft] = useState<string>(String(canvasMaxExtent))
  useEffect(() => { setCanvasMaxExtentDraft(String(canvasMaxExtent)) }, [canvasMaxExtent])
  const commitCanvasMaxExtent = useCallback(() => {
    const n = Number(canvasMaxExtentDraft)
    if (!Number.isFinite(n) || n < MIN_CANVAS_MAX_EXTENT || n > MAX_CANVAS_MAX_EXTENT) {
      setCanvasMaxExtentDraft(String(canvasMaxExtent))
      return
    }
    if (n !== canvasMaxExtent) setCanvasMaxExtent(n)
  }, [canvasMaxExtentDraft, canvasMaxExtent, setCanvasMaxExtent])
  const fileStorage = useFileStorageStore()
  const { projects, loadAll: loadProjects } = useProjectStore()
  const todos = useTodoStore((s) => s.todos)
  const purgeExpiredCompleted = useTodoStore((s) => s.purgeExpiredCompleted)
  const peopleCount = usePersonStore((s) => s.people.length)
  const orgCount = useOrgStore((s) => s.orgs.length)
  const tagCount = useTagStore((s) => s.tags.length)
  const statusCount = useStatusStore((s) => s.statuses.length)
  const statuses = useStatusStore((s) => s.statuses)
  const loadStatuses = useStatusStore((s) => s.load)
  const [exportMsg, setExportMsg] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const [showPeopleEditor, setShowPeopleEditor] = useState(false)
  const [showOrgEditor, setShowOrgEditor] = useState(false)
  const [showTagEditor, setShowTagEditor] = useState(false)
  const [showThemeColors, setShowThemeColors] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showStatusEditor, setShowStatusEditor] = useState(false)
  const listsEditorOpen = useUIStore((s) => s.listsEditorOpen)
  const listsEditorInitialId = useUIStore((s) => s.listsEditorInitialId)
  const openListsEditor = useUIStore((s) => s.openListsEditor)
  const closeListsEditor = useUIStore((s) => s.closeListsEditor)
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
  const [showCleanupPopup, setShowCleanupPopup] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(30)
  const [confirmingCleanup, setConfirmingCleanup] = useState(false)
  const [pendingMigration, setPendingMigration] = useState<{ info: UnsupportedImportInfo; action: () => Promise<void> } | null>(null)
  const timerRefs = useRef<number[]>([])
  const track = (fn: () => void, ms: number) => {
    timerRefs.current.push(window.setTimeout(fn, ms))
  }

  const isMobile = useIsMobile()
  const loadPeople = usePersonStore((s) => s.load)
  const loadOrgs = useOrgStore((s) => s.load)
  const loadTags = useTagStore((s) => s.load)

  useEffect(() => {
    load()
    loadProjects()
    loadPeople()
    loadOrgs()
    loadTags()
    loadStatuses()
    loadListDefinitions()
    loadBackups()
    return () => {
      timerRefs.current.forEach(clearTimeout)
    }
  }, [load, loadProjects, loadPeople, loadOrgs, loadTags, loadStatuses, loadListDefinitions, loadBackups])

  const retentionStats = useMemo(() => {
    if (completedRetentionDays == null) return null
    const now = new Date()
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - completedRetentionDays)
    const weekFromNow = new Date(now)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    const expiringCutoff = new Date(weekFromNow)
    expiringCutoff.setDate(expiringCutoff.getDate() - completedRetentionDays)

    const completed = todos.filter((t) => t.isCompleted)
    const expired = completed.filter((t) => new Date(t.modifiedAt) < cutoff)
    const expiringThisWeek = completed.filter(
      (t) => {
        const mod = new Date(t.modifiedAt)
        return mod >= cutoff && mod < expiringCutoff
      }
    )
    return { expired: expired.length, expiringThisWeek: expiringThisWeek.length, total: completed.length }
  }, [todos, completedRetentionDays])

  const completedCount = useMemo(() => todos.filter((t) => t.isCompleted).length, [todos])

  const cleanupMatchCount = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - cleanupDays)
    return todos.filter((t) => t.isCompleted && new Date(t.modifiedAt) < cutoff).length
  }, [todos, cleanupDays])

  const closeCleanupPopup = useCallback(() => {
    setShowCleanupPopup(false)
    setCleanupDays(30)
    setConfirmingCleanup(false)
  }, [])

  const handleCleanup = useCallback(async () => {
    if (cleanupMatchCount === 0) return
    if (!confirmingCleanup) {
      setConfirmingCleanup(true)
      return
    }
    await purgeExpiredCompleted(cleanupDays)
    closeCleanupPopup()
  }, [cleanupDays, cleanupMatchCount, confirmingCleanup, purgeExpiredCompleted, closeCleanupPopup])

  const handleExport = async () => {
    const tables = await buildExportData()
    const now = new Date()
    const data = { ...tables, exportedAt: now.toISOString() }
    const json = JSON.stringify(data, null, 2)
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')

    const showSaveFilePicker = getSaveFilePicker()
    if (showSaveFilePicker) {
      try {
        const startIn = await getStartIn()
        const handle = await showSaveFilePicker({
          suggestedName: `todo2-backup-${timestamp}.json`,
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          startIn,
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        saveLastPickerHandle(handle).catch(() => {})
        setExportMsg('Exported!')
        track(() => setExportMsg(''), 2000)
        return
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return // user cancelled
      }
    }

    // Fallback for browsers without File System Access API
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `todo2-backup-${timestamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    setExportMsg('Exported!')
    track(() => setExportMsg(''), 2000)
  }

  const handleImportClick = async () => {
    const showOpenFilePicker = getOpenFilePicker()
    if (showOpenFilePicker) {
      try {
        const startIn = await getStartIn()
        const [handle] = await showOpenFilePicker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          startIn,
        })
        if (!handle) return
        saveLastPickerHandle(handle).catch(() => {})
        const file = await handle.getFile()
        await doImport(file)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return // user cancelled
      }
    } else {
      importRef.current?.click()
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await doImport(file)
    if (importRef.current) importRef.current.value = ''
  }

  const executeImport = async (data: ImportData) => {
    await restoreFromImport(data)
    setExportMsg('Imported successfully!')
    track(() => setExportMsg(''), 4000)
  }

  const doImport = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        setExportMsg('Import failed — file too large (50 MB max).')
        track(() => setExportMsg(''), 3000)
        return
      }

      const text = await file.text()
      const parsed = JSON.parse(text)
      const result = validateImportData(parsed)

      if (!result.ok) {
        setExportMsg(`Import failed — ${result.error}`)
        track(() => setExportMsg(''), 4000)
        return
      }

      const legacyInfo = detectUnsupportedImport(parsed)
      if (legacyInfo) {
        setPendingMigration({
          info: legacyInfo,
          action: () => executeImport(result.data),
        })
        return
      }

      await executeImport(result.data)
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : 'invalid file'
      setExportMsg(`Import failed — ${detail}`)
      track(() => setExportMsg(''), 5000)
    }
  }

  const handleExportMarkdown = async () => {
    const md = await buildMarkdownExport()

    const showSaveFilePicker = getSaveFilePicker()
    if (showSaveFilePicker) {
      try {
        const startIn = await getStartIn()
        const handle = await showSaveFilePicker({
          suggestedName: `todos-${new Date().toISOString().split('T')[0]}.md`,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
          startIn,
        })
        const writable = await handle.createWritable()
        await writable.write(md)
        await writable.close()
        saveLastPickerHandle(handle).catch(() => {})
        setExportMsg('Markdown exported!')
        track(() => setExportMsg(''), 2000)
        return
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
      }
    }

    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `todos-${new Date().toISOString().split('T')[0]}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
          <div className={styles.sectionTitle}>People, Orgs, Statuses & Tags</div>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowPeopleEditor(true)}>
              Manage People{peopleCount > 0 && ` (${peopleCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowOrgEditor(true)}>
              Manage Orgs{orgCount > 0 && ` (${orgCount})`}
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
          </div>
        </div>

        {/* Task Defaults — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Task Defaults</div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Default project for new tasks</span>
            <select
              className={styles.settingSelect}
              value={defaultProjectId ?? ''}
              onChange={(e) => setDefaultProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
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
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Default grouping for new projects</span>
            <select
              className={styles.settingSelect}
              value={defaultProjectGroupBy ?? ''}
              onChange={(e) => setDefaultProjectGroupBy(e.target.value === '' ? null : (e.target.value as ProjectGroupBy))}
            >
              {GROUP_OPTIONS.map(({ value, label }) => (
                <option key={value ?? 'none'} value={value ?? ''}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        )}

        {/* Canvas — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Canvas</div>
          <div
            className={styles.settingRow}
            title={`Hard limit on widget coordinates (positions are clamped to ±N on both axes) and the floor for the canvas's minimum zoom (so "Fit all to view" can always cover the full band). Range ${MIN_CANVAS_MAX_EXTENT.toLocaleString()}–${MAX_CANVAS_MAX_EXTENT.toLocaleString()}.`}
          >
            <span className={styles.settingLabel}>Canvas extent (±px)</span>
            <input
              type="number"
              className={styles.settingSelect}
              value={canvasMaxExtentDraft}
              min={MIN_CANVAS_MAX_EXTENT}
              max={MAX_CANVAS_MAX_EXTENT}
              step={1000}
              onChange={(e) => setCanvasMaxExtentDraft(e.target.value)}
              onBlur={commitCanvasMaxExtent}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label="Canvas extent in pixels"
              style={{ width: 90, textAlign: 'right' }}
            />
          </div>
        </div>
        )}

        {/* Completed Tasks — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Completed Tasks</div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Auto-delete completed tasks after</span>
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
                  {retentionStats.expired} completed task{retentionStats.expired !== 1 ? 's' : ''} past retention (will be purged on next startup)
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
            >
              Import JSON
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
          </div>
          {exportMsg && <div className={styles.successMsg}>{exportMsg}</div>}
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
                {auditReport.issues.map((issue, i) => (
                  <div key={i} className={styles.auditRow}>
                    <span className={styles.auditCount}>{issue.count}</span>
                    <span className={styles.auditDesc}>{issue.description}</span>
                  </div>
                ))}
              </div>
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={async () => {
                    const cleaned = await cleanupCurrentAudit()
                    setAuditMsg(`Cleaned up ${cleaned} orphaned record${cleaned !== 1 ? 's' : ''}.`)
                    track(() => setAuditMsg(''), 4000)
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
                    {b.sizeBytes < 1024 ? `${b.sizeBytes} B` : `${Math.round(b.sizeBytes / 1024)} KB`}
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
                            let parsed: unknown
                            try { parsed = JSON.parse(data) } catch { parsed = null }
                            const legacyInfo = parsed ? detectUnsupportedImport(parsed) : null
                            if (legacyInfo) {
                              setPendingMigration({
                                info: legacyInfo,
                                action: async () => {
                                  const result = await restoreBackup(b.id)
                                  if (result.ok) setBackupMsg('Restored successfully!')
                                  else setBackupMsg(`Restore failed: ${result.error}`)
                                  track(() => setBackupMsg(''), 3000)
                                },
                              })
                              return
                            }
                            const result = await restoreBackup(b.id)
                            if (result.ok) setBackupMsg('Restored successfully!')
                            else setBackupMsg(`Restore failed: ${result.error}`)
                            track(() => setBackupMsg(''), 3000)
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
      {showPeopleEditor && <PeopleEditor onClose={() => setShowPeopleEditor(false)} />}
      {showOrgEditor && <OrgEditor onClose={() => setShowOrgEditor(false)} />}
      {showStatusEditor && <StatusEditor onClose={() => setShowStatusEditor(false)} />}
      {showTagEditor && <TagEditor onClose={() => setShowTagEditor(false)} />}
      {listsEditorOpen && (
        <DashboardListsEditor
          onClose={closeListsEditor}
          initialSelectedId={listsEditorInitialId ?? undefined}
        />
      )}

      {showCleanupPopup && (
        <div className={styles.cleanupOverlay} onClick={() => setShowCleanupPopup(false)}>
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
                ? `${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''} will be deleted. A backup will be created.`
                : 'No matching tasks.'}
            </div>
            <div className={styles.buttonRow}>
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={cleanupMatchCount === 0}
                onClick={handleCleanup}
              >
                {confirmingCleanup
                  ? `Confirm — permanently delete ${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''}`
                  : `Delete ${cleanupMatchCount} task${cleanupMatchCount !== 1 ? 's' : ''}`}
              </button>
              <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={closeCleanupPopup}>
                Cancel
              </button>
            </div>
          </div>
        </div>
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
