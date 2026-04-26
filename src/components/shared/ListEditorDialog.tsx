import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './ListEditorDialog.module.css'

export interface ListEditorDialogList {
  id: number
  name: string
  favorited: boolean
}

export interface ListEditorDialogProps {
  open: boolean
  list: ListEditorDialogList | null
  onClose: () => void
  onSave: () => void
  onToggleFavorite: () => void
  /** The form body — name field, filter chips, sort/group/prompt selects, etc. */
  children: ReactNode
}

export function ListEditorDialog({
  open,
  list,
  onClose,
  onSave,
  onToggleFavorite,
  children,
}: ListEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus()
    }
  }, [open])

  if (!open || !list) return null

  return createPortal(
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit list: ${list.name}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.title}>
            <span className={styles.titleEyebrow}>Edit list ·</span>
            <span className={styles.titleName}>{list.name}</span>
          </div>

          <button
            type="button"
            className={styles.favBtn}
            onClick={onToggleFavorite}
            aria-pressed={list.favorited}
          >
            <FavIcon on={list.favorited} />
            <span>{list.favorited ? 'In favorites' : 'Add to favorites'}</span>
          </button>

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

        <footer className={styles.footer}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={onSave}>
            Save
          </button>
        </footer>
      </div>
    </>,
    document.body,
  )
}

function FavIcon({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.favIcon} ${on ? styles.favIconOn : ''}`}
    >
      {on ? '★' : ''}
    </span>
  )
}
