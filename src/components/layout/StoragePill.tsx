import { useCallback, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFileStorageStore } from '../../services/file-storage-store'
import { useUIStore, type SettingsTarget } from '../../stores/ui-store'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { formatRelativeTime } from '../../utils/date'
import { GearIcon } from '../shared/icons'
import { storagePillLabel, useStorageStatus, warningTone } from './sync-status'
import { SyncWarningIcon, SyncWarningSections } from './SyncWarningSections'
import { SyncWarningAnnouncer } from './SyncWarningAnnouncer'
import styles from './StoragePill.module.css'

/**
 * Where the data lives, in the top bar, and every sync warning: Local only /
 * Synced (the sync file's name in its tooltip and popover), or — most urgent first — Permission needed, Sync
 * paused, Sync error (red), Backup warning (amber), with a count when
 * several are active. Its popover explains each warning with its ways
 * forward (Grant access, Retry / Keep browser data…, Dismiss, Open
 * Backups…), or the storage state and Settings → File storage.
 */
export function StoragePill() {
  const isSupported = useFileStorageStore((s) => s.isSupported)
  const fileName = useFileStorageStore((s) => s.fileName)
  const lastSavedAt = useFileStorageStore((s) => s.lastSavedAt)
  const { state, warnings } = useStorageStatus()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    placement: 'bottom-end',
    offset: 8,
    onClose: close,
  })

  const openSettings = (section: SettingsTarget) => {
    close()
    useUIStore.getState().openSettings(section)
  }
  const tone = warningTone(state.kind)
  const settingsLink = (
    <div className={styles.footer}>
      <button type="button" className={styles.footerLink} onClick={() => openSettings('file-storage')}>
        <GearIcon size={14} />
        File storage settings…
      </button>
    </div>
  )

  let content
  if (warnings.length > 0) {
    content = (
      <>
        <SyncWarningSections
          warnings={warnings}
          variant="popover"
          titleId={titleId}
          onClose={close}
          onOpenBackups={() => useUIStore.getState().openSettings('backups')}
        />
        {settingsLink}
      </>
    )
  } else if (state.kind === 'syncing') {
    content = (
      <>
        <div className={styles.title} id={titleId}>
          <span className={`${styles.titleDot} ${styles.syncing}`} aria-hidden="true" />
          {`Syncing to ${fileName ?? 'file'}`}
        </div>
        <p className={styles.line}>
          {lastSavedAt ? `Last saved ${formatRelativeTime(lastSavedAt)}. ` : ''}
          Every change is written to the file a moment after you make it.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => openSettings('file-storage')}>File storage settings…</button>
        </div>
      </>
    )
  } else {
    content = (
      <>
        <div className={styles.title} id={titleId}>
          <span className={styles.titleDot} aria-hidden="true" />
          Stored in this browser only
        </div>
        {isSupported ? (
          <>
            <p className={styles.body}>Your tasks live in this browser’s storage. Connect a file to keep a copy you can back up or move to another machine.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => openSettings('file-storage')}>Set up file storage…</button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.body}>This browser can’t sync to a file. Use Import / Export to keep a backup.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => openSettings('import-export')}>Import / Export…</button>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.pill} ${styles[state.kind] ?? ''} ${tone ? styles[tone] : ''} ${open ? styles.open : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={storagePillLabel(state)}
        title={state.kind === 'syncing' ? `Syncing to ${fileName ?? 'file'}` : state.text}
        onClick={() => setOpen((o) => !o)}
        data-testid="storage-pill"
        data-state={state.kind}
      >
        {state.kind === 'local' || state.kind === 'syncing'
          ? <span className={styles.dot} aria-hidden="true" />
          : <span className={styles.icon} aria-hidden="true"><SyncWarningIcon kind={state.kind} size={12} /></span>}
        <span className={styles.text}>{state.text}</span>
        {state.warningCount > 1 && <span className={styles.count} aria-hidden="true">{state.warningCount}</span>}
      </button>
      <SyncWarningAnnouncer warnings={warnings} />
      {open && createPortal(
        <div
          ref={panelRef}
          className={styles.popover}
          style={{ position: style.position, left: style.left, top: style.top }}
          role="dialog"
          aria-labelledby={titleId}
          data-testid="storage-popover"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
