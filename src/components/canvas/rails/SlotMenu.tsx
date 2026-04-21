import { useCallback, useEffect, useRef } from 'react'
import type { SlotKind } from '../../../models/canvas-rails'
import styles from './SlotMenu.module.css'

interface SlotMenuProps {
  anchor: { x: number; y: number }
  currentKind: SlotKind
  orientation: 'vertical' | 'horizontal'
  onSplit: (dir: 'above' | 'below' | 'left' | 'right') => void
  onPopOut?: () => void
  onAddTab?: () => void
  onClose: () => void
}

const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'list',
  notes: 'notes',
  calendar: 'calendar',
  taskboard: 'taskboard',
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

export function SlotMenu({ anchor, currentKind, orientation, onSplit, onPopOut, onAddTab, onClose }: SlotMenuProps) {
  const splits = orientation === 'horizontal' ? HORIZONTAL_SPLITS : VERTICAL_SPLITS
  const ref = useRef<HTMLDivElement | null>(null)

  const getItems = useCallback((): HTMLButtonElement[] => {
    if (!ref.current) return []
    const nodes = ref.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
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

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  // Focus the first enabled menu item on open.
  useEffect(() => {
    const items = getItems()
    items[0]?.focus()
  }, [getItems])

  // Clamp within viewport so right-rail menus don't spill off-screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    if (rect.right > window.innerWidth - margin) {
      el.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`
    }
    if (rect.bottom > window.innerHeight - margin) {
      el.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`
    }
  }, [anchor.x, anchor.y])

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

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: anchor.x, top: anchor.y }}
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
            onClick={() => { onAddTab(); onClose() }}
          >
            Add tab
          </button>
        </>
      )}
      {onPopOut && (
        <>
          <div className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => { onPopOut(); onClose() }}
          >
            Pop out to canvas
          </button>
        </>
      )}
    </div>
  )
}
