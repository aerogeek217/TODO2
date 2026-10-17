import { useCallback, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFileStorageStore } from '../../services/file-storage-store'
import { useUIStore, type SettingsTarget } from '../../stores/ui-store'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { formatRelativeTime } from '../../utils/date'
import { storagePillState, useSyncWarning } from './sync-status'
import { SyncWarningActions, SyncWarningMessage } from './SyncWarningContent'
import styles from './StoragePill.module.css'

/**
 * Where the data lives, in the top bar: Local only / the sync file's name /
 * Sync paused / Sync error. Its popover explains the state and leads to
 * Settings → File storage (or offers the same ways forward as the warning
 * strip).
 */
export function StoragePill() {
  const isSupported = useFileStorageStore((s) => s.isSupported)
  const isConnected = useFileStorageStore((s) => s.isConnected)
  const fileName = useFileStorageStore((s) => s.fileName)
  const needsPermission = useFileStorageStore((s) => s.needsPermission)
  const paused = useFileStorageStore((s) => s.paused)
  const error = useFileStorageStore((s) => s.error)
  const dismissedError = useFileStorageStore((s) => s.dismissedError)
  const lastSavedAt = useFileStorageStore((s) => s.lastSavedAt)
  const warning = useSyncWarning()
  const state = storagePillState({ isConnected, fileName, needsPermission, paused, error, dismissedError })
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
  const isWarning = state.kind === 'paused' || state.kind === 'error'

  let title: string
  let body
  if (isWarning && warning && warning.kind !== 'snapshot') {
    title = state.text
    body = (
      <>
        <p className={styles.body}><SyncWarningMessage warning={warning} /></p>
        <div className={styles.actions}>
          <SyncWarningActions warning={warning} dismissAsText />
          <button type="button" className={styles.secondary} onClick={() => openSettings('file-storage')}>File storage settings…</button>
        </div>
      </>
    )
  } else if (state.kind === 'syncing') {
    title = `Syncing to ${fileName ?? 'file'}`
    body = (
      <>
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
    title = 'Stored in this browser only'
    body = isSupported ? (
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
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.pill} ${styles[state.kind]} ${open ? styles.open : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Storage: ${state.text}`}
        title={state.kind === 'syncing' ? `Syncing to ${state.text}` : state.text}
        onClick={() => setOpen((o) => !o)}
        data-testid="storage-pill"
        data-state={state.kind}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>{state.text}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={styles.popover}
          style={{ position: style.position, left: style.left, top: style.top }}
          role="dialog"
          aria-labelledby={titleId}
        >
          <div className={styles.title} id={titleId}>
            <span className={`${styles.titleDot} ${styles[state.kind]}`} aria-hidden="true" />
            {title}
          </div>
          {body}
        </div>,
        document.body,
      )}
    </>
  )
}
