import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SlotKind } from '../../models/canvas-rails'
import { KIND_ICON } from '../../utils/slot-kind'
import { ListDefinitionPickerBody } from '../overlays/ListDefinitionPickerBody'
import styles from './WidgetKindMenu.module.css'

const PRIMARY_KINDS: { kind: SlotKind; label: string }[] = [
  { kind: 'lens', label: 'List' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'taskboard', label: 'Taskboard' },
]

const STATS_KINDS: { kind: SlotKind; label: string }[] = [
  { kind: 'horizons', label: 'Horizons' },
  { kind: 'status', label: 'Open by status' },
  { kind: 'scoreboard', label: 'Discipline' },
  { kind: 'snoozeGraveyard', label: 'Snooze graveyard' },
]

export interface WidgetKindMenuProps {
  anchor: { x: number; y: number }
  /** Current widget kind. Omit in "add" mode — no row is marked active and no secondary row is shown. */
  currentKind?: SlotKind
  onChangeKind: (kind: SlotKind) => void
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
}

const FLYOUT_LEAVE_DELAY_MS = 120
const FLYOUT_WIDTH_PX = 240
const FLYOUT_MAX_HEIGHT_PX = 320

/** Which secondary row currently has its flyout open (D8: only one at a time). */
type FlyoutKind = 'list' | 'stats'

export function WidgetKindMenu({
  anchor,
  currentKind,
  onChangeKind,
  pickListForLens,
  onEditList,
  onClose,
  secondaryLabel,
  heading = 'Change widget',
}: WidgetKindMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const listRowRef = useRef<HTMLButtonElement | null>(null)
  const statsRowRef = useRef<HTMLButtonElement | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const [flyout, setFlyout] = useState<{ kind: FlyoutKind; x: number; y: number } | null>(null)

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
      const target = e.target as Node
      if (ref.current && ref.current.contains(target)) return
      if (flyoutRef.current && flyoutRef.current.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  // Clamp menu within viewport.
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

  // Clamp flyout within viewport.
  useEffect(() => {
    if (!flyout) return
    const el = flyoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    if (rect.right > window.innerWidth - margin) {
      // Flip to the left side of the row.
      const rowRef = flyout.kind === 'list' ? listRowRef : statsRowRef
      const row = rowRef.current?.getBoundingClientRect()
      const flipLeft = row ? Math.max(margin, row.left - rect.width - 2) : margin
      el.style.left = `${flipLeft}px`
    }
    if (rect.bottom > window.innerHeight - margin) {
      el.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`
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

  const openFlyoutFromRow = (kind: FlyoutKind) => {
    cancelLeaveTimer()
    const rowRef = kind === 'list' ? listRowRef : statsRowRef
    const row = rowRef.current
    if (!row) return
    const rect = row.getBoundingClientRect()
    setFlyout({ kind, x: rect.right + 2, y: rect.top })
  }

  const focusActiveSecondaryRow = () => {
    if (!flyout) return
    const rowRef = flyout.kind === 'list' ? listRowRef : statsRowRef
    queueMicrotask(() => rowRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (flyout) {
        focusActiveSecondaryRow()
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
      openFlyoutFromRow('list')
    }
    else if (e.key === 'ArrowRight' && document.activeElement === statsRowRef.current) {
      e.preventDefault()
      openFlyoutFromRow('stats')
    }
    else if (e.key === 'ArrowLeft' && flyout) {
      e.preventDefault()
      focusActiveSecondaryRow()
      setFlyout(null)
    }
    else if (e.key === 'Tab') onClose()
  }

  const showSecondaryList = currentKind === 'lens' && pickListForLens != null
  const secondaryListLabel = showSecondaryList ? 'Change list…' : null
  const showEditList = currentKind === 'lens' && onEditList != null
  // Stats kinds need to surface their "active" check when currentKind matches one of them.
  const currentIsStatsKind = currentKind != null && STATS_KINDS.some((k) => k.kind === currentKind)

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: anchor.x, top: anchor.y }}
      role="menu"
      aria-label={heading}
      onKeyDown={onKeyDown}
    >
      {showEditList && (
        <>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => { onEditList!(); onClose() }}
          >
            <span className={styles.icon} aria-hidden="true">✎</span>
            <span className={styles.label}>Edit list</span>
          </button>
          <div className={styles.separator} />
        </>
      )}
      <div className={styles.groupLabel}>{heading}</div>
      {PRIMARY_KINDS.map((k) => {
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
      {showSecondaryList && (
        <>
          <div className={styles.separator} />
          <button
            ref={listRowRef}
            type="button"
            role="menuitem"
            className={styles.item}
            onPointerEnter={() => openFlyoutFromRow('list')}
            onPointerLeave={scheduleClose}
            onClick={() => openFlyoutFromRow('list')}
            aria-haspopup="menu"
            aria-expanded={flyout?.kind === 'list'}
          >
            <span className={styles.label}>{secondaryLabel ?? secondaryListLabel}</span>
            <span className={styles.caret} aria-hidden="true">▸</span>
          </button>
        </>
      )}
      <div className={styles.separator} />
      <button
        ref={statsRowRef}
        type="button"
        role="menuitem"
        className={`${styles.item} ${currentIsStatsKind ? styles.active : ''}`}
        onPointerEnter={() => openFlyoutFromRow('stats')}
        onPointerLeave={scheduleClose}
        onClick={() => openFlyoutFromRow('stats')}
        aria-haspopup="menu"
        aria-expanded={flyout?.kind === 'stats'}
      >
        <span className={styles.icon} aria-hidden="true">{KIND_ICON.scoreboard}</span>
        <span className={styles.label}>Stats</span>
        <span className={styles.caret} aria-hidden="true">▸</span>
      </button>
      {flyout?.kind === 'list' && pickListForLens && createPortal(
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
      {flyout?.kind === 'stats' && createPortal(
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
          aria-label="Stats widgets"
          onPointerEnter={cancelLeaveTimer}
          onPointerLeave={scheduleClose}
        >
          {STATS_KINDS.map((k) => {
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
        </div>,
        document.body
      )}
    </div>,
    document.body
  )
}
