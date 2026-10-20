import { useFileStorageStore } from '../../services/file-storage-store'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { AlertCircleIcon, LockIcon, PauseIcon, WarningIcon } from '../shared/icons'
import { FileSyncPausedControls } from './FileSyncPausedControls'
import { syncWarningCopy, warningTone, type SyncWarning } from './sync-status'
import styles from './SyncWarningSections.module.css'

/** A warning's glyph (the pill, its popover, the phone's status button). */
export function SyncWarningIcon({ kind, size }: { kind: SyncWarning['kind']; size: number }) {
  switch (kind) {
    case 'permission': return <LockIcon size={size} />
    case 'paused': return <PauseIcon size={size} />
    case 'error': return <AlertCircleIcon size={size} />
    case 'backup': return <WarningIcon size={size} />
  }
}

interface SyncWarningSectionsProps {
  warnings: readonly SyncWarning[]
  /** The popover (desktop) or the phone's bottom sheet. */
  variant: 'popover' | 'sheet'
  /** The first section's title id (the surface's `aria-labelledby`). */
  titleId: string
  /** Grant access, Retry, Overwrite file and Open Backups… close the surface. */
  onClose: () => void
  /** Settings on Backups, where the surface can open it (the phone has no Backups part). */
  onOpenBackups?: () => void
}

/**
 * One section per active warning, most urgent first: title (with its icon
 * tile), why it shows, an optional flag, what it means, and the ways
 * forward. Dismiss removes its section; the surface closes once no section
 * is left.
 */
export function SyncWarningSections({ warnings, variant, titleId, onClose, onOpenBackups }: SyncWarningSectionsProps) {
  const reconnect = useFileStorageStore((s) => s.reconnect)
  const dismissError = useFileStorageStore((s) => s.dismissError)
  const dismissSnapshotWarning = useFileOpsStore((s) => s.dismissSnapshotWarning)
  const v = variant === 'sheet' ? styles.sheet : styles.popover

  const dismiss = (act: () => void) => () => {
    act()
    if (warnings.length <= 1) onClose()
  }

  const actions = (w: SyncWarning) => {
    switch (w.kind) {
      case 'permission':
        return (
          <button type="button" className={styles.primary} onClick={() => { onClose(); void reconnect() }}>
            Grant access
          </button>
        )
      case 'paused':
        return <FileSyncPausedControls buttonClassName={styles.secondary} primaryButtonClassName={styles.warningFill} onDone={onClose} />
      case 'error':
        return <button type="button" className={styles.secondary} onClick={dismiss(dismissError)}>Dismiss</button>
      case 'backup':
        return (
          <>
            {onOpenBackups && (
              <button type="button" className={styles.secondary} onClick={() => { onClose(); onOpenBackups() }}>Open Backups…</button>
            )}
            <button type="button" className={onOpenBackups ? styles.ghost : styles.secondary} onClick={dismiss(dismissSnapshotWarning)}>
              Dismiss
            </button>
          </>
        )
    }
  }

  return (
    <>
      {warnings.map((w, i) => {
        const copy = syncWarningCopy(w)
        const tone = warningTone(w.kind) === 'danger' ? styles.danger : styles.warning
        return (
          <section key={w.kind} className={`${styles.section} ${v}`} data-warning={w.kind}>
            <div className={styles.titleRow}>
              <span className={`${styles.iconTile} ${tone}`} aria-hidden="true">
                <SyncWarningIcon kind={w.kind} size={variant === 'sheet' ? 15 : 13} />
              </span>
              <h3 className={styles.title} id={i === 0 ? titleId : undefined}>{copy.title}</h3>
            </div>
            <p className={styles.why}>{copy.why}</p>
            {copy.flag && <p className={styles.flag}>{copy.flag}</p>}
            {copy.body && <p className={styles.body}>{copy.body}</p>}
            <div className={styles.actions}>{actions(w)}</div>
          </section>
        )
      })}
    </>
  )
}
