import type { ReactNode } from 'react'
import styles from './SlotHeader.module.css'

interface SlotHeaderProps {
  title: ReactNode
  meta?: ReactNode
  onMore?: () => void
  onClose?: () => void
}

export function SlotHeader({ title, meta, onMore, onClose }: SlotHeaderProps) {
  return (
    <header className={styles.header}>
      <span
        className={styles.dragHandle}
        aria-label="Drag slot"
        role="button"
        tabIndex={-1}
      >
        ⋮⋮
      </span>
      <span className={styles.title}>{title}</span>
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {onMore && (
        <button
          type="button"
          className={styles.iconButton}
          onClick={onMore}
          aria-label="Slot options"
          title="Slot options"
        >
          ⋯
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label="Close slot"
          title="Close slot"
        >
          ×
        </button>
      )}
    </header>
  )
}
