import { Fragment, useEffect, useRef, useState, type HTMLAttributes, type Ref } from 'react'
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

export interface TabStripProps {
  slot: Slot
  fromSide: RailSide
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (kind: SlotKind) => void
  onMore?: (anchor: { x: number; y: number }) => void
  onPopOut?: () => void
  onClose?: () => void
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
}

function TabPill({ slotId, tab, active, fromSide, onActivate, onClose }: TabPillProps) {
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
      aria-selected={active}
      data-tab-id={tab.id}
    >
      <button
        type="button"
        className={styles.pillButton}
        onClick={onActivate}
        aria-label={ariaLabel}
        title={label}
      >
        <span className={styles.kindIcon} aria-hidden="true">{KIND_ICON[tab.type]}</span>
        <span className={styles.label}>{label}</span>
      </button>
      <button
        type="button"
        className={styles.closeBtn}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label={`Close ${label}`}
        title="Close tab"
      >
        ×
      </button>
    </div>
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
  menuOpen,
  moreButtonRef,
  dragHandleProps,
}: TabStripProps) {
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null)
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}

  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

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
      <div className={styles.tabs} ref={tabsContainerRef}>
        {slot.tabs.map((tab, idx) => (
          <Fragment key={tab.id}>
            {hoverIdx === idx && <span className={styles.insertCaret} aria-hidden="true" data-testid="tab-insert-caret" />}
            <TabPill
              slotId={slot.id}
              tab={tab}
              active={tab.id === slot.activeTabId}
              fromSide={fromSide}
              onActivate={() => onActivateTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          </Fragment>
        ))}
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
            ↙
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
    </div>
  )
}
