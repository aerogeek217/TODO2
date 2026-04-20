import type { HTMLAttributes, ReactNode, Ref } from 'react'
import type { SlotKind } from '../../models/canvas-rails'
import { KIND_ICON, KIND_LABEL } from '../../utils/slot-kind'
import styles from './WidgetHeader.module.css'

export interface WidgetHeaderProps {
  kind: SlotKind
  title: ReactNode
  meta?: ReactNode
  collapsed?: boolean
  onToggleCollapse?: () => void
  onMore?: (anchor: { x: number; y: number }) => void
  menuOpen?: boolean
  moreButtonRef?: Ref<HTMLButtonElement>
  onPopOut?: () => void
  onDock?: () => void
  onClose?: () => void
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> }
  /** When true, buttons are hover-revealed and receive react-flow `nopan nodrag` classes. */
  floating?: boolean
}

export function WidgetHeader({
  kind,
  title,
  meta,
  collapsed,
  onToggleCollapse,
  onMore,
  menuOpen,
  moreButtonRef,
  onPopOut,
  onDock,
  onClose,
  dragHandleProps,
  floating = false,
}: WidgetHeaderProps) {
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}
  const kindLabel = KIND_LABEL[kind] ?? kind
  const kindIcon = KIND_ICON[kind] ?? ''
  const btnClass = floating
    ? `${styles.iconButton} ${styles.iconButtonFloating} nopan nodrag`
    : styles.iconButton

  return (
    <header className={`${styles.header} ${floating ? styles.floating : ''}`}>
      {dragHandleProps && (
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
      )}
      {onToggleCollapse && (
        <button
          type="button"
          className={`${styles.collapseButton} ${collapsed ? styles.collapsed : ''} ${floating ? 'nopan nodrag' : ''}`}
          onClick={onToggleCollapse}
          aria-label={collapsed ? `Expand ${kindLabel}` : `Collapse ${kindLabel}`}
          aria-expanded={!collapsed}
        >
          &#9662;
        </button>
      )}
      <span className={styles.kindIcon} aria-hidden="true">{kindIcon}</span>
      <span className={styles.title}>{title}</span>
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {onPopOut && (
        <button
          type="button"
          className={btnClass}
          onClick={onPopOut}
          aria-label={`Pop out ${kindLabel} slot to canvas`}
          title="Pop out to canvas"
        >
          ⇱
        </button>
      )}
      {onDock && (
        <button
          type="button"
          className={btnClass}
          onClick={onDock}
          aria-label={`Dock ${kindLabel} to rail`}
          title="Dock to rail"
        >
          ↙
        </button>
      )}
      {onMore && (
        <button
          ref={moreButtonRef}
          type="button"
          className={btnClass}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-label={`${kindLabel} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? true : false}
          title="Options"
        >
          ⋯
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className={btnClass}
          onClick={onClose}
          aria-label={`Close ${kindLabel}`}
          title="Close"
        >
          ×
        </button>
      )}
    </header>
  )
}
