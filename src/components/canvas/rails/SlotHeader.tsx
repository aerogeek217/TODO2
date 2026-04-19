import type { HTMLAttributes, ReactNode } from 'react'
import type { SlotKind } from '../../../models/canvas-rails'
import styles from './SlotHeader.module.css'

interface SlotHeaderProps {
  title: ReactNode
  meta?: ReactNode
  slotKind: SlotKind
  onMore?: (anchor: { x: number; y: number }) => void
  menuOpen?: boolean
  onClose?: () => void
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement> }
  moreButtonRef?: React.Ref<HTMLButtonElement>
}

const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'lens',
  notes: 'notes',
  calendar: 'calendar',
}

export function SlotHeader({
  title,
  meta,
  slotKind,
  onMore,
  menuOpen,
  onClose,
  dragHandleProps,
  moreButtonRef,
}: SlotHeaderProps) {
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}
  const kindLabel = KIND_LABEL[slotKind] ?? slotKind
  return (
    <header className={styles.header}>
      <span
        {...dragRest}
        ref={dragRef}
        className={styles.dragHandle}
        aria-label={`Reorder slot: ${kindLabel}`}
        role="button"
        tabIndex={-1}
      >
        ⋮⋮
      </span>
      <span className={styles.title}>{title}</span>
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {onMore && (
        <button
          ref={moreButtonRef}
          type="button"
          className={styles.iconButton}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-label={`Slot options: ${kindLabel}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? true : false}
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
          aria-label={`Close ${kindLabel} slot`}
          title="Close slot"
        >
          ×
        </button>
      )}
    </header>
  )
}
