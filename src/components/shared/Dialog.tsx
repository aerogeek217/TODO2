import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './Dialog.module.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Renders into the chrome's title bar. Used as `aria-labelledby` target. */
  title: ReactNode
  children: ReactNode
  /** Width preset. Defaults to 'sm' (~440px, confirm-style). */
  size?: 'sm' | 'md' | 'lg'
  /** When true, clicking the backdrop does NOT close the dialog. Default false. */
  blockBackdropClose?: boolean
  /** Optional ref for the element that should receive focus on mount.
   *  Defaults to the first focusable element inside the dialog. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Optional className applied to the dialog body wrapper. */
  className?: string
  /** Inline style escape hatch. */
  style?: CSSProperties
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onClose,
  title,
  children,
  size = 'sm',
  blockBackdropClose = false,
  initialFocusRef,
  className,
  style,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (!dialog) return

    const focusInitial = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
      const firstFocusable = focusables[0]
      if (firstFocusable) {
        firstFocusable.focus()
      } else {
        dialog.focus()
      }
    }
    focusInitial()

    return () => {
      const prev = previouslyFocusedRef.current
      if (prev && document.body.contains(prev)) {
        prev.focus()
      }
    }
  }, [open, initialFocusRef])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
      )
      if (focusables.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  const sizeClass = size === 'lg' ? styles.sizeLg : size === 'md' ? styles.sizeMd : styles.sizeSm

  return (
    <>
      <div
        className={styles.backdrop}
        onClick={blockBackdropClose ? undefined : onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.dialog} ${sizeClass} ${className ?? ''}`}
        style={style}
      >
        <div id={titleId} className={styles.title}>{title}</div>
        {children}
      </div>
    </>
  )
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.body} ${className ?? ''}`}>{children}</div>
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.actions} ${className ?? ''}`}>{children}</div>
}

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm button with danger styling. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onClose={onCancel} title={title} initialFocusRef={confirmRef}>
      <DialogBody>{message}</DialogBody>
      <DialogActions>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? styles.dangerButton : styles.confirmButton}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </DialogActions>
    </Dialog>
  )
}
