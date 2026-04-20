import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SlotKind } from '../../models/canvas-rails'
import { KIND_ICON } from '../../utils/slot-kind'
import styles from './WidgetKindMenu.module.css'

const KINDS: { kind: SlotKind; label: string }[] = [
  { kind: 'lens', label: 'List' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'taskboard', label: 'Taskboard' },
]

export interface WidgetKindMenuProps {
  anchor: { x: number; y: number }
  /** Current widget kind. Omit in "add" mode — no row is marked active and no secondary row is shown. */
  currentKind?: SlotKind
  onChangeKind: (kind: SlotKind) => void
  /** Fires when the user clicks the "Change list…" (lens) or "Change taskboard…" (taskboard) row. */
  onOpenSecondary?: () => void
  onClose: () => void
  /** Optional label override for the secondary row (e.g. the current list-def name). */
  secondaryLabel?: string
  /** Group-label heading. Defaults to "Change widget"; use "Add widget" in add mode. */
  heading?: string
}

export function WidgetKindMenu({
  anchor,
  currentKind,
  onChangeKind,
  onOpenSecondary,
  onClose,
  secondaryLabel,
  heading = 'Change widget',
}: WidgetKindMenuProps) {
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
    const items = getItems()
    items[0]?.focus()
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
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus('first') }
    else if (e.key === 'End') { e.preventDefault(); moveFocus('last') }
    else if (e.key === 'Tab') onClose()
  }

  const secondary = currentKind === 'lens' ? 'Change list…'
    : currentKind === 'taskboard' ? 'Change taskboard…'
    : null

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: anchor.x, top: anchor.y }}
      role="menu"
      aria-label={heading}
      onKeyDown={onKeyDown}
    >
      <div className={styles.groupLabel}>{heading}</div>
      {KINDS.map((k) => {
        const active = k.kind === currentKind
        return (
          <button
            type="button"
            key={k.kind}
            role="menuitem"
            className={`${styles.item} ${active ? styles.active : ''}`}
            onClick={() => { onChangeKind(k.kind); onClose() }}
            aria-checked={active}
          >
            <span className={styles.icon} aria-hidden="true">{KIND_ICON[k.kind]}</span>
            <span className={styles.label}>{k.label}</span>
            {active && <span className={styles.check} aria-hidden="true">✓</span>}
          </button>
        )
      })}
      {secondary && onOpenSecondary && (
        <>
          <div className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => { onOpenSecondary(); onClose() }}
          >
            <span className={styles.label}>{secondaryLabel ?? secondary}</span>
            <span className={styles.caret} aria-hidden="true">▸</span>
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
