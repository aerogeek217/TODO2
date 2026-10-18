import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor, type PopoverAnchor, type PopoverPlacement } from '../../hooks/use-popover-anchor'
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
  /** A muted, wrapping line under the label (what a choice means). */
  description?: string
  /** A small accent tag after the label (e.g. `NEW`). */
  badge?: string
  /** Shows a submenu chevron; `onSelect` opens the caller's own submenu. */
  submenu?: boolean
  /**
   * A nested submenu the menu shows itself, to the right of the item (left
   * when there's no room): hover, click, Enter or → opens it; ← or Esc closes it.
   */
  children?: readonly MenuEntry[]
  /** Width of the nested submenu. */
  childrenWidth?: number
  /** Height cap of the nested submenu (it scrolls); the viewport otherwise. */
  childrenMaxHeight?: number
  /**
   * A panel of controls the menu shows beside the item, like a submenu (e.g.
   * the dashboard's Hot rule editor): a small dialog whose changes apply as
   * they're made. Hover opens it; a click, Enter or → opens it with the focus
   * inside, and so does any click or focus in it — it then stays open while
   * the pointer crosses other items. Esc or ← closes it, back on its item.
   */
  panel?: MenuPanelSpec
  /** `'radio'`: a leading radio circle shows `checked` instead of the trailing check (a setting's choices). */
  indicator?: 'radio'
  /** Keep the menu open after `onSelect` (submenus open their own popover). */
  keepOpen?: boolean
  /** A single key that picks the item while the menu is open, shown as a kbd hint. */
  shortcut?: string
  /** A display-only key hint for an app-wide binding (e.g. `Del`, `Space`). */
  kbd?: string
  /** Tooltip — e.g. why a disabled item can't be picked. */
  title?: string
}

/** What a {@link MenuItemEntry.panel} shows. */
export interface MenuPanelSpec {
  /** The panel's accessible name. */
  label: string
  width: number
  render: () => ReactNode
}

export type MenuEntry =
  | MenuItemEntry
  | { kind: 'separator' }
  | { kind: 'label'; text: string }
  /** A muted, wrapping footnote. */
  | { kind: 'note'; text: string }

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
/** The menu's padding: a submenu's first item lines up with its parent item. */
const MENU_PADDING_PX = 4
const PANEL_FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
const OFFSCREEN: PopoverAnchor = { kind: 'point', x: -9999, y: -9999 }

function enabledItems(panel: HTMLElement | null): HTMLButtonElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>(':scope > button:not([disabled])')) : []
}

/**
 * Popover menu: 28px items with a leading icon and an optional trailing
 * note, key hint, check / mixed dash or chevron; separators, group labels and
 * footnotes; radio and checkbox rows; nested submenus and panels beside an
 * item. ↑↓ / Home / End move, a letter jumps to the next item starting with
 * it, Enter activates, → / ← open and close a submenu or panel, Esc closes the
 * submenu / panel or the menu, an outside click or Tab closes. Focus starts on
 * the first enabled item and goes back to the trigger when the menu closes (a
 * menu at the pointer: to whatever had it before, on Esc). Keys inside never
 * reach the app's shortcuts (`data-shortcut-scope="none"`).
 */
export function MenuPopover({
  anchorRef, point, placement = 'bottom-start', entries, label, width, closeOnScroll = false, onClose,
}: MenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  /**
   * The open submenu or panel; `pinned` = a panel opened by a click / key or
   * used (pointer moves don't close it); `focus` = it takes the focus when it
   * opens.
   */
  const [open, setOpen] = useState<{ index: number; pinned: boolean; focus: boolean } | null>(null)
  const sub = open?.index ?? null
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
  // What had the focus when the menu opened — kept from the first run, so a
  // re-run (StrictMode's mount check) doesn't record the menu's own item.
  const previousRef = useRef<HTMLElement | null | undefined>(undefined)
  useEffect(() => {
    if (previousRef.current === undefined) {
      previousRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    const previous = previousRef.current
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
    setOpen(null)
    focusParentItem(index)
  }, [sub, focusParentItem])

  // Esc closes the open submenu / panel first, then the menu. Capture phase,
  // and it stops there: Esc only closes the menu.
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
    if (entry.panel) {
      // A click or key opens it to work in: pinned, focus on its first control.
      setOpen({ index, pinned: true, focus: true })
      return
    }
    if (entry.children) {
      setOpen({ index, pinned: false, focus: viaKeyboard })
      return
    }
    entry.onSelect?.()
    if (!entry.keepOpen) onClose()
  }

  const openEntry = sub != null ? entries[sub] : undefined

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
            if ((entry.children || entry.panel) && !entry.disabled) {
              setOpen((prev) => (prev?.index === index ? prev : { index, pinned: false, focus: false }))
            } else if (open && index !== open.index && !open.pinned) setOpen(null)
          }}
          onKey={(e, panel) => {
            const focusedIndex = Number((document.activeElement as HTMLElement | null)?.dataset.menuIndex ?? -1)
            const focused = entries[focusedIndex]
            if (e.key === 'ArrowRight' && focused?.kind === 'item' && (focused.children || focused.panel) && !focused.disabled) {
              e.preventDefault()
              select(focused, focusedIndex, true)
              return true
            }
            return handleMenuKeys(e, panel, entries, onClose, select)
          }}
        />,
        document.body,
      )}
      {openEntry?.kind === 'item' && openEntry.children && sub != null && (
        <Submenu
          subRef={subRef}
          parentRef={menuRef}
          parentIndex={sub}
          entries={openEntry.children}
          label={openEntry.label}
          width={openEntry.childrenWidth}
          maxHeight={openEntry.childrenMaxHeight}
          autoFocus={open?.focus ?? false}
          onClose={onClose}
          onBack={closeSub}
        />
      )}
      {openEntry?.kind === 'item' && openEntry.panel && sub != null && (
        <FlyoutPanel
          subRef={subRef}
          parentRef={menuRef}
          parentIndex={sub}
          panel={openEntry.panel}
          autoFocus={open?.focus ?? false}
          onPin={() => setOpen((prev) => (prev && !prev.pinned ? { ...prev, pinned: true } : prev))}
          onBack={closeSub}
        />
      )}
    </>
  )
}

/** Focus a submenu's checked choice, else its first item. */
function focusFirstChoice(panel: HTMLElement | null): void {
  const items = enabledItems(panel)
  const target = items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0]
  target?.focus()
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
      {...KEEP_EVENTS_INSIDE}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className={styles.separator} role="separator" />
        if (entry.kind === 'label') return <div key={i} className={styles.groupLabel} role="presentation">{entry.text}</div>
        if (entry.kind === 'note') return <div key={i} className={styles.footnote}>{entry.text}</div>
        const hasSub = entry.submenu || !!entry.children || !!entry.panel
        const role = entry.radio ? 'menuitemradio' : entry.checkbox ? 'menuitemcheckbox' : 'menuitem'
        const ariaChecked = entry.radio
          ? entry.checked === true
          : entry.checkbox ? (entry.checked === 'mixed' ? 'mixed' : entry.checked === true) : undefined
        const radioDot = entry.indicator === 'radio'
        const expanded = (entry.children || entry.panel) ? openIndex === i : undefined
        return (
          <button
            key={i}
            type="button"
            role={role}
            aria-checked={ariaChecked}
            aria-haspopup={entry.panel ? 'dialog' : hasSub ? 'menu' : undefined}
            aria-expanded={expanded}
            aria-keyshortcuts={entry.shortcut}
            disabled={entry.disabled}
            data-menu-index={i}
            data-menu-label={entry.label}
            title={entry.title}
            className={[
              styles.item,
              entry.danger ? styles.danger : '',
              entry.dim ? styles.dim : '',
              expanded ? styles.itemOpen : '',
              radioDot && entry.checked === true ? styles.radioChecked : '',
              entry.description ? styles.itemTall : '',
            ].join(' ')}
            onPointerEnter={onHoverItem ? () => onHoverItem(i, entry) : undefined}
            onClick={(e) => onSelect(entry, i, e.detail === 0)}
          >
            {radioDot && <span className={styles.radio} aria-hidden="true" />}
            {entry.icon && <span className={styles.icon}>{entry.icon}</span>}
            {entry.description || entry.badge ? (
              <span className={styles.labelBlock}>
                <span className={styles.labelLine}>
                  <span className={styles.label}>{entry.label}</span>
                  {entry.badge && <span className={styles.badge}>{entry.badge}</span>}
                </span>
                {entry.description && <span className={styles.description}>{entry.description}</span>}
              </span>
            ) : (
              <span className={styles.label}>{entry.label}</span>
            )}
            {entry.note && <span className={styles.note}>{entry.note}</span>}
            {entry.shortcut && <kbd className={styles.kbd} aria-hidden="true">{entry.shortcut}</kbd>}
            {entry.kbd && <kbd className={styles.kbd} aria-hidden="true">{entry.kbd}</kbd>}
            {!radioDot && entry.checked === true && <span className={styles.check}><CheckIcon /></span>}
            {entry.checked === 'mixed' && <span className={styles.check}><DashIcon /></span>}
            {hasSub && <span className={styles.chevron}><ChevronRightIcon /></span>}
          </button>
        )
      })}
    </div>
  )
}

// Portaled, but React events still bubble to the opener (a task row's select
// / drag / open handlers) — keep them inside.
const KEEP_EVENTS_INSIDE = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
}

/**
 * Places a submenu or panel beside its parent item with `usePopoverAnchor`
 * (`right-start`, flipped to the left without room on the right): against
 * the parent menu's sides, `topInset` above the item's top. The anchor is
 * measured when the item opens (the menu doesn't move while it's open).
 */
function useBesideItem(
  parentRef: RefObject<HTMLDivElement | null>,
  parentIndex: number,
  topInset: number,
  onClose: () => void,
) {
  const [rect, setRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const panel = parentRef.current
    const item = panel?.querySelector<HTMLElement>(`:scope > button[data-menu-index="${parentIndex}"]`)
    if (!panel || !item) return
    const p = panel.getBoundingClientRect()
    const it = item.getBoundingClientRect()
    setRect({ left: p.left, right: p.right, top: it.top - topInset, bottom: it.bottom + topInset })
  }, [parentRef, parentIndex, topInset])
  // The menu owns dismissal (Esc, a click outside both, Tab); this only places it.
  return usePopoverAnchor({
    anchor: rect ? { kind: 'rect', ...rect } : OFFSCREEN,
    open: true,
    placement: 'right-start',
    offset: SUBMENU_GAP_PX,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    onClose,
  })
}

/** A nested submenu beside its parent item; flips left when there's no room on the right. */
function Submenu({ subRef, parentRef, parentIndex, entries, label, width, maxHeight, autoFocus, onClose, onBack }: {
  subRef: RefObject<HTMLDivElement | null>
  parentRef: RefObject<HTMLDivElement | null>
  parentIndex: number
  entries: readonly MenuEntry[]
  label: string
  width?: number
  maxHeight?: number
  /** Opened from the keyboard: focus its checked choice, else its first item. */
  autoFocus: boolean
  onClose: () => void
  onBack: () => void
}) {
  const { panelRef, style } = useBesideItem(parentRef, parentIndex, MENU_PADDING_PX, onBack)
  const setRef = useCallback((el: HTMLDivElement | null) => {
    subRef.current = el
    panelRef(el)
  }, [subRef, panelRef])
  useEffect(() => {
    if (autoFocus) focusFirstChoice(subRef.current)
  }, [autoFocus, subRef])

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
      style={{
        position: 'fixed',
        left: style.left,
        top: style.top,
        maxHeight: maxHeight ? Math.min(maxHeight, style.maxHeight) : style.maxHeight,
        ...(width ? { width } : {}),
      }}
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

/**
 * An item's panel beside it (flips left when there's no room): a small
 * dialog. Keys stay in it (the menu's arrows / letters don't apply); Tab
 * cycles its controls; ← goes back to the item (Esc too, via the menu).
 */
function FlyoutPanel({ subRef, parentRef, parentIndex, panel, autoFocus, onPin, onBack }: {
  subRef: RefObject<HTMLDivElement | null>
  parentRef: RefObject<HTMLDivElement | null>
  parentIndex: number
  panel: MenuPanelSpec
  /** Opened by a click or key: focus its first control. */
  autoFocus: boolean
  onPin: () => void
  onBack: () => void
}) {
  const { panelRef, style } = useBesideItem(parentRef, parentIndex, 0, onBack)
  const setRef = useCallback((el: HTMLDivElement | null) => {
    subRef.current = el
    panelRef(el)
  }, [subRef, panelRef])
  useEffect(() => {
    if (autoFocus) subRef.current?.querySelector<HTMLElement>(PANEL_FOCUSABLE)?.focus()
  }, [autoFocus, subRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onBack()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE))
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      ref={setRef}
      className={`${styles.menu} ${styles.submenu} ${styles.panel}`}
      style={{ position: 'fixed', left: style.left, top: style.top, maxHeight: style.maxHeight, width: panel.width }}
      role="dialog"
      aria-label={panel.label}
      data-shortcut-scope="none"
      {...KEEP_EVENTS_INSIDE}
      onPointerDown={(e) => { e.stopPropagation(); onPin() }}
      onFocus={onPin}
      onKeyDown={onKeyDown}
    >
      {panel.render()}
    </div>,
    document.body,
  )
}
