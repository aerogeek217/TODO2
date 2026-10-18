import { useEffect, useId, useRef } from 'react'
import { useFileStorageStore, type LaunchPermissionPrompt } from '../../services/file-storage-store'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { DialogFrame } from '../shared/Dialog'
import { AlertCircleIcon, FileIcon, InfoIcon, LayoutIcon, LockIcon, PauseIcon } from '../shared/icons'
import styles from './LaunchPermissionDialog.module.css'

/**
 * The launch question, over the start screen, when the attached sync file
 * needs the browser's permission again (after a browser restart): **Grant
 * access…** (the browser's own prompt, then the file loads as usual) or
 * **Continue without the file** (this browser's data, sync paused, nothing
 * written to the file). Launch waits for the answer. No ×, no backdrop
 * close; Esc = Continue (the answer that changes nothing). Asked at every
 * launch while the file is attached and needs permission.
 */
export function LaunchPermissionDialog({ prompt }: { prompt: LaunchPermissionPrompt }) {
  const grant = useFileStorageStore((s) => s.grantLaunchPermission)
  const continueWithout = useFileStorageStore((s) => s.continueWithoutFile)
  const isMobile = useIsMobile()
  const titleId = useId()
  const bodyId = useId()
  const grantRef = useRef<HTMLButtonElement>(null)
  const { fileName, phase } = prompt
  const waiting = phase === 'waiting'
  const file = <strong className={styles.fileName}>{fileName}</strong>
  // Refused: focus back on the primary, now Try again (it was disabled while waiting).
  useEffect(() => {
    if (phase === 'refused') grantRef.current?.focus()
  }, [phase])

  let middle
  if (waiting) {
    middle = (
      <div className={styles.status} role="status">
        <InfoIcon size={14} />
        <span>Answer the prompt your browser shows to allow access.</span>
      </div>
    )
  } else if (phase === 'refused') {
    middle = (
      <div className={styles.refused} role="alert">
        <span className={styles.refusedIcon}><AlertCircleIcon size={14} /></span>
        <span>
          <span className={styles.refusedTitle}>Your browser didn’t allow access.</span>
          <span className={styles.refusedLine}>
            Try again, or continue without the file. Sync stays paused and you can grant access later from the storage pill.
          </span>
        </span>
      </div>
    )
  } else if (isMobile) {
    middle = (
      <div className={styles.optionLines}>
        <p><strong>Grant access</strong> — your browser asks you to allow editing the file, then it loads as usual.</p>
        <p><strong>Continue without the file</strong> — open this browser’s data. Sync stays paused; nothing is written to the file.</p>
      </div>
    )
  } else {
    middle = (
      <div className={styles.options}>
        <div className={styles.option}>
          <span className={`${styles.optionIcon} ${styles.optionIconGrant}`}><LockIcon size={13} /></span>
          <span>
            <span className={styles.optionTitle}>Grant access</span>
            <span className={styles.optionLine}>Your browser asks you to allow editing the file. Then TODO2 loads it as usual and keeps syncing.</span>
          </span>
        </div>
        <div className={styles.option}>
          <span className={`${styles.optionIcon} ${styles.optionIconContinue}`}><PauseIcon size={13} /></span>
          <span>
            <span className={styles.optionTitle}>Continue without the file</span>
            <span className={styles.optionLine}>
              Opens the copy of your data in this browser. Sync stays paused and nothing is written to {fileName}. You can grant access later from the storage pill.
            </span>
          </span>
        </div>
      </div>
    )
  }

  const grantButton = (
    <button
      ref={grantRef}
      type="button"
      className={styles.primary}
      onClick={grant}
      disabled={waiting}
    >
      {waiting && <span className={styles.spinner} aria-hidden="true" />}
      {waiting ? 'Waiting for your browser…' : phase === 'refused' ? 'Try again' : 'Grant access…'}
    </button>
  )
  const continueButton = (
    <button type="button" className={styles.secondary} onClick={continueWithout}>
      Continue without the file
      {!isMobile && <kbd className={styles.kbd}>Esc</kbd>}
    </button>
  )

  return (
    <DialogFrame
      onClose={continueWithout}
      blockBackdropClose
      initialFocus={grantRef}
      className={styles.frame}
      backdropClassName={styles.backdrop}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data={{ 'launch-permission': phase }}
    >
      <div className={styles.mark} aria-hidden="true"><LayoutIcon size={16} />TODO2</div>
      <div className={styles.card} aria-busy={waiting ? 'true' : undefined}>
        <span className={styles.icon}><FileIcon size={18} /></span>
        <h2 id={titleId} className={styles.title}>Allow access to {fileName}</h2>
        <p id={bodyId} className={styles.body}>
          TODO2 syncs your tasks with {file}. After a browser restart, the browser needs your OK before TODO2 can open the file again.
        </p>
        {middle}
        <div className={styles.footer}>
          {isMobile ? <>{grantButton}{continueButton}</> : <>{continueButton}{grantButton}</>}
        </div>
      </div>
    </DialogFrame>
  )
}
