import { Fragment, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { RailSide, Slot, SlotKind, Tab } from '../../../models/canvas-rails'
import { KIND_ICON, KIND_LABEL } from '../../../utils/slot-kind'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import {
  encodeRailsDropId,
  RAILS_DRAG_ID_TAB_PREFIX,
  RAILS_DRAG_TYPE,
  type RailsDragData,
} from '../../../utils/rail-dnd'
import { computeTabInsertIdx } from '../../../utils/rail-dnd-monitor-helpers'
import styles from './TabStrip.module.css'

export interface TabStripProps {
  slot: Slot
  fromSide: RailSide
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (kind: SlotKind, anchor: { x: number; y: number }) => void
  onMore?: (anchor: { x: number; y: number }) => void
  onPopOut?: () => void
  /**
   * Called when the user right-clicks a tab pill. The parent opens its
   * `WidgetKindMenu` at the click coordinates; the `tabId` arg picks which
   * tab the menu's kind change applies to (routed through `changeTabType`
   * for non-active pills, `setSlotKind` for the active pill so slot-level
   * fields are preserved as a unit).
   */
  onOpenChangeType?: (tabId: string, anchor: { x: number; y: number }) => void
  onClose?: () => void
  /**
   * Provided only on the first slot of each rail. When set, the chrome row
   * renders a chevron button that toggles the rail's collapsed state. The
   * glyph points in the direction the canvas-facing edge will move on click
   * (toward the viewport edge, since collapsing pulls the rail away from the
   * canvas).
   */
  onCollapseRail?: () => void
  /** Optional meta slot rendered in the chrome area (e.g. calendar orientation toggle, lens count). */
  meta?: ReactNode
  /** Slot-level `⋯` options menu open state (for aria-expanded). */
  menuOpen?: boolean
  /** Per-pill kind-change menu open state (for aria-expanded). */
  changeTypeMenuOpen?: boolean
  /**
   * When the per-pill kind-change menu is open, the tab id it targets — used
   * to set `aria-expanded` on that specific pill instead of every pill.
   * `undefined` collapses to "no per-pill menu active".
   */
  changeTypeMenuTabId?: string
  moreButtonRef?: Ref<HTMLButtonElement>
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> }
}

function tabLabel(tab: Tab, listName: string | undefined): string {
  if (tab.type === 'lens') return listName ?? KIND_LABEL.lens
  return KIND_LABEL[tab.type]
}

/** Direction the rail's canvas-facing edge moves on collapse (toward viewport edge). */
function collapseGlyph(side: RailSide): string {
  if (side === 'left') return '◂'
  if (side === 'right') return '▸'
  if (side === 'top') return '▴'
  return '▾'
}

interface TabPillProps {
  slotId: string
  tab: Tab
  active: boolean
  fromSide: RailSide
  onActivate: () => void
  onClose: () => void
  /** When provided, right-clicking the pill opens the kind-change menu for that tab at the click coords. */
  onOpenChangeType?: (tabId: string, anchor: { x: number; y: number }) => void
  pillMenuOpen?: boolean
}

function TabPill({ slotId, tab, active, fromSide, onActivate, onClose, onOpenChangeType, pillMenuOpen, buttonRef }: TabPillProps & { buttonRef?: Ref<HTMLButtonElement> }) {
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
    id: `${RAILS_DRAG_ID_TAB_PREFIX}${slotId}:${tab.id}`,
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
      onContextMenu={(e) => {
        if (!onOpenChangeType) return
        e.preventDefault()
        onOpenChangeType(tab.id, { x: e.clientX, y: e.clientY })
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.pillButton}
        onClick={onActivate}
        aria-label={ariaLabel}
        title={label}
        tabIndex={active ? 0 : -1}
        aria-haspopup={onOpenChangeType ? 'menu' : undefined}
        aria-expanded={onOpenChangeType ? (pillMenuOpen ? true : false) : undefined}
      >
        <span className={styles.kindIcon} aria-hidden="true">{KIND_ICON[tab.type]}</span>
        <span className={styles.label}>{label}</span>
      </button>
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

export function TabStrip({
  slot,
  fromSide,
  onActivateTab,
  onCloseTab,
  onAddTab,
  onMore,
  onPopOut,
  onOpenChangeType,
  onClose,
  onCollapseRail,
  meta,
  menuOpen,
  changeTypeMenuOpen,
  changeTypeMenuTabId,
  moreButtonRef,
  dragHandleProps,
}: TabStripProps) {
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null)
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
      if (!nextTab) return
      onActivateTab(nextTab.id)
      queueMicrotask(() => focusPillAt(nextIdx))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = (currentIdx + 1) % slot.tabs.length
      const nextTab = slot.tabs[nextIdx]
      if (!nextTab) return
      onActivateTab(nextTab.id)
      queueMicrotask(() => focusPillAt(nextIdx))
    } else if (e.key === 'Home') {
      e.preventDefault()
      const firstTab = slot.tabs[0]
      if (!firstTab) return
      onActivateTab(firstTab.id)
      queueMicrotask(() => focusPillAt(0))
    } else if (e.key === 'End') {
      e.preventDefault()
      const lastIdx = slot.tabs.length - 1
      const lastTab = slot.tabs[lastIdx]
      if (!lastTab) return
      onActivateTab(lastTab.id)
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

  useEffect(() => {
    if (!droppable.isOver) {
      setHoverIdx(null)
      return
    }
    const onMove = (e: PointerEvent) => {
      const el = tabsContainerRef.current
      if (!el) return
      setHoverIdx(computeTabInsertIdx(el, e.clientX, null))
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
      data-rails-drop-id={dropId}
    >
      {dragHandleProps && (
        <span
          {...dragRest}
          ref={dragRef}
          className={styles.dragHandle}
          aria-label={`Reorder slot: ${KIND_LABEL[slot.tabs.find((t) => t.id === slot.activeTabId)?.type ?? slot.tabs[0]?.type ?? 'lens']}`}
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
                onOpenChangeType={onOpenChangeType}
                pillMenuOpen={changeTypeMenuOpen && changeTypeMenuTabId === tab.id}
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
        {meta && <span className={styles.meta}>{meta}</span>}
        {onCollapseRail && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCollapseRail}
            aria-label={`Collapse ${fromSide} rail`}
            title={`Collapse ${fromSide} rail`}
          >
            {collapseGlyph(fromSide)}
          </button>
        )}
        {onPopOut && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onPopOut}
            aria-label="Pop out slot to canvas"
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
          onChangeKind={(kind) => { onAddTab(kind, addAnchor); setAddAnchor(null) }}
          onClose={() => setAddAnchor(null)}
          heading="Add tab"
        />
      )}
    </div>
  )
}
