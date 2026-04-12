import { useEffect, useRef, useState, useMemo } from 'react'
import { useSettingsStore, type ThemeMode } from '../stores/settings-store'
import { useFileStorageStore, refreshAllStores } from '../stores/file-storage-store'
import { useProjectStore } from '../stores/project-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { validateImportData, MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import { restoreFromImportData } from '../data/restore'
import { auditData, cleanupIssues, type AuditReport } from '../data/audit'
import { buildExportData, buildMarkdownExport } from '../services/export-import'
import { backupScheduler } from '../services/backup-scheduler'
import { backupRepository, type BackupSummary } from '../data/backup-repository'
import { loadLastPickerHandle, saveLastPickerHandle } from '../services/file-handle-idb'
import { useIsMobile } from '../hooks/use-is-mobile'
import { PeopleEditor } from '../components/settings/PeopleEditor'
import { OrgEditor } from '../components/settings/OrgEditor'
import { TagEditor } from '../components/settings/TagEditor'
import { ThemeColorsEditor } from '../components/settings/ThemeColorsEditor'
import { KeyboardShortcutsModal } from '../components/settings/KeyboardShortcutsModal'
import { StatusEditor } from '../components/settings/StatusEditor'
import { useStatusStore } from '../stores/status-store'
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
  const { load, themeMode, setThemeMode, defaultProjectId, setDefaultProjectId, defaultStatusId, setDefaultStatusId, completedRetentionDays, setCompletedRetentionDays } = useSettingsStore()
  const fileStorage = useFileStorageStore()
  const { projects, loadAll: loadProjects } = useProjectStore()
  const todos = useTodoStore((s) => s.todos)
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
  const [backups, setBackups] = useState<BackupSummary[]>([])
  const [backupMsg, setBackupMsg] = useState('')
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null)
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null)
  const [auditMsg, setAuditMsg] = useState('')
  const [auditRunning, setAuditRunning] = useState(false)
  const timerRefs = useRef<number[]>([])
  const track = (fn: () => void, ms: number) => {
    timerRefs.current.push(window.setTimeout(fn, ms))
  }

  const isMobile = useIsMobile()
  const loadPeople = usePersonStore((s) => s.load)
  const loadOrgs = useOrgStore((s) => s.load)
  const loadTags = useTagStore((s) => s.load)

  const loadBackups = async () => {
    setBackups(await backupRepository.listSnapshots())
  }

  useEffect(() => {
    load()
    loadProjects()
    loadPeople()
    loadOrgs()
    loadTags()
    loadStatuses()
    loadBackups()
    return () => {
      timerRefs.current.forEach(clearTimeout)
    }
  }, [load, loadProjects, loadPeople, loadOrgs, loadTags, loadStatuses])

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

  const handleExport = async () => {
    const tables = await buildExportData()
    const now = new Date()
    const data = { ...tables, exportedAt: now.toISOString() }
    const json = JSON.stringify(data, null, 2)
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')

    if ('showSaveFilePicker' in window) {
      try {
        const startIn = await getStartIn()
        const handle = await (window as unknown as { showSaveFilePicker: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
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
    setTimeout(() => URL.revokeObjectURL(url), 100)
    setExportMsg('Exported!')
    track(() => setExportMsg(''), 2000)
  }

  const handleImportClick = async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const startIn = await getStartIn()
        const [handle] = await (window as unknown as { showOpenFilePicker: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          startIn,
        })
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

      await backupScheduler.snapshotBeforeDestructive().catch(() => {})
      await restoreFromImportData(result.data)

      await refreshAllStores()
      setExportMsg('Imported successfully!')
      track(() => setExportMsg(''), 4000)
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : 'invalid file'
      setExportMsg(`Import failed — ${detail}`)
      track(() => setExportMsg(''), 5000)
    }
  }

  const handleExportMarkdown = async () => {
    const md = await buildMarkdownExport()

    if ('showSaveFilePicker' in window) {
      try {
        const startIn = await getStartIn()
        const handle = await (window as unknown as { showSaveFilePicker: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
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
      } catch (err: any) {
        if (err?.name === 'AbortError') return
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
    setTimeout(() => URL.revokeObjectURL(url), 100)
    setExportMsg('Markdown exported!')
    track(() => setExportMsg(''), 2000)
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.pageTitle}>Settings</div>

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
        </div>
        )}

        {/* People & Tags — desktop only */}
        {!isMobile && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>People, Orgs, Tags & Statuses</div>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowPeopleEditor(true)}>
              Manage People{peopleCount > 0 && ` (${peopleCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowOrgEditor(true)}>
              Manage Orgs{orgCount > 0 && ` (${orgCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowTagEditor(true)}>
              Manage Tags{tagCount > 0 && ` (${tagCount})`}
            </button>
            <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowStatusEditor(true)}>
              Manage Statuses{statusCount > 0 && ` (${statusCount})`}
            </button>
          </div>
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
                    setAuditReport(await auditData())
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
                    const cleaned = await cleanupIssues(auditReport.issues)
                    await refreshAllStores()
                    setAuditReport(null)
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
                            const result = await backupRepository.restoreSnapshot(b.id)
                            if (result.ok) {
                              await refreshAllStores()
                              setBackupMsg('Restored successfully!')
                            } else {
                              setBackupMsg(`Restore failed: ${result.error}`)
                            }
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
                            await backupRepository.deleteSnapshot(b.id)
                            await loadBackups()
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
                await backupRepository.createSnapshot('manual')
                await loadBackups()
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
      {showTagEditor && <TagEditor onClose={() => setShowTagEditor(false)} />}
      {showStatusEditor && <StatusEditor onClose={() => setShowStatusEditor(false)} />}
    </div>
  )
}
