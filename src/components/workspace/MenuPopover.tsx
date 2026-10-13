import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor, type PopoverPlacement } from '../../hooks/use-popover-anchor'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { CheckIcon, ChevronRightIcon, DashIcon } from './icons'
import styles from './MenuPopover.module.css'

export interface MenuItemEntry {
  kind: 'item'
  label: string
  icon?: ReactNode
  /** Runs on click / Enter. Optional for an item that only opens its `children`. */
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  /** Muted text: the item still works but would change little (e.g. "Followed up" twice in a day). */
  dim?: boolean
  /** Radio rows (e.g. the layout list): `checked` shows the trailing accent check. */
  radio?: boolean
  /**
   * Checkbox rows (`menuitemcheckbox`): `checked` shows the trailing accent
   * check; `'mixed'` (some of a selection) shows a dash and `aria-checked="mixed"`.
   */
  checkbox?: boolean
  checked?: boolean | 'mixed'
  /** Muted trailing text (e.g. "Edited", a current date, "1 of 3"). */
  note?: string
  /** Shows a submenu chevron; `onSelect` opens the caller's own submenu. */
  submenu?: boolean
  /**
   * A nested submenu the menu shows itself, to the right of the item (left
   * when there's no room): hover, click, Enter or → opens it; ← or Esc closes it.
   */
  children?: readonly MenuEntry[]
  /** Width of the nested submenu. */
  childrenWidth?: number
  /** Keep the menu open after `onSelect` (submenus open their own popover). */
  keepOpen?: boolean
  /** A single key that picks the item while the menu is open, shown as a kbd hint. */
  shortcut?: string
  /** A display-only key hint for an app-wide binding (e.g. `Del`, `Space`). */
  kbd?: string
  /** Tooltip — e.g. why a disabled item can't be picked. */
  title?: string
}

export type MenuEntry =
  | MenuItemEntry
  | { kind: 'separator' }
  | { kind: 'label'; text: string }

interface MenuPopoverProps {
  anchorRef?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  placement?: PopoverPlacement
  entries: readonly MenuEntry[]
  label: string
  width?: number
  /** Close when an ancestor scrolls (a menu at the pointer can't follow its row). Default false. */
  closeOnScroll?: boolean
  onClose: () => void
}

const SUBMENU_GAP_PX = 2
const VIEWPORT_MARGIN_PX = 8

function enabledItems(panel: HTMLElement | null): HTMLButtonElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>(':scope > button:not([disabled])')) : []
}

/**
 * Popover menu: 28px items with a leading icon and an optional trailing
 * note, key hint, check / mixed dash or chevron; separators and group labels;
 * radio and checkbox rows; nested submenus. ↑↓ / Home / End move, a letter
 * jumps to the next item starting with it, Enter activates, → / ← open and
 * close a submenu, Esc closes the submenu or the menu, an outside click or Tab
 * closes. Focus starts on the first enabled item and goes back to the trigger
 * when the menu closes (a menu at the pointer: to whatever had it before, on Esc).
 */
export function MenuPopover({
  anchorRef, point, placement = 'bottom-start', entries, label, width, closeOnScroll = false, onClose,
}: MenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  const [sub, setSub] = useState<number | null>(null)
  const { panelRef, style } = usePopoverAnchor({
    anchor: anchorRef ? { kind: 'ref', ref: anchorRef } : { kind: 'point', x: point?.x ?? 0, y: point?.y ?? 0 },
    open: true,
    placement,
    closeOnScroll,
    closeOnEscape: false,
    extraInsideRefs: [subRef],
    onClose,
  })
  const setRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    panelRef(el)
  }, [panelRef])

  // Focus the first item on open; on close hand focus back to the trigger —
  // for a menu at the pointer (no trigger), back to what had it before, but
  // only on Esc — unless something else took it.
  const escapedRef = useRef(false)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const trigger = anchorRef?.current ?? null
    enabledItems(menuRef.current)[0]?.focus()
    return () => {
      const target = trigger ?? (escapedRef.current ? previous : null)
      const active = document.activeElement
      const focusLeft = !active || active === document.body || !active.isConnected
      if (target && target.isConnected && focusLeft) target.focus({ preventScroll: true })
    }
  }, [anchorRef])

  const focusParentItem = useCallback((index: number) => {
    menuRef.current?.querySelector<HTMLButtonElement>(`:scope > button[data-menu-index="${index}"]`)?.focus()
  }, [])

  const closeSub = useCallback(() => {
    if (sub == null) return
    const index = sub
    setSub(null)
    focusParentItem(index)
  }, [sub, focusParentItem])

  // Esc closes the open submenu first, then the menu. Capture phase, and it
  // stops there: Esc only closes the menu.
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      if (sub != null) closeSub()
      else {
        escapedRef.current = true
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [sub, closeSub, onCloseRef])

  const select = (entry: MenuItemEntry, index: number, viaKeyboard: boolean) => {
    if (entry.children) {
      setSub(index)
      if (viaKeyboard) queueMicrotask(() => enabledItems(subRef.current)[0]?.focus())
      return
    }
    entry.onSelect?.()
    if (!entry.keepOpen) onClose()
  }

  const subEntry = sub != null ? entries[sub] : undefined

  return (
    <>
      {createPortal(
        <MenuPanel
          panelRef={setRef}
          entries={entries}
          label={label}
          className={styles.menu}
          style={{ ...style, ...(width ? { width } : {}) }}
          openIndex={sub}
          onSelect={select}
          onHoverItem={(index, entry) => {
            if (entry.children && !entry.disabled) setSub(index)
            else if (sub != null && index !== sub) setSub(null)
          }}
          onKey={(e, panel) => {
            const focusedIndex = Number((document.activeElement as HTMLElement | null)?.dataset.menuIndex ?? -1)
            const focused = entries[focusedIndex]
            if (e.key === 'ArrowRight' && focused?.kind === 'item' && focused.children && !focused.disabled) {
              e.preventDefault()
              select(focused, focusedIndex, true)
              return true
            }
            return handleMenuKeys(e, panel, entries, onClose, select)
          }}
        />,
        document.body,
      )}
      {subEntry?.kind === 'item' && subEntry.children && sub != null && (
        <Submenu
          subRef={subRef}
          parentRef={menuRef}
          parentIndex={sub}
          entries={subEntry.children}
          label={subEntry.label}
          width={subEntry.childrenWidth}
          onClose={onClose}
          onBack={closeSub}
        />
      )}
    </>
  )
}

/** Shared arrow / Home / End / Tab / type-ahead / shortcut handling. Returns true when handled. */
function handleMenuKeys(
  e: React.KeyboardEvent<HTMLDivElement>,
  panel: HTMLDivElement | null,
  entries: readonly MenuEntry[],
  onClose: () => void,
  select: (entry: MenuItemEntry, index: number, viaKeyboard: boolean) => void,
): boolean {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
    const key = e.key.toLowerCase()
    const hitIndex = entries.findIndex((en) => en.kind === 'item' && !en.disabled && en.shortcut?.toLowerCase() === key)
    const hit = entries[hitIndex]
    if (hit?.kind === 'item') {
      e.preventDefault()
      select(hit, hitIndex, true)
      return true
    }
    // Type-ahead: the next item whose label starts with the key.
    const list = enabledItems(panel)
    if (list.length === 0) return false
    const from = list.findIndex((b) => b === document.activeElement)
    for (let step = 1; step <= list.length; step++) {
      const candidate = list[(from + step) % list.length]
      const text = candidate?.dataset.menuLabel ?? ''
      if (text.toLowerCase().startsWith(key)) {
        e.preventDefault()
        candidate?.focus()
        return true
      }
    }
    return false
  }
  const list = enabledItems(panel)
  if (list.length === 0) return false
  const idx = list.findIndex((b) => b === document.activeElement)
  let next: number | null = null
  if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % list.length
  else if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = list.length - 1
  else if (e.key === 'Tab') { onClose(); return true }
  if (next == null) return false
  e.preventDefault()
  list[next]?.focus()
  return true
}

function MenuPanel({ panelRef, entries, label, className, style, openIndex, onSelect, onHoverItem, onKey }: {
  panelRef: (el: HTMLDivElement | null) => void
  entries: readonly MenuEntry[]
  label: string
  className: string | undefined
  style: React.CSSProperties
  openIndex: number | null
  onSelect: (entry: MenuItemEntry, index: number, viaKeyboard: boolean) => void
  onHoverItem?: (index: number, entry: MenuItemEntry) => void
  onKey: (e: React.KeyboardEvent<HTMLDivElement>, panel: HTMLDivElement | null) => boolean
}) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const setRef = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
    panelRef(el)
  }, [panelRef])
  return (
    <div
      ref={setRef}
      role="menu"
      aria-label={label}
      className={className}
      style={style}
      // Arrows / Enter / Space here are the menu's, not the app's (no task
      // cursor move, edit or complete behind it).
      data-shortcut-scope="none"
      onKeyDown={(e) => { onKey(e, elRef.current) }}
      // Portaled, but React events still bubble to the opener (a task row's
      // select / drag / open handlers) — keep them inside.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className={styles.separator} role="separator" />
        if (entry.kind === 'label') return <div key={i} className={styles.groupLabel} role="presentation">{entry.text}</div>
        const hasSub = entry.submenu || !!entry.children
        const role = entry.radio ? 'menuitemradio' : entry.checkbox ? 'menuitemcheckbox' : 'menuitem'
        const ariaChecked = entry.radio
          ? entry.checked === true
          : entry.checkbox ? (entry.checked === 'mixed' ? 'mixed' : entry.checked === true) : undefined
        return (
          <button
            key={i}
            type="button"
            role={role}
            aria-checked={ariaChecked}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={entry.children ? openIndex === i : undefined}
            aria-keyshortcuts={entry.shortcut}
            disabled={entry.disabled}
            data-menu-index={i}
            data-menu-label={entry.label}
            title={entry.title}
            className={`${styles.item} ${entry.danger ? styles.danger : ''} ${entry.dim ? styles.dim : ''} ${entry.children && openIndex === i ? styles.itemOpen : ''}`}
            onPointerEnter={onHoverItem ? () => onHoverItem(i, entry) : undefined}
            onClick={(e) => onSelect(entry, i, e.detail === 0)}
          >
            {entry.icon && <span className={styles.icon}>{entry.icon}</span>}
            <span className={styles.label}>{entry.label}</span>
            {entry.note && <span className={styles.note}>{entry.note}</span>}
            {entry.shortcut && <kbd className={styles.kbd} aria-hidden="true">{entry.shortcut}</kbd>}
            {entry.kbd && <kbd className={styles.kbd} aria-hidden="true">{entry.kbd}</kbd>}
            {entry.checked === true && <span className={styles.check}><CheckIcon /></span>}
            {entry.checked === 'mixed' && <span className={styles.check}><DashIcon /></span>}
            {hasSub && <span className={styles.chevron}><ChevronRightIcon /></span>}
          </button>
        )
      })}
    </div>
  )
}

/** A nested submenu beside its parent item; flips left when there's no room on the right. */
function Submenu({ subRef, parentRef, parentIndex, entries, label, width, onClose, onBack }: {
  subRef: RefObject<HTMLDivElement | null>
  parentRef: RefObject<HTMLDivElement | null>
  parentIndex: number
  entries: readonly MenuEntry[]
  label: string
  width?: number
  onClose: () => void
  onBack: () => void
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const setRef = useCallback((el: HTMLDivElement | null) => { subRef.current = el }, [subRef])

  useLayoutEffect(() => {
    const panel = parentRef.current
    const el = subRef.current
    const item = panel?.querySelector<HTMLElement>(`:scope > button[data-menu-index="${parentIndex}"]`)
    if (!panel || !el || !item) return
    const p = panel.getBoundingClientRect()
    const it = item.getBoundingClientRect()
    const s = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = p.right + SUBMENU_GAP_PX
    if (left + s.width > vw - VIEWPORT_MARGIN_PX) left = Math.max(VIEWPORT_MARGIN_PX, p.left - SUBMENU_GAP_PX - s.width)
    // Line the first item up with the parent item (the panel has 4px padding).
    let top = it.top - 4
    if (top + s.height > vh - VIEWPORT_MARGIN_PX) top = Math.max(VIEWPORT_MARGIN_PX, vh - VIEWPORT_MARGIN_PX - s.height)
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [parentRef, subRef, parentIndex, entries])

  const select = (entry: MenuItemEntry) => {
    if (!entry.onSelect) return
    entry.onSelect()
    if (!entry.keepOpen) onClose()
  }

  return createPortal(
    <MenuPanel
      panelRef={setRef}
      entries={entries}
      label={label}
      className={`${styles.menu} ${styles.submenu}`}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, ...(width ? { width } : {}) }}
      openIndex={null}
      onSelect={(entry) => select(entry)}
      onKey={(e, panel) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onBack()
          return true
        }
        return handleMenuKeys(e, panel, entries, onClose, (entry) => select(entry))
      }}
    />,
    document.body,
  )
}
