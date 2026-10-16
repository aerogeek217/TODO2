import { useEffect, useRef, useState } from 'react'
import { useFileOpsStore } from '../../../services/file-ops-store'
import { useUIStore } from '../../../stores/ui-store'
import type { AuditIssue } from '../../../data/audit'
import { AuditIssueDetailDialog } from '../../overlays/AuditIssueDetailDialog'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

/** The database audit: orphaned joins, dangling references, unrecognized data. */
export function DataIntegritySection() {
  const auditReport = useFileOpsStore((s) => s.auditReport)
  const runAudit = useFileOpsStore((s) => s.runAudit)
  const setAuditReport = useFileOpsStore((s) => s.setAuditReport)
  const cleanupCurrentAudit = useFileOpsStore((s) => s.cleanupCurrentAudit)
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null)
  const timer = useRef<number | null>(null)
  useStackedLayer(selectedIssue !== null)

  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current) }, [])

  const runCleanup = async () => {
    const cleaned = await cleanupCurrentAudit()
    setMessage(`Cleaned up ${cleaned} orphaned record${cleaned !== 1 ? 's' : ''}.`)
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), 4000)
  }

  const secondary = `${styles.button} ${styles.buttonSecondary}`

  return (
    <div className={styles.section}>
      {auditReport == null ? (
        <SettingRow label="Audit" help="Looks for records that point at missing data, and data this version doesn’t recognize.">
          <button
            type="button"
            className={secondary}
            onClick={async () => {
              setRunning(true)
              try {
                await runAudit()
              } finally {
                setRunning(false)
              }
            }}
            disabled={running}
          >
            {running ? 'Scanning...' : 'Run Audit'}
          </button>
        </SettingRow>
      ) : auditReport.totalOrphans === 0 ? (
        <SettingRow label="Audit" help="No issues found.">
          <button type="button" className={secondary} onClick={() => setAuditReport(null)}>Dismiss</button>
        </SettingRow>
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
                  onClick={hasDetail ? () => setSelectedIssue(issue) : undefined}
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
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={async () => {
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
            <button type="button" className={secondary} onClick={() => setAuditReport(null)}>Dismiss</button>
          </div>
        </>
      )}
      {message && <div className={styles.successMsg}>{message}</div>}

      <AuditIssueDetailDialog issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
    </div>
  )
}
