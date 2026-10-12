import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { exportAndPurgeCompleted } from '../../../services/purge-completed'
import { isExpiredCompleted, retentionCutoff, selectExpiredCompleted } from '../../../utils/completed-at'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import { plural } from './plural'
import styles from './sections.module.css'

const RETENTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Keep forever' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
]

const CLEANUP_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'All completed' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
]

/**
 * The retention setting (completed tasks past it are offered for deletion at
 * launch, never purged silently) and the manual "Delete completed tasks"
 * popup with Export & delete.
 */
export function CompletedTasksSection() {
  const completedRetentionDays = useSettingsStore((s) => s.completedRetentionDays)
  const setCompletedRetentionDays = useSettingsStore((s) => s.setCompletedRetentionDays)
  const todos = useTodoStore((s) => s.todos)
  const purgeCompleted = useTodoStore((s) => s.purgeCompleted)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(30)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const timer = useRef<number | null>(null)
  useStackedLayer(showCleanup)

  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current) }, [])

  const retentionStats = useMemo(() => {
    if (completedRetentionDays == null) return null
    const now = new Date()
    const cutoff = retentionCutoff(completedRetentionDays, now)
    const weekFromNow = new Date(now)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    const expiringCutoff = retentionCutoff(completedRetentionDays, weekFromNow)
    const completed = todos.filter((t) => t.isCompleted)
    const expired = completed.filter((t) => isExpiredCompleted(t, cutoff)).length
    const expiringThisWeek = completed.filter(
      (t) => !isExpiredCompleted(t, cutoff) && isExpiredCompleted(t, expiringCutoff),
    ).length
    return { expired, expiringThisWeek, total: completed.length }
  }, [todos, completedRetentionDays])

  const completedCount = useMemo(() => todos.filter((t) => t.isCompleted).length, [todos])
  const matches = useMemo(() => selectExpiredCompleted(todos, cleanupDays), [todos, cleanupDays])
  const matchCount = matches.length

  const closeCleanup = useCallback(() => {
    setShowCleanup(false)
    setCleanupDays(30)
    setConfirming(false)
    setError(null)
  }, [])

  const showMessage = (msg: string) => {
    setMessage(msg)
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), 5000)
  }

  const handleDelete = async () => {
    if (matchCount === 0) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    const deleted = await purgeCompleted(matches.map((t) => t.id))
    closeCleanup()
    showMessage(`Deleted ${plural(deleted, 'completed task')}.`)
  }

  /** "Export & delete": archive file first, then delete. */
  const handleExportDelete = async () => {
    if (matchCount === 0) return
    setBusy(true)
    setError(null)
    try {
      const result = await exportAndPurgeCompleted(matches.map((t) => t.id))
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      closeCleanup()
      showMessage(`Saved ${plural(result.deleted, 'task')} to ${result.fileName} and deleted them.`)
    } catch (err) {
      setError(`Nothing was deleted — ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.section}>
      <SettingRow
        label="Offer to delete after"
        help="Completed tasks older than this are listed when the app starts. Nothing is deleted without asking."
        column
      >
        <select
          className={styles.select}
          aria-label="Offer to delete completed tasks after"
          value={completedRetentionDays ?? ''}
          onChange={(e) => setCompletedRetentionDays(e.target.value ? Number(e.target.value) : null)}
        >
          {RETENTION_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {retentionStats && (
          <>
            {retentionStats.expired > 0 && (
              <span className={styles.warningText}>
                {plural(retentionStats.expired, 'completed task')} past retention (you'll be asked on next launch)
              </span>
            )}
            {retentionStats.expiringThisWeek > 0 && (
              <span className={styles.muted}>{retentionStats.expiringThisWeek} more will expire in the next 7 days</span>
            )}
            {retentionStats.expired === 0 && retentionStats.expiringThisWeek === 0 && (
              <span className={styles.muted}>{plural(retentionStats.total, 'completed task')}, none expiring soon</span>
            )}
          </>
        )}
      </SettingRow>
      <SettingRow label="Delete completed tasks" help="A backup is taken first. Export & delete also saves them to a file." column>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonDanger}`}
          disabled={completedCount === 0}
          onClick={() => setShowCleanup(true)}
        >
          Delete completed tasks…
        </button>
        {message && <span className={styles.successMsg}>{message}</span>}
      </SettingRow>

      {showCleanup && (
        <div className={styles.cleanupOverlay} onClick={() => { if (!busy) closeCleanup() }}>
          <div
            className={styles.cleanupPopup}
            role="dialog"
            aria-modal="true"
            aria-label="Delete completed tasks"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.cleanupTitle}>Delete completed tasks</div>
            <div className={styles.cleanupRow}>
              <span className={styles.label}>Older than</span>
              <select
                className={styles.select}
                aria-label="Older than"
                value={cleanupDays}
                onChange={(e) => { setCleanupDays(Number(e.target.value)); setConfirming(false) }}
              >
                {CLEANUP_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className={styles.cleanupCount}>
              {matchCount > 0
                ? `${plural(matchCount, 'task')} will be deleted. A backup will be created. Export & delete also saves them to a file you can add back with "Import tasks (append)…".`
                : 'No matching tasks.'}
            </div>
            {error && <div className={styles.errorMsg} role="alert">{error}</div>}
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={matchCount === 0 || busy}
                onClick={handleExportDelete}
              >
                {`Export & delete ${plural(matchCount, 'task')}`}
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={matchCount === 0 || busy}
                onClick={handleDelete}
              >
                {confirming
                  ? `Confirm — permanently delete ${plural(matchCount, 'task')}`
                  : `Delete ${plural(matchCount, 'task')}`}
              </button>
              <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={closeCleanup} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
