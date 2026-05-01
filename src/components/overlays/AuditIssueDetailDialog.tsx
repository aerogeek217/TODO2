import type { AuditIssue, AuditSample } from '../../data/audit'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import dialogStyles from '../shared/Dialog.module.css'
import styles from './AuditIssueDetailDialog.module.css'

interface AuditIssueDetailDialogProps {
  issue: AuditIssue | null
  onClose: () => void
}

/**
 * Detail popup for a single audit issue. Shows the offending rows with the
 * bad fields highlighted. Reachable from any audit row in Settings → Data
 * Integrity. Read-only — cleanup runs from the parent panel after the user
 * closes this view.
 */
export function AuditIssueDetailDialog({ issue, onClose }: AuditIssueDetailDialogProps) {
  if (!issue) return null

  const samples = issue.samples ?? []
  const truncated = samples.length < issue.count
  const noun = issue.count === 1 ? 'record' : 'records'
  const fixCopy = describeFix(issue)

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={issue.description}
      className={styles.dialog}
    >
      <DialogBody className={styles.body}>
        <div className={styles.metaRow}>
          <span className={styles.tablePill}>{issue.table}</span>
          <span className={styles.metaText}>
            {truncated
              ? `Showing first ${samples.length} of ${issue.count} ${noun}`
              : `${issue.count} ${noun}`}
          </span>
        </div>
        <div className={styles.fixHint}>{fixCopy}</div>

        {samples.length === 0 ? (
          <div className={styles.empty}>
            No row-level detail was captured for this issue.
          </div>
        ) : (
          <ul className={styles.sampleList}>
            {samples.map((sample, i) => (
              <SampleCard key={i} sample={sample} />
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogActions>
        <button type="button" className={dialogStyles.confirmButton} onClick={onClose}>
          Close
        </button>
      </DialogActions>
    </Dialog>
  )
}

function describeFix(issue: AuditIssue): string {
  if (issue.fix === 'drop-store') {
    return 'Cleanup will drop every row in this unrecognised IDB store.'
  }
  if (issue.fix === 'delete') {
    return 'Cleanup will delete these rows.'
  }
  if (issue.fix === 'clear-field') {
    if (issue.table === 'taskboards') {
      return 'Cleanup will remove the dangling entries from each taskboard, leaving the rest of the board intact.'
    }
    if (issue.field) {
      return `Cleanup will null out the "${issue.field}" field on these rows.`
    }
  }
  return 'Cleanup will repair these rows.'
}

function SampleCard({ sample }: { sample: AuditSample }) {
  const idLabel = sample.id != null ? String(sample.id) : '—'
  const entries = Object.entries(sample.row)
  const badFields = new Set(sample.badFields ?? [])

  return (
    <li className={styles.sampleCard}>
      <div className={styles.sampleHeader}>
        <span className={styles.sampleId}>id: {idLabel}</span>
        {sample.note && <span className={styles.sampleNote}>{sample.note}</span>}
      </div>
      <pre className={styles.json}>
        {entries.map(([key, value], i) => {
          const isBad = badFields.has(key)
          return (
            <div key={key} className={isBad ? styles.lineBad : styles.line}>
              <span className={styles.jsonKey}>"{key}"</span>
              <span className={styles.jsonPunct}>: </span>
              <span className={styles.jsonValue}>{formatValue(value)}</span>
              {i < entries.length - 1 && <span className={styles.jsonPunct}>,</span>}
            </div>
          )
        })}
      </pre>
    </li>
  )
}

/**
 * One-line representation of a value. Strings get quoted; everything else
 * round-trips through JSON.stringify so dates, nested objects, and arrays
 * stay legible without exploding the card height.
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
