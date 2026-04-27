import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './CanvasContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  action: () => void
  danger?: boolean
  separator?: boolean
}

interface CanvasContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * Right-click / context-menu popover. Portals internally so all call sites
 * (canvas right-click, project-node right-click, task-row right-click,
 * TopBar search row right-click, HorizonsSlotContent row right-click) get
 * consistent positioning, dismissal, and viewport clamping without each
 * caller repeating a `createPortal` wrapper.
 */
export function CanvasContextMenu({ x, y, items, onClose }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Arrow-key focus nav stays as a document-level keydown listener (rather
  // than onKeyDown on the panel) because focus can escape the panel when
  // the user clicks an item that opens a child popover (e.g. the search
  // context menu's "Move to project…" → ProjectPickerPopup).
  useEffect(() => {
    const focusables = (): HTMLButtonElement[] =>
      itemRefs.current.filter((el): el is HTMLButtonElement => !!el)
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = focusables()
        if (buttons.length === 0) return
        e.preventDefault()
        const active = document.activeElement as HTMLElement | null
        const currentIdx = buttons.findIndex((el) => el === active)
        const nextIdx = e.key === 'ArrowDown'
          ? (currentIdx + 1) % buttons.length
          : (currentIdx <= 0 ? buttons.length - 1 : currentIdx - 1)
        buttons[nextIdx]?.focus()
      }
    }
    document.addEventListener('keydown', keyHandler, true)
    return () => document.removeEventListener('keydown', keyHandler, true)
  }, [])

  // autoFocus the first menu item on mount.
  useEffect(() => {
    const first = itemRefs.current.find((el): el is HTMLButtonElement => !!el)
    first?.focus()
  }, [])

  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x, y },
    open: true,
    onClose,
  })

  const setRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    panelRef(el)
  }, [panelRef])

  return createPortal(
    <div
      ref={setRef}
      role="menu"
      aria-orientation="vertical"
      className={styles.menu}
      style={style}
    >
      {items.map((item, i) => (
        item.separator ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <button
            key={i}
            ref={(el) => { itemRefs.current[i] = el }}
            role="menuitem"
            className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
            onClick={() => { item.action(); onClose() }}
          >
            {item.label}
          </button>
        )
      ))}
    </div>,
    document.body,
  )
}
