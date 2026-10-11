import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WidgetKind } from '../../models/workspace-layout'
import { KIND_ICON } from '../../utils/slot-kind'
import { ListDefinitionPickerBody } from '../overlays/ListDefinitionPickerBody'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './WidgetKindMenu.module.css'

const PRIMARY_KINDS: { kind: WidgetKind; label: string }[] = [
  { kind: 'lens', label: 'List' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'status', label: 'Open by status' },
]

export interface WidgetKindMenuProps {
  anchor: { x: number; y: number }
  /** Current widget kind. Omit in "add" mode — no row is marked active and no secondary row is shown. */
  currentKind?: WidgetKind
  onChangeKind: (kind: WidgetKind) => void
  /**
   * Lens-only: fires when the user picks a list from the inline "Change list…" flyout.
   * When provided, the menu renders a hover submenu of list definitions on the
   * secondary row; clicking a list picks it and closes the menu.
   */
  pickListForLens?: (listDefinitionId: number) => void
  /**
   * Lens-only: when provided alongside `currentKind === 'lens'`, renders an
   * "Edit list" action above the kind switcher. Caller binds the widget's
   * list-definition id; the menu just forwards the click and closes.
   */
  onEditList?: () => void
  onClose: () => void
  /** Optional label override for the secondary row (e.g. the current list-def name). */
  secondaryLabel?: string
  /** Group-label heading. Defaults to "Change widget"; use "Add widget" in add mode. */
  heading?: string
  /**
   * The widget's own actions (e.g. "Copy tasks"), listed before the kind
   * switcher. Each closes the menu after running.
   */
  widgetActions?: ReadonlyArray<{ label: string; icon?: string; onSelect: () => void }>
  /**
   * Lens-only, workspace order: when given, the menu opens with the list's
   * own items — "List options…", "Edit list…", "Change list ›" (showing
   * `currentListName`) — then the widget actions, then "Change widget".
   */
  onListOptions?: () => void
  currentListName?: string
}

const FLYOUT_LEAVE_DELAY_MS = 120
const FLYOUT_WIDTH_PX = 240
const FLYOUT_MAX_HEIGHT_PX = 320
const VIEWPORT_MARGIN_PX = 8


export function WidgetKindMenu({
  anchor,
  currentKind,
  onChangeKind,
  pickListForLens,
  onEditList,
  onClose,
  secondaryLabel,
  heading = 'Change widget',
  widgetActions,
  onListOptions,
  currentListName,
}: WidgetKindMenuProps) {
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const listRowRef = useRef<HTMLButtonElement | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const [flyout, setFlyout] = useState<{ x: number; y: number } | null>(null)

  // Parent menu — point-anchored at the click coords; the panelRef returned
  // here is the menu div. The flyout is special-cased (right-of-row anchor
  // isn't expressible by the hook's bottom/top placements) so it's tracked
  // via `extraInsideRefs` for outside-click. Escape is handled in onKeyDown
  // because it has nuance (close flyout first, then menu).
  const { panelRef: menuPanelRef, style: menuStyle } = usePopoverAnchor({
    anchor: { kind: 'point', x: anchor.x, y: anchor.y },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    onClose,
    extraInsideRefs: [flyoutRef],
  })

  const menuRef = useRef<HTMLDivElement | null>(null)
  const setMenuRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    menuPanelRef(el)
  }, [menuPanelRef])

  const getItems = useCallback((): HTMLButtonElement[] => {
    if (!menuRef.current) return []
    const nodes = menuRef.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
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

  // Clamp flyout within viewport. The parent menu is now hook-clamped; the
  // flyout still needs its own pass because right-of-row anchoring isn't
  // expressible by the hook's bottom/top placements.
  useEffect(() => {
    if (!flyout) return
    const el = flyoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
      // Flip to the left side of the row.
      const row = listRowRef.current?.getBoundingClientRect()
      const flipLeft = row ? Math.max(VIEWPORT_MARGIN_PX, row.left - rect.width - 2) : VIEWPORT_MARGIN_PX
      el.style.left = `${flipLeft}px`
    }
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
      el.style.top = `${Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX)}px`
    }
  }, [flyout])

  const cancelLeaveTimer = () => {
    if (leaveTimerRef.current != null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }

  const scheduleClose = () => {
    cancelLeaveTimer()
    leaveTimerRef.current = window.setTimeout(() => {
      setFlyout(null)
      leaveTimerRef.current = null
    }, FLYOUT_LEAVE_DELAY_MS)
  }

  useEffect(() => () => cancelLeaveTimer(), [])

  const openListFlyout = () => {
    cancelLeaveTimer()
    const row = listRowRef.current
    if (!row) return
    const rect = row.getBoundingClientRect()
    setFlyout({ x: rect.right + 2, y: rect.top })
  }

  const focusListRow = () => {
    if (!flyout) return
    queueMicrotask(() => listRowRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (flyout) {
        focusListRow()
        setFlyout(null)
        return
      }
      onClose()
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus('first') }
    else if (e.key === 'End') { e.preventDefault(); moveFocus('last') }
    else if (e.key === 'ArrowRight' && document.activeElement === listRowRef.current) {
      e.preventDefault()
      openListFlyout()
    }
    else if (e.key === 'ArrowLeft' && flyout) {
      e.preventDefault()
      focusListRow()
      setFlyout(null)
    }
    else if (e.key === 'Tab') onClose()
  }

  const showSecondaryList = currentKind === 'lens' && pickListForLens != null
  const secondaryListLabel = showSecondaryList ? 'Change list…' : null
  const showEditList = currentKind === 'lens' && onEditList != null
  const listFirst = currentKind === 'lens' && onListOptions != null

  const editListItem = showEditList && (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      onClick={() => { onEditList!(); onClose() }}
    >
      {!listFirst && <span className={styles.icon} aria-hidden="true">✎</span>}
      <span className={styles.label}>{listFirst ? 'Edit list…' : 'Edit list'}</span>
    </button>
  )
  const changeListItem = showSecondaryList && (
    <button
      ref={listRowRef}
      type="button"
      role="menuitem"
      className={styles.item}
      onPointerEnter={() => openListFlyout()}
      onPointerLeave={scheduleClose}
      onClick={() => openListFlyout()}
      aria-haspopup="menu"
      aria-expanded={flyout != null}
    >
      <span className={styles.label}>{listFirst ? 'Change list' : (secondaryLabel ?? secondaryListLabel)}</span>
      {listFirst && currentListName && <span className={styles.note}>{currentListName}</span>}
      <span className={styles.caret} aria-hidden="true">▸</span>
    </button>
  )
  const actionItems = widgetActions?.map((a) => (
    <button
      type="button"
      key={a.label}
      role="menuitem"
      className={styles.item}
      onClick={() => { a.onSelect(); onClose() }}
    >
      {!listFirst && <span className={styles.icon} aria-hidden="true">{a.icon ?? ''}</span>}
      <span className={styles.label}>{a.label}</span>
    </button>
  ))
  const kindItems = PRIMARY_KINDS.map((k) => {
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
  })

  return createPortal(
    <div
      ref={setMenuRef}
      className={styles.menu}
      style={menuStyle}
      role="menu"
      aria-label={heading}
      onKeyDown={onKeyDown}
    >
      {listFirst ? (
        <>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => { onListOptions!(); onClose() }}
          >
            <span className={styles.label}>List options…</span>
          </button>
          {editListItem}
          {changeListItem}
          <div className={styles.separator} />
          {actionItems && actionItems.length > 0 && (
            <>
              {actionItems}
              <div className={styles.separator} />
            </>
          )}
          <div className={styles.groupLabel}>{heading}</div>
          {kindItems}
        </>
      ) : (
        <>
          {showEditList && (
            <>
              {editListItem}
              {!widgetActions?.length && <div className={styles.separator} />}
            </>
          )}
          {actionItems && actionItems.length > 0 && (
            <>
              {actionItems}
              <div className={styles.separator} />
            </>
          )}
          <div className={styles.groupLabel}>{heading}</div>
          {kindItems}
          {showSecondaryList && (
            <>
              <div className={styles.separator} />
              {changeListItem}
            </>
          )}
        </>
      )}
      {flyout && pickListForLens && createPortal(
        <div
          ref={flyoutRef}
          className={styles.flyout}
          style={{
            left: flyout.x,
            top: flyout.y,
            width: FLYOUT_WIDTH_PX,
            maxHeight: FLYOUT_MAX_HEIGHT_PX,
          }}
          role="menu"
          aria-label="Change list"
          onPointerEnter={cancelLeaveTimer}
          onPointerLeave={scheduleClose}
        >
          <ListDefinitionPickerBody
            emptyLabel="No lists yet."
            onPick={(id) => { pickListForLens(id); onClose() }}
          />
        </div>,
        document.body
      )}
    </div>,
    document.body
  )
}
