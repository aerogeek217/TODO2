import type { HTMLAttributes, ReactNode } from 'react'
import styles from './SlotHeader.module.css'

interface SlotHeaderProps {
  title: ReactNode
  meta?: ReactNode
  onMore?: (anchor: { x: number; y: number }) => void
  onClose?: () => void
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement> }
}

export function SlotHeader({ title, meta, onMore, onClose, dragHandleProps }: SlotHeaderProps) {
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}
  return (
    <header className={styles.header}>
      <span
        {...dragRest}
        ref={dragRef}
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
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          }}
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
