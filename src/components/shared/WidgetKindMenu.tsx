import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { WidgetKind } from '../../models/workspace-layout'
import { WidgetKindIcon } from '../workspace/icons'
import { ListDefinitionPickerBody } from '../overlays/ListDefinitionPickerBody'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './WidgetKindMenu.module.css'

const PRIMARY_KINDS: { kind: WidgetKind; label: string }[] = [
  { kind: 'lens', label: 'List' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'eisenhower', label: 'Eisenhower' },
  { kind: 'dashboard', label: 'Dashboard' },
]

/** One choice of a {@link WidgetSetting}. */
export interface WidgetSettingOption {
  key: string
  label: string
  /** Muted trailing text (e.g. the cut-off date a range implies). */
  note?: string
  checked: boolean
  onSelect: () => void
}

/**
 * A widget setting listed first in the tab menu: an item with its current
 * value that opens a submenu of radio choices (e.g. the Eisenhower widget's
 * due-date range).
 */
export interface WidgetSetting {
  label: string
  /** The current value, right-aligned on the item. */
  value: string
  /** Group label at the top of the submenu. */
  heading: string
  options: readonly WidgetSettingOption[]
  /** Muted note under the choices. */
  footnote?: string
}

/**
 * A panel a widget action opens beside its item (e.g. the dashboard's
 * `Hot is ›`): controls rather than menu choices, so it's a small dialog —
 * changes apply as they're made and it stays open until Esc / ← / a click
 * outside the menu.
 */
export interface WidgetMenuPanel {
  /** The panel's accessible name. */
  label: string
  width: number
  render: () => ReactNode
}

/** A widget action in the tab menu: runs and closes, or opens a {@link WidgetMenuPanel}. */
export type WidgetMenuAction =
  | { label: string; icon?: ReactNode; onSelect: () => void; note?: undefined; panel?: undefined }
  | { label: string; icon?: ReactNode; note?: string; panel: WidgetMenuPanel; onSelect?: undefined }

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
  widgetActions?: ReadonlyArray<WidgetMenuAction>
  /**
   * Lens-only, workspace order: when given, the menu opens with the list's
   * own items — "List options…", "Edit list…", "Change list ›" (showing
   * `currentListName`) — then the widget actions, then "Change widget".
   */
  onListOptions?: () => void
  currentListName?: string
  /** A setting of the widget, listed first (see {@link WidgetSetting}). */
  widgetSetting?: WidgetSetting
}

const FLYOUT_LEAVE_DELAY_MS = 120
const PANEL_FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
const FLYOUT_WIDTH_PX = 240
const SETTING_FLYOUT_WIDTH_PX = 248
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
  widgetSetting,
}: WidgetKindMenuProps) {
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const listRowRef = useRef<HTMLButtonElement | null>(null)
  const settingFlyoutRef = useRef<HTMLDivElement | null>(null)
  const settingRowRef = useRef<HTMLButtonElement | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelRowRefs = useRef(new Map<number, HTMLButtonElement>())
  /** The open action panel; `pinned` = opened by a click / key (pointer leave doesn't close it). */
  const [panel, setPanel] = useState<{ index: number; pinned: boolean } | null>(null)
  const [flyout, setFlyout] = useState<{ x: number; y: number } | null>(null)
  /** The setting submenu; `focus` = opened from the keyboard / a click (focus moves into it). */
  const [settingFlyout, setSettingFlyout] = useState<{ x: number; y: number; focus: boolean } | null>(null)

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
    extraInsideRefs: [flyoutRef, settingFlyoutRef, panelRef],
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

  // The setting submenu: kept in the viewport (flips to the row's left), and
  // focus moves to its checked choice when opened from the keyboard / a click.
  useEffect(() => {
    if (!settingFlyout) return
    const el = settingFlyoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
      const row = settingRowRef.current?.getBoundingClientRect()
      el.style.left = `${row ? Math.max(VIEWPORT_MARGIN_PX, row.left - rect.width - 2) : VIEWPORT_MARGIN_PX}px`
    }
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
      el.style.top = `${Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX)}px`
    }
    if (settingFlyout.focus) {
      const radios = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      const target = radios.find((r) => r.getAttribute('aria-checked') === 'true') ?? radios[0]
      target?.focus()
    }
  }, [settingFlyout])

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
      setSettingFlyout(null)
      setPanel((p) => (p?.pinned ? p : null))
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

  const openSettingFlyout = (focus: boolean) => {
    cancelLeaveTimer()
    const row = settingRowRef.current
    if (!row) return
    const rect = row.getBoundingClientRect()
    setFlyout(null)
    setSettingFlyout((prev) => (prev && !focus ? prev : { x: rect.right + 2, y: rect.top, focus }))
  }

  /** Opens action `index`'s panel; from a click / key it stays open and takes focus. */
  const openPanel = (index: number, pinned: boolean) => {
    cancelLeaveTimer()
    setFlyout(null)
    setSettingFlyout(null)
    setPanel((prev) => (prev && prev.index === index && (prev.pinned || !pinned) ? prev : { index, pinned }))
    if (pinned) {
      // Once it's mounted: focus its first control.
      requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLElement>(PANEL_FOCUSABLE)?.focus()
      })
    }
  }

  const closePanel = () => {
    if (!panel) return
    const row = panelRowRefs.current.get(panel.index)
    setPanel(null)
    queueMicrotask(() => row?.focus())
  }

  const closeSettingFlyout = () => {
    queueMicrotask(() => settingRowRef.current?.focus())
    setSettingFlyout(null)
  }

  const onSettingFlyoutKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const radios = Array.from(settingFlyoutRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const idx = radios.findIndex((r) => r === document.activeElement)
    const move = (to: number) => radios[Math.max(0, Math.min(radios.length - 1, to))]?.focus()
    let handled = true
    if (e.key === 'ArrowDown') move(idx + 1)
    else if (e.key === 'ArrowUp') move(idx === -1 ? radios.length - 1 : idx - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(radios.length - 1)
    else if (e.key === 'ArrowLeft' || e.key === 'Escape') closeSettingFlyout()
    else if (e.key === 'Tab') onClose()
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const focusedPanelIndex = (): number | null => {
    for (const [index, el] of panelRowRefs.current) if (el === document.activeElement) return index
    return null
  }

  const focusListRow = () => {
    if (!flyout) return
    queueMicrotask(() => listRowRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (panel) {
        closePanel()
        return
      }
      if (settingFlyout) {
        closeSettingFlyout()
        return
      }
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
    else if (e.key === 'ArrowRight' && document.activeElement === settingRowRef.current) {
      e.preventDefault()
      openSettingFlyout(true)
    }
    else if (e.key === 'ArrowRight' && focusedPanelIndex() != null) {
      e.preventDefault()
      openPanel(focusedPanelIndex()!, true)
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
  const actionItems = widgetActions?.map((a, index) => (a.panel ? (
    <button
      type="button"
      key={a.label}
      ref={(el) => {
        if (el) panelRowRefs.current.set(index, el)
        else panelRowRefs.current.delete(index)
      }}
      role="menuitem"
      className={styles.item}
      aria-haspopup="dialog"
      aria-expanded={panel?.index === index}
      onPointerEnter={() => openPanel(index, false)}
      onPointerLeave={scheduleClose}
      onClick={() => openPanel(index, true)}
    >
      {!listFirst && <span className={styles.icon} aria-hidden="true">{a.icon ?? ''}</span>}
      <span className={styles.label}>{a.label}</span>
      {a.note && <span className={styles.note}>{a.note}</span>}
      <span className={styles.caret} aria-hidden="true">▸</span>
    </button>
  ) : (
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
  )))
  const openPanelAction = panel ? widgetActions?.[panel.index] : undefined
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
        <span className={styles.icon} aria-hidden="true"><WidgetKindIcon kind={k.kind} /></span>
        <span className={styles.label}>{k.label}</span>
        {active && <span className={styles.check} aria-hidden="true">✓</span>}
      </button>
    )
  })

  const settingItem = widgetSetting && (
    <>
      <button
        ref={settingRowRef}
        type="button"
        role="menuitem"
        className={styles.item}
        onPointerEnter={() => openSettingFlyout(false)}
        onPointerLeave={scheduleClose}
        onClick={() => openSettingFlyout(true)}
        aria-haspopup="menu"
        aria-expanded={settingFlyout != null}
      >
        <span className={styles.label}>{widgetSetting.label}</span>
        <span className={styles.note}>{widgetSetting.value}</span>
        <span className={styles.caret} aria-hidden="true">▸</span>
      </button>
      <div className={styles.separator} />
    </>
  )

  return createPortal(
    <div
      ref={setMenuRef}
      className={styles.menu}
      style={menuStyle}
      role="menu"
      aria-label={heading}
      // Arrows / Enter / Space here are the menu's, not the app's shortcuts.
      data-shortcut-scope="none"
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
          {settingItem}
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
      {settingFlyout && widgetSetting && createPortal(
        <div
          ref={settingFlyoutRef}
          className={`${styles.flyout} ${styles.settingFlyout}`}
          style={{ left: settingFlyout.x, top: settingFlyout.y, width: SETTING_FLYOUT_WIDTH_PX }}
          role="menu"
          aria-label={widgetSetting.heading}
          data-shortcut-scope="none"
          onPointerEnter={cancelLeaveTimer}
          onPointerLeave={scheduleClose}
          onKeyDown={onSettingFlyoutKeyDown}
        >
          <div className={styles.flyoutLabel}>{widgetSetting.heading}</div>
          {widgetSetting.options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              aria-checked={o.checked}
              className={`${styles.radioItem} ${o.checked ? styles.radioChecked : ''}`}
              onClick={() => { o.onSelect(); onClose() }}
            >
              <span className={styles.radio} aria-hidden="true" />
              <span className={styles.label}>{o.label}</span>
              {o.note && <span className={styles.radioNote}>{o.note}</span>}
            </button>
          ))}
          {widgetSetting.footnote && (
            <>
              <div className={styles.separator} />
              <div className={styles.flyoutFootnote}>{widgetSetting.footnote}</div>
            </>
          )}
        </div>,
        document.body,
      )}
      {panel && openPanelAction?.panel && (
        <ActionPanel
          panelRef={panelRef}
          getAnchor={() => panelRowRefs.current.get(panel.index) ?? null}
          panel={openPanelAction.panel}
          onPointerEnter={cancelLeaveTimer}
          onPointerLeave={panel.pinned ? undefined : scheduleClose}
          onPin={() => setPanel((p) => (p && !p.pinned ? { ...p, pinned: true } : p))}
          onBack={closePanel}
        />
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
          data-shortcut-scope="none"
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

/** An action's panel beside its menu item (flips left when there's no room). */
function ActionPanel({ panelRef, getAnchor, panel, onPointerEnter, onPointerLeave, onPin, onBack }: {
  panelRef: RefObject<HTMLDivElement | null>
  /** Its menu item. */
  getAnchor: () => HTMLElement | null
  panel: WidgetMenuPanel
  onPointerEnter: () => void
  onPointerLeave?: () => void
  onPin: () => void
  onBack: () => void
}) {
  // Before the hook's own layout effect, which places the panel against it.
  const anchorRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => { anchorRef.current = getAnchor() })
  // The menu owns dismissal (Esc, a click outside both, Tab); this only places it.
  const { panelRef: anchorPanelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'right-start',
    offset: 2,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    onClose: onBack,
  })
  const setRef = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el
    anchorPanelRef(el)
  }, [panelRef, anchorPanelRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys stay in the panel (the menu's arrows / letters don't apply here).
    e.stopPropagation()
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
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
      className={`${styles.flyout} ${styles.panelFlyout}`}
      style={{ ...style, width: panel.width }}
      role="dialog"
      aria-label={panel.label}
      data-shortcut-scope="none"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPin}
      onFocus={onPin}
      onKeyDown={onKeyDown}
    >
      {panel.render()}
    </div>,
    document.body,
  )
}
