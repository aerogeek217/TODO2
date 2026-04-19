import { useCallback, useEffect, useRef } from 'react'
import type { SlotKind } from '../../../models/canvas-rails'
import styles from './SlotMenu.module.css'

interface SlotMenuProps {
  anchor: { x: number; y: number }
  currentKind: SlotKind
  onChangeKind: (kind: SlotKind) => void
  onSplit: (dir: 'above' | 'below' | 'left' | 'right') => void
  onPopOut?: () => void
  onClose: () => void
}

const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'lens',
  notes: 'notes',
  calendar: 'calendar',
  taskboard: 'taskboard',
}

const KINDS: { kind: SlotKind; label: string }[] = [
  { kind: 'lens', label: 'Lens' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'taskboard', label: 'Taskboard' },
]

const SPLITS: { dir: 'above' | 'below' | 'left' | 'right'; label: string }[] = [
  { dir: 'above', label: 'Split above' },
  { dir: 'below', label: 'Split below' },
  { dir: 'left', label: 'Split left' },
  { dir: 'right', label: 'Split right' },
]

export function SlotMenu({ anchor, currentKind, onChangeKind, onSplit, onPopOut, onClose }: SlotMenuProps) {
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
      <div className={styles.groupLabel}>Change type</div>
      {KINDS.map((k) => (
        <button
          type="button"
          key={k.kind}
          role="menuitem"
          className={`${styles.item} ${k.kind === currentKind ? styles.active : ''}`}
          onClick={() => { onChangeKind(k.kind); onClose() }}
          disabled={k.kind === currentKind}
        >
          {k.label}
        </button>
      ))}
      <div className={styles.separator} />
      <div className={styles.groupLabel}>Split</div>
      {SPLITS.map((s) => (
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
