import type { ReactNode } from 'react'
import { DialogFrame } from './Dialog'
import styles from './ListEditorDialog.module.css'

export interface ListEditorDialogList {
  id: number
  name: string
}

export interface ListEditorDialogProps {
  open: boolean
  list: ListEditorDialogList | null
  /** How many workspace widgets show the list (footer note); omitted = no note. */
  widgetCount?: number
  onClose: () => void
  onSave: () => void
  /** A warning line above the footer. */
  notice?: ReactNode
  /** The form body — name field, filter chips, group / sort / prompt. */
  children: ReactNode
}

/**
 * "Edit list" dialog chrome (Settings › Lists): title, × close, the form, an
 * optional warning, and a footer with
 * how many widgets show the list, Cancel (Esc) and Save list, on the shared
 * dialog frame (`raised` tier). Esc and the scrim close it; an Esc meant for
 * a popover open over it (a filter picker or menu) is left to that popover.
 */
export function ListEditorDialog({
  open,
  list,
  widgetCount,
  onClose,
  onSave,
  notice,
  children,
}: ListEditorDialogProps) {
  if (!open || !list) return null

  return (
    <DialogFrame
      onClose={onClose}
      layer="raised"
      initialFocus="panel"
      aria-label={`Edit list: ${list.name}`}
      className={styles.dialog}
    >
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.titleEyebrow}>Edit list</span>
          <span className={styles.titleName}>{list.name}</span>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className={styles.body}>{children}</div>

      {notice && <p className={styles.notice} role="note">{notice}</p>}

      <footer className={styles.footer}>
        {widgetCount != null && widgetCount > 0 && (
          <span className={styles.shown}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.75.75" />
              <path d="M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />
            </svg>
            Shown in {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
          </span>
        )}
        <span className={styles.spacer} />
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button type="button" className={styles.btnPrimary} onClick={onSave}>
          Save list
        </button>
      </footer>
    </DialogFrame>
  )
}
