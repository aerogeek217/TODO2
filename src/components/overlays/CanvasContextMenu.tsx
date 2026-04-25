import { useEffect, useRef } from 'react'
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

export function CanvasContextMenu({ x, y, items, onClose }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const focusables = (): HTMLButtonElement[] =>
      itemRefs.current.filter((el): el is HTMLButtonElement => !!el)
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
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
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', keyHandler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', keyHandler, true)
    }
  }, [onClose])

  // autoFocus the first menu item on mount.
  useEffect(() => {
    const first = itemRefs.current.find((el): el is HTMLButtonElement => !!el)
    first?.focus()
  }, [])

  // Clamp position so menu doesn't overflow viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [x, y])

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      className={styles.menu}
      style={{ left: x, top: y }}
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
    </div>
  )
}
