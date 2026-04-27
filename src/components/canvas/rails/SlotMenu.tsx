import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SlotKind } from '../../../models/canvas-rails'
import { KIND_LABEL } from '../../../utils/slot-kind'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import styles from './SlotMenu.module.css'

interface SlotMenuProps {
  anchor: { x: number; y: number }
  currentKind: SlotKind
  orientation: 'vertical' | 'horizontal'
  onSplit: (dir: 'above' | 'below' | 'left' | 'right') => void
  onAddTab?: (anchor: { x: number; y: number }) => void
  onClose: () => void
}

type SplitItem = { dir: 'above' | 'below' | 'left' | 'right'; label: string }
const VERTICAL_SPLITS: SplitItem[] = [
  { dir: 'above', label: 'Split above' },
  { dir: 'below', label: 'Split below' },
]
const HORIZONTAL_SPLITS: SplitItem[] = [
  { dir: 'left', label: 'Split left' },
  { dir: 'right', label: 'Split right' },
]

export function SlotMenu({ anchor, currentKind, orientation, onSplit, onAddTab, onClose }: SlotMenuProps) {
  const splits = orientation === 'horizontal' ? HORIZONTAL_SPLITS : VERTICAL_SPLITS
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Point-anchored. Gain portal + scroll/resize close as a side effect of
  // migration (per ui-consistency P1 — inline popovers gain consistency
  // with the portalized ones). Escape is handled in onKeyDown so the
  // menu's arrow-nav closure stays self-contained.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: anchor.x, y: anchor.y },
    open: true,
    closeOnEscape: false,
    onClose,
  })

  const setRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    panelRef(el)
  }, [panelRef])

  const getItems = useCallback((): HTMLButtonElement[] => {
    if (!menuRef.current) return []
    const nodes = menuRef.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
    return Array.from(nodes)
  }, [])

  const moveFocus = useCallback((delta: 1 | -1 | 'first' | 'last') => {
    const items = getItems()
    if (items.length === 0) return
    const current = document.activeElement as HTMLElement | null
    const currentIdx = current ? items.findIndex((el) => el === current) : -1
    let next: number
    if (delta === 'first') next = 0
    else if (delta === 'last') next = items.length - 1
    else if (currentIdx === -1) next = delta === 1 ? 0 : items.length - 1
    else next = (currentIdx + delta + items.length) % items.length
    items[next]?.focus()
  }, [getItems])

  // Focus the first enabled menu item on open.
  useEffect(() => {
    const items = getItems()
    items[0]?.focus()
  }, [getItems])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveFocus('first')
    } else if (e.key === 'End') {
      e.preventDefault()
      moveFocus('last')
    } else if (e.key === 'Tab') {
      // Close on Tab to let focus escape the menu naturally.
      onClose()
    }
  }

  return createPortal(
    <div
      ref={setRef}
      className={styles.menu}
      style={style}
      role="menu"
      aria-label={`${KIND_LABEL[currentKind]} slot options`}
      onKeyDown={onKeyDown}
    >
      <div className={styles.groupLabel}>Split</div>
      {splits.map((s) => (
        <button
          type="button"
          key={s.dir}
          role="menuitem"
          className={styles.item}
          onClick={() => { onSplit(s.dir); onClose() }}
        >
          {s.label}
        </button>
      ))}
      {onAddTab && (
        <>
          <div className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => { onAddTab(anchor); onClose() }}
          >
            Add tab
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
