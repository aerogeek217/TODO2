import { Fragment, useCallback, useEffect, useRef, useState, type HTMLAttributes, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { RailSide, Slot, SlotKind, Tab } from '../../../models/canvas-rails'
import { KIND_ICON, KIND_LABEL } from '../../../utils/slot-kind'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import {
  encodeRailsDropId,
  RAILS_DRAG_TYPE,
  type RailsDragData,
} from '../../../utils/rail-dnd'
import styles from './TabStrip.module.css'
import menuStyles from './SlotMenu.module.css'

export interface TabStripProps {
  slot: Slot
  fromSide: RailSide
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (kind: SlotKind) => void
  onMore?: (anchor: { x: number; y: number }) => void
  onPopOut?: () => void
  onClose?: () => void
  /**
   * Called when the user picks "Change type…" from the active pill's ⋯ menu.
   * Parent opens its existing WidgetKindMenu at the anchor — the kind-change
   * flow for the active tab is identical to the single-tab title-click path.
   */
  onOpenChangeType?: (anchor: { x: number; y: number }) => void
  menuOpen?: boolean
  moreButtonRef?: Ref<HTMLButtonElement>
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> }
}

function tabLabel(tab: Tab, listName: string | undefined): string {
  if (tab.type === 'lens') return listName ?? 'List'
  if (tab.type === 'taskboard') return 'Taskboard'
  if (tab.type === 'notes') return 'Notes'
  return 'Calendar'
}

interface TabPillProps {
  slotId: string
  tab: Tab
  active: boolean
  fromSide: RailSide
  onActivate: () => void
  onClose: () => void
  /** Fires when the pill's ⋯ button is clicked. Only rendered when provided. */
  onMore?: (anchor: { x: number; y: number }) => void
  menuOpen?: boolean
}

function TabPill({ slotId, tab, active, fromSide, onActivate, onClose, onMore, menuOpen, buttonRef }: TabPillProps & { buttonRef?: Ref<HTMLButtonElement> }) {
  const listName = useListDefinitionStore((s) =>
    tab.type === 'lens' && tab.listDefinitionId != null
      ? s.listDefinitions.find((d) => d.id === tab.listDefinitionId)?.name
      : undefined
  )
  const label = tabLabel(tab, listName)
  const ariaLabel = `${KIND_LABEL[tab.type]} tab: ${label}`

  const dragData: RailsDragData = {
    type: RAILS_DRAG_TYPE,
    kind: 'tab',
    slotId,
    tabId: tab.id,
    fromSide,
  }
  const draggable = useDraggable({
    id: `rails-tab-drag:${slotId}:${tab.id}`,
    data: dragData,
  })

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      className={`${styles.pill} ${active ? styles.active : ''} ${draggable.isDragging ? styles.dragging : ''}`}
      role="tab"
      id={tab.id}
      aria-selected={active}
      data-tab-id={tab.id}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.pillButton}
        onClick={onActivate}
        aria-label={ariaLabel}
        title={label}
        tabIndex={active ? 0 : -1}
      >
        <span className={styles.kindIcon} aria-hidden="true">{KIND_ICON[tab.type]}</span>
        <span className={styles.label}>{label}</span>
      </button>
      {onMore && (
        <button
          type="button"
          className={styles.moreBtn}
          onClick={(e) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${label} tab options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? true : false}
          title="Tab options"
        >
          ⋯
        </button>
      )}
      <button
        type="button"
        className={styles.closeBtn}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Close ${label}`}
        title="Close tab"
      >
        ×
      </button>
    </div>
  )
}

interface PillMenuProps {
  anchor: { x: number; y: number }
  canPopOut: boolean
  canChangeType: boolean
  onPopOut: () => void
  onChangeType: () => void
  onClose: () => void
}

function PillMenu({ anchor, canPopOut, canChangeType, onPopOut, onChangeType, onClose }: PillMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  const getItems = useCallback((): HTMLButtonElement[] => {
    if (!ref.current) return []
    const nodes = ref.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
    return Array.from(nodes)
  }, [])

  useEffect(() => {
    const items = getItems()
    items[0]?.focus()
  }, [getItems])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => { document.removeEventListener('mousedown', handleOutside) }
  }, [onClose])

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

  const moveFocus = (delta: 1 | -1) => {
    const items = getItems()
    if (items.length === 0) return
    const current = document.activeElement as HTMLElement | null
    const idx = current ? items.findIndex((el) => el === current) : -1
    const next = idx === -1 ? (delta === 1 ? 0 : items.length - 1) : (idx + delta + items.length) % items.length
    items[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'Tab') onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className={menuStyles.menu}
      style={{ left: anchor.x, top: anchor.y }}
      role="menu"
      aria-label="Tab options"
      onKeyDown={onKeyDown}
    >
      {canPopOut && (
        <button
          type="button"
          role="menuitem"
          className={menuStyles.item}
          onClick={() => { onPopOut(); onClose() }}
        >
          Pop out to canvas
        </button>
      )}
      {canChangeType && (
        <button
          type="button"
          role="menuitem"
          className={menuStyles.item}
          onClick={() => { onChangeType(); onClose() }}
        >
          Change type…
        </button>
      )}
    </div>,
    document.body,
  )
}

/**
 * Compute insertion index from pointer X against the strip's pill midpoints.
 * Returns a value in [0, tabCount] suitable for `applyReorderTab` /
 * `applyMoveTabToSlot`. Reads `[data-tab-id]` elements within the container.
 */
function computeInsertIdx(stripEl: HTMLElement, pointerX: number, sourceTabId: string | null): number {
  const pills = Array.from(stripEl.querySelectorAll<HTMLElement>('[data-tab-id]'))
  // Build the post-removal pill list to align with reducer semantics.
  const survivors = sourceTabId != null
    ? pills.filter((p) => p.dataset.tabId !== sourceTabId)
    : pills
  for (let i = 0; i < survivors.length; i++) {
    const rect = survivors[i].getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    if (pointerX < mid) return i
  }
  return survivors.length
}

export function TabStrip({
  slot,
  fromSide,
  onActivateTab,
  onCloseTab,
  onAddTab,
  onMore,
  onPopOut,
  onClose,
  onOpenChangeType,
  menuOpen,
  moreButtonRef,
  dragHandleProps,
}: TabStripProps) {
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null)
  const [pillMenuAnchor, setPillMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}

  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const pillButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const focusPillAt = (idx: number) => {
    const tab = slot.tabs[idx]
    if (!tab) return
    const btn = pillButtonRefs.current.get(tab.id)
    btn?.focus()
  }

  const onTabsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const pillEl = target.closest('[data-tab-id]') as HTMLElement | null
    if (!pillEl) return
    const currentTabId = pillEl.dataset.tabId
    if (!currentTabId) return
    const currentIdx = slot.tabs.findIndex((t) => t.id === currentTabId)
    if (currentIdx === -1) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const nextIdx = (currentIdx - 1 + slot.tabs.length) % slot.tabs.length
      const nextTab = slot.tabs[nextIdx]
      onActivateTab(nextTab.id)
      // Focus moves on next render when tabIndex flips; defer.
      queueMicrotask(() => focusPillAt(nextIdx))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = (currentIdx + 1) % slot.tabs.length
      const nextTab = slot.tabs[nextIdx]
      onActivateTab(nextTab.id)
      queueMicrotask(() => focusPillAt(nextIdx))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onActivateTab(slot.tabs[0].id)
      queueMicrotask(() => focusPillAt(0))
    } else if (e.key === 'End') {
      e.preventDefault()
      const lastIdx = slot.tabs.length - 1
      onActivateTab(slot.tabs[lastIdx].id)
      queueMicrotask(() => focusPillAt(lastIdx))
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onCloseTab(currentTabId)
    }
  }

  const dropId = encodeRailsDropId({ kind: 'tab-strip', slotId: slot.id })
  const droppable = useDroppable({
    id: dropId,
    data: { type: RAILS_DRAG_TYPE, slotId: slot.id },
  })

  // Track pointer over the strip while a tab drag is hovering, computing the
  // live insertion index for the visual caret.
  useEffect(() => {
    if (!droppable.isOver) {
      setHoverIdx(null)
      return
    }
    const onMove = (e: PointerEvent) => {
      const el = tabsContainerRef.current
      if (!el) return
      // We don't know the source tab id from here; the indicator clamps fine
      // either way since worst case it offsets by 1 pill.
      setHoverIdx(computeInsertIdx(el, e.clientX, null))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [droppable.isOver])

  return (
    <div
      ref={droppable.setNodeRef}
      className={`${styles.strip} ${droppable.isOver ? styles.stripOver : ''}`}
      role="tablist"
      aria-label="Slot tabs"
      data-drop-id={dropId}
    >
      {dragHandleProps && (
        <span
          {...dragRest}
          ref={dragRef}
          className={styles.dragHandle}
          aria-label="Reorder slot"
          role="button"
          tabIndex={-1}
        >
          ⋮⋮
        </span>
      )}
      <div
        className={styles.tabs}
        ref={tabsContainerRef}
        onKeyDown={onTabsKeyDown}
      >
        {slot.tabs.map((tab, idx) => {
          const isActive = tab.id === slot.activeTabId
          const canShowPillMenu = isActive && (Boolean(onPopOut) || Boolean(onOpenChangeType))
          return (
            <Fragment key={tab.id}>
              {hoverIdx === idx && <span className={styles.insertCaret} aria-hidden="true" data-testid="tab-insert-caret" />}
              <TabPill
                slotId={slot.id}
                tab={tab}
                active={isActive}
                fromSide={fromSide}
                onActivate={() => onActivateTab(tab.id)}
                onClose={() => onCloseTab(tab.id)}
                onMore={canShowPillMenu ? (anchor) => setPillMenuAnchor(anchor) : undefined}
                menuOpen={canShowPillMenu && pillMenuAnchor !== null}
                buttonRef={(el) => {
                  if (el) pillButtonRefs.current.set(tab.id, el)
                  else pillButtonRefs.current.delete(tab.id)
                }}
              />
            </Fragment>
          )
        })}
        {hoverIdx === slot.tabs.length && <span className={styles.insertCaret} aria-hidden="true" data-testid="tab-insert-caret" />}
        <button
          type="button"
          className={styles.addBtn}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            setAddAnchor({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-label="Add tab"
          aria-haspopup="menu"
          aria-expanded={addAnchor !== null}
          title="Add tab"
        >
          +
        </button>
      </div>
      <div className={styles.chrome}>
        {onPopOut && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onPopOut}
            aria-label="Pop out to canvas"
            title="Pop out to canvas"
          >
            ↗
          </button>
        )}
        {onMore && (
          <button
            ref={moreButtonRef}
            type="button"
            className={styles.iconButton}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              onMore({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-label="Slot options"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? true : false}
            title="Options"
          >
            ⋯
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close slot"
            title="Close slot"
          >
            ×
          </button>
        )}
      </div>
      {addAnchor && (
        <WidgetKindMenu
          anchor={addAnchor}
          onChangeKind={(kind) => { onAddTab(kind); setAddAnchor(null) }}
          onClose={() => setAddAnchor(null)}
          heading="Add tab"
        />
      )}
      {pillMenuAnchor && (
        <PillMenu
          anchor={pillMenuAnchor}
          canPopOut={Boolean(onPopOut)}
          canChangeType={Boolean(onOpenChangeType)}
          onPopOut={() => { onPopOut?.() }}
          onChangeType={() => { onOpenChangeType?.(pillMenuAnchor) }}
          onClose={() => setPillMenuAnchor(null)}
        />
      )}
    </div>
  )
}
