import { useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import type { SlotKind } from '../../models/canvas-rails'
import { KIND_ICON, KIND_LABEL } from '../../utils/slot-kind'
import { WidgetKindMenu } from './WidgetKindMenu'
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
  /**
   * When provided, the title renders as a button that fires this callback with
   * its bottom-left anchor point. Used by the kind/list selector (P3).
   */
  onTitleClick?: (anchor: { x: number; y: number }) => void
  titleMenuOpen?: boolean
  /**
   * When provided, renders a + button in the chrome row that opens a kind
   * picker and calls this with the chosen kind. Used by single-tab rail slot
   * headers so users can start a tab group without going through the ⋯ menu.
   */
  onAddTab?: (kind: SlotKind) => void
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
  onTitleClick,
  titleMenuOpen,
  onAddTab,
}: WidgetHeaderProps) {
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}
  const kindLabel = KIND_LABEL[kind] ?? kind
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null)
  // Track press-down position on the title so a drag (via React Flow on the
  // floating node) doesn't accidentally fire the menu-open click when the
  // pointer comes back up on the same button after movement.
  const titlePressRef = useRef<{ x: number; y: number } | null>(null)
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
      {onTitleClick ? (
        <button
          type="button"
          // In floating mode we deliberately omit `nodrag` so the title
          // area behaves like `ProjectNode`'s name span: a plain click
          // still opens the kind menu, but a press-and-drag lets React
          // Flow move the node — giving the user the whole header as a
          // drag surface.
          className={styles.titleButton}
          onPointerDown={(e) => {
            titlePressRef.current = { x: e.clientX, y: e.clientY }
          }}
          onClick={(e) => {
            const start = titlePressRef.current
            titlePressRef.current = null
            if (start) {
              const dx = e.clientX - start.x
              const dy = e.clientY - start.y
              // Suppress the click if the pointer moved enough to count as a
              // drag — the node was being repositioned, not opened.
              if (Math.hypot(dx, dy) > 4) return
            }
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            onTitleClick({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-haspopup="menu"
          aria-expanded={titleMenuOpen ? true : false}
          aria-label={`Change ${kindLabel}`}
          title="Change widget"
        >
          <span className={styles.titleLabel}>{title}</span>
          <span className={styles.titleCaret} aria-hidden="true">▾</span>
        </button>
      ) : (
        <span className={styles.title}>{title}</span>
      )}
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {onPopOut && (
        <button
          type="button"
          className={btnClass}
          onClick={onPopOut}
          aria-label={`Pop out ${kindLabel} slot to canvas`}
          title="Pop out to canvas"
        >
          ↙
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
          ↗
        </button>
      )}
      {onAddTab && (
        <button
          type="button"
          className={btnClass}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            setAddAnchor({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-label="Add tab"
          aria-haspopup="menu"
          aria-expanded={addAnchor !== null}
          title="Add tab"
        >
          +
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
      {addAnchor && onAddTab && (
        <WidgetKindMenu
          anchor={addAnchor}
          onChangeKind={(nextKind) => { onAddTab(nextKind); setAddAnchor(null) }}
          onClose={() => setAddAnchor(null)}
          heading="Add tab"
        />
      )}
    </header>
  )
}
