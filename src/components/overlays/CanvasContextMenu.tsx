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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', keyHandler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', keyHandler, true)
    }
  }, [onClose])

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
    <div ref={menuRef} className={styles.menu} style={{ left: x, top: y }}>
      {items.map((item, i) => (
        item.separator ? (
          <div key={i} className={styles.separator} />
        ) : (
          <button
            key={i}
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
