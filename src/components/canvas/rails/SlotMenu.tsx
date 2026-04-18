import { useEffect, useRef } from 'react'
import type { SlotKind } from '../../../models/canvas-rails'
import styles from './SlotMenu.module.css'

interface SlotMenuProps {
  anchor: { x: number; y: number }
  currentKind: SlotKind
  onChangeKind: (kind: SlotKind) => void
  onSplit: (dir: 'above' | 'below' | 'left' | 'right') => void
  onClose: () => void
}

const KINDS: { kind: SlotKind; label: string }[] = [
  { kind: 'lens', label: 'Lens' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'calendar', label: 'Calendar' },
]

const SPLITS: { dir: 'above' | 'below' | 'left' | 'right'; label: string }[] = [
  { dir: 'above', label: 'Split above' },
  { dir: 'below', label: 'Split below' },
  { dir: 'left', label: 'Split left' },
  { dir: 'right', label: 'Split right' },
]

export function SlotMenu({ anchor, currentKind, onChangeKind, onSplit, onClose }: SlotMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: anchor.x, top: anchor.y }}
      role="menu"
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
    </div>
  )
}
