import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor, type PopoverPlacement } from '../../hooks/use-popover-anchor'
import { CheckIcon, ChevronRightIcon } from './icons'
import styles from './MenuPopover.module.css'

export type MenuEntry =
  | {
      kind: 'item'
      label: string
      icon?: ReactNode
      onSelect: () => void
      disabled?: boolean
      danger?: boolean
      /** Radio rows (e.g. the layout list): `checked` shows the trailing accent check. */
      radio?: boolean
      checked?: boolean
      /** Muted text before the check (e.g. "Edited"). */
      note?: string
      /** Shows a submenu chevron; `onSelect` opens the submenu. */
      submenu?: boolean
      /** Keep the menu open after `onSelect` (submenus open their own popover). */
      keepOpen?: boolean
      /** A single key that picks the item while the menu is open, shown as a kbd hint. */
      shortcut?: string
    }
  | { kind: 'separator' }
  | { kind: 'label'; text: string }

interface MenuPopoverProps {
  anchorRef?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  placement?: PopoverPlacement
  entries: readonly MenuEntry[]
  label: string
  width?: number
  onClose: () => void
}

/**
 * Popover menu for the workspace chrome (cell ⋯ menu, layout picker): D0
 * popover — 28px items with a leading icon, optional trailing check /
 * chevron, separators and group labels. ↑↓ / Home / End move, Enter
 * activates, Esc or an outside click closes. Focus starts on the first
 * enabled item.
 */
export function MenuPopover({ anchorRef, point, placement = 'bottom-start', entries, label, width, onClose }: MenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const { panelRef, style } = usePopoverAnchor({
    anchor: anchorRef ? { kind: 'ref', ref: anchorRef } : { kind: 'point', x: point?.x ?? 0, y: point?.y ?? 0 },
    open: true,
    placement,
    closeOnScroll: false,
    onClose,
  })
  const setRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    panelRef(el)
  }, [panelRef])

  const items = useCallback((): HTMLButtonElement[] => {
    const el = menuRef.current
    return el ? Array.from(el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')) : []
  }, [])

  useEffect(() => {
    items()[0]?.focus()
  }, [items])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase()
      const hit = entries.find((en) => en.kind === 'item' && !en.disabled && en.shortcut?.toLowerCase() === key)
      if (hit && hit.kind === 'item') {
        e.preventDefault()
        hit.onSelect()
        if (!hit.keepOpen) onClose()
        return
      }
    }
    const list = items()
    if (list.length === 0) return
    const idx = list.findIndex((b) => b === document.activeElement)
    let next: number | null = null
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % list.length
    else if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    else if (e.key === 'Tab') { onClose(); return }
    if (next == null) return
    e.preventDefault()
    list[next]?.focus()
  }

  return createPortal(
    <div
      ref={setRef}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={{ ...style, ...(width ? { width } : {}) }}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className={styles.separator} role="separator" />
        if (entry.kind === 'label') return <div key={i} className={styles.groupLabel}>{entry.text}</div>
        return (
          <button
            key={i}
            type="button"
            role={entry.radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={entry.radio ? entry.checked === true : undefined}
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            aria-keyshortcuts={entry.shortcut}
            disabled={entry.disabled}
            className={`${styles.item} ${entry.danger ? styles.danger : ''}`}
            onClick={() => {
              entry.onSelect()
              if (!entry.keepOpen) onClose()
            }}
          >
            {entry.icon && <span className={styles.icon}>{entry.icon}</span>}
            <span className={styles.label}>{entry.label}</span>
            {entry.note && <span className={styles.note}>{entry.note}</span>}
            {entry.shortcut && <kbd className={styles.kbd} aria-hidden="true">{entry.shortcut}</kbd>}
            {entry.checked && <span className={styles.check}><CheckIcon /></span>}
            {entry.submenu && <span className={styles.chevron}><ChevronRightIcon /></span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
