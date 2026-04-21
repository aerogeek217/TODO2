import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useSettingsStore } from '../../../stores/settings-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useListInsetStore } from '../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../stores/floating-calendar-store'
import { useFloatingNoteStore } from '../../../stores/floating-note-store'
import { useFloatingTaskboardStore } from '../../../stores/floating-taskboard-store'
import { useTaskboardStore } from '../../../stores/taskboard-store'
import { useCanvasRailsStore, createLensSlot } from '../../../stores/canvas-rails-store'
import type { RailSide, RailsState, Slot } from '../../../models/canvas-rails'
import { getActiveTab, railSize } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { DraggableSlot } from './DraggableSlot'
import { SlotDivider } from './SlotDivider'
import { SlotHeader } from './SlotHeader'
import { TabStrip } from './TabStrip'
import { LensSlotContent } from './LensSlotContent'
import { CalendarSlotContent } from './CalendarSlotContent'
import { CalendarOrientationToggle } from './calendar/CalendarOrientationToggle'
import { NotesSlotContent } from './NotesSlotContent'
import { TaskboardSlotContent } from './TaskboardSlotContent'
import { DockOverlay } from './DockOverlay'
import { SlotMenu } from './SlotMenu'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import { TaskboardPickerPopup } from '../../overlays/TaskboardPickerPopup'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'
import {
  decodeRailsDropId,
  pointerToSplitZone,
  RAILS_DRAG_TYPE,
  type RailsDragData,
  type TabDropTarget,
} from '../../../utils/rail-dnd'
import styles from './RailsFrame.module.css'

interface RailsFrameProps {
  children: ReactNode
}

/** Default rails: right-side lens slot showing the `thisweek` horizon. */
function useDefaultRails() {
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const persistedRails = useSettingsStore((s) => s.canvasRails)
  const setCanvasRails = useSettingsStore((s) => s.setCanvasRails)
  const listDefinitionsLoaded = useListDefinitionStore((s) => s.listDefinitions.length > 0)
  const { rails, hydrated, hydrate } = useCanvasRailsStore()

  useEffect(() => {
    if (hydrated) return
    if (!listDefinitionsLoaded) return
    const hasPersisted = persistedRails && (persistedRails.left || persistedRails.right || persistedRails.top || persistedRails.bottom)
    if (hasPersisted) {
      hydrate(persistedRails)
      return
    }
    const thisweekId = horizonSlots?.thisweek
    const slot = createLensSlot(thisweekId)
    hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
  }, [hydrated, hydrate, horizonSlots, listDefinitionsLoaded, persistedRails])

  // Persist rails changes through settings (debounced inside setCanvasRails).
  useEffect(() => {
    if (!hydrated) return
    setCanvasRails(rails)
  }, [rails, hydrated, setCanvasRails])

  return rails
}

/**
 * Compute a flow-space position in the upper-left of the current viewport for
 * placing a popped-out node. Reads the persisted viewport from settings; if
 * absent (fresh install), falls back to origin. Adds a small random jitter so
 * successive pop-outs don't stack perfectly on top of each other.
 */
function computePopOutFlowPosition(): { x: number; y: number } {
  const vp = useSettingsStore.getState().canvasViewport
  const baseX = vp ? -vp.x / vp.zoom : 50
  const baseY = vp ? -vp.y / vp.zoom : 50
  const jitterX = Math.round(Math.random() * 40)
  const jitterY = Math.round(Math.random() * 40)
  return { x: baseX + 40 + jitterX, y: baseY + 40 + jitterY }
}

/**
 * Pop a rail slot out to the canvas as a free-floating node. Resolves to true
 * when a node was created (and the caller should close the slot), false if the
 * operation was a no-op (no canvas / lens without a list definition).
 *
 * Exported for testing.
 */
export async function popSlotToCanvas(slot: Slot): Promise<boolean> {
  const canvasId = useCanvasStore.getState().selectedCanvasId
  if (canvasId == null) return false
  const pos = computePopOutFlowPosition()
  const active = getActiveTab(slot)

  if (active.type === 'notes') {
    await useFloatingNoteStore.getState().add(canvasId, pos.x, pos.y)
    return true
  }
  if (active.type === 'lens') {
    if (active.listDefinitionId == null) return false
    await useListInsetStore.getState().add(active.listDefinitionId, canvasId, pos.x, pos.y)
    return true
  }
  if (active.type === 'calendar') {
    await useFloatingCalendarStore.getState().add(canvasId, pos.x, pos.y)
    return true
  }
  if (active.type === 'taskboard') {
    const tbId = active.taskboardId
      ?? useTaskboardStore.getState().defaultBoardId
      ?? (await useTaskboardStore.getState().ensureDefault())
    await useFloatingTaskboardStore.getState().add(canvasId, tbId, pos.x, pos.y)
    return true
  }
  return false
}

interface SlotRendererProps {
  slot: Slot
  fromSide: RailSide
}

function SlotRenderer({ slot, fromSide }: SlotRendererProps) {
  const closeSlot = useCanvasRailsStore((s) => s.closeSlot)
  const updateSlot = useCanvasRailsStore((s) => s.updateSlot)
  const setSlotKind = useCanvasRailsStore((s) => s.setSlotKind)
  const setSlotOrientation = useCanvasRailsStore((s) => s.setSlotOrientation)
  const setSlotWeekOffset = useCanvasRailsStore((s) => s.setSlotWeekOffset)
  const splitSlot = useCanvasRailsStore((s) => s.splitSlot)
  const addTab = useCanvasRailsStore((s) => s.addTab)
  const closeTab = useCanvasRailsStore((s) => s.closeTab)
  const activateTab = useCanvasRailsStore((s) => s.activateTab)
  const pendingFocusSlotId = useCanvasRailsStore((s) => s.pendingFocusSlotId)
  const clearPendingFocus = useCanvasRailsStore((s) => s.clearPendingFocus)
  const rails = useCanvasRailsStore((s) => s.rails)
  const [title, setTitle] = useState<string>('')
  const [count, setCount] = useState<number>(0)
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [taskboardPickerPos, setTaskboardPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [kindMenuAnchor, setKindMenuAnchor] = useState<{ x: number; y: number } | null>(null)

  const activeTab = getActiveTab(slot)

  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuOpen = menuAnchor !== null
  const kindMenuOpen = kindMenuAnchor !== null

  const closeMenuAndFocusTrigger = () => {
    setMenuAnchor(null)
    queueMicrotask(() => moreButtonRef.current?.focus())
  }

  const closeThisSlot = () => {
    // Find sibling slot id (prefer the next slot in the rail, fall back to previous)
    // so focus lands on an adjacent slot's "⋯" button after close.
    const rail = rails[fromSide]
    let siblingId: string | null = null
    if (rail) {
      const idx = rail.slots.findIndex((s) => s.id === slot.id)
      if (idx !== -1) {
        const sibling = rail.slots[idx + 1] ?? rail.slots[idx - 1]
        if (sibling) siblingId = sibling.id
      }
    }
    closeSlot(slot.id)
    if (siblingId) {
      useCanvasRailsStore.setState({ pendingFocusSlotId: siblingId })
    }
  }

  useEffect(() => {
    if (pendingFocusSlotId === slot.id && moreButtonRef.current) {
      moreButtonRef.current.focus()
      clearPendingFocus()
    }
  }, [pendingFocusSlotId, slot.id, clearPendingFocus])

  const canPopOut = !(activeTab.type === 'lens' && activeTab.listDefinitionId == null)
  const handlePopOut = canPopOut
    ? () => { void popSlotToCanvas(slot).then((moved) => { if (moved) closeSlot(slot.id) }) }
    : undefined

  const handleTitleClick = (anchor: { x: number; y: number }) => setKindMenuAnchor(anchor)

  const handleOpenSecondary = () => {
    if (!kindMenuAnchor) return
    const anchor = kindMenuAnchor
    setKindMenuAnchor(null)
    if (activeTab.type === 'lens') setPickerPos(anchor)
    else if (activeTab.type === 'taskboard') setTaskboardPickerPos(anchor)
  }

  const handleChangeKind = async (nextKind: typeof activeTab.type) => {
    if (nextKind === activeTab.type) return
    if (nextKind === 'taskboard') {
      const tbId = useTaskboardStore.getState().defaultBoardId
        ?? (await useTaskboardStore.getState().ensureDefault())
      setSlotKind(slot.id, nextKind, { taskboardId: tbId })
      return
    }
    setSlotKind(slot.id, nextKind)
  }

  let headerTitle: ReactNode
  let body: ReactNode
  let headerMeta: ReactNode = undefined
  if (activeTab.type === 'lens') {
    headerTitle = title || 'List'
    body = (
      <LensSlotContent
        listDefinitionId={activeTab.listDefinitionId}
        onTitleChange={(t, c) => {
          setTitle(t)
          setCount(c)
        }}
      />
    )
  } else if (activeTab.type === 'calendar') {
    const orientation = slot.orientation ?? 'vertical'
    headerTitle = 'Calendar'
    headerMeta = (
      <CalendarOrientationToggle
        orientation={orientation}
        onChange={(o) => setSlotOrientation(slot.id, o)}
      />
    )
    body = (
      <CalendarSlotContent
        orientation={orientation}
        weekOffset={slot.weekOffset ?? 0}
        onWeekOffsetChange={(n) => setSlotWeekOffset(slot.id, n)}
      />
    )
  } else if (activeTab.type === 'notes') {
    headerTitle = 'Notes · Inbox'
    body = <NotesSlotContent />
  } else if (activeTab.type === 'taskboard') {
    headerTitle = 'Taskboard'
    body = <TaskboardSlotContent taskboardId={activeTab.taskboardId} />
  } else {
    headerTitle = activeTab.type
    body = (
      <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-meta)' }}>
        Coming soon
      </div>
    )
  }

  const handleAddTab = async (kind: typeof activeTab.type) => {
    if (kind === 'taskboard') {
      const tbId = useTaskboardStore.getState().defaultBoardId
        ?? (await useTaskboardStore.getState().ensureDefault())
      addTab(slot.id, kind, { taskboardId: tbId })
      return
    }
    addTab(slot.id, kind)
  }

  const multiTab = slot.tabs.length >= 2
  const header = multiTab ? (
    <TabStrip
      slot={slot}
      fromSide={fromSide}
      onActivateTab={(tabId) => activateTab(slot.id, tabId)}
      onCloseTab={(tabId) => closeTab(slot.id, tabId)}
      onAddTab={(kind) => { void handleAddTab(kind) }}
      onMore={(anchor) => setMenuAnchor(anchor)}
      onPopOut={handlePopOut}
      onClose={closeThisSlot}
      menuOpen={menuOpen}
      moreButtonRef={moreButtonRef}
    />
  ) : (
    <SlotHeader
      slotKind={activeTab.type}
      title={headerTitle}
      meta={headerMeta ?? (activeTab.type === 'lens' && count > 0 ? count : undefined)}
      onMore={(anchor) => setMenuAnchor(anchor)}
      onPopOut={handlePopOut}
      menuOpen={menuOpen}
      moreButtonRef={moreButtonRef}
      onClose={closeThisSlot}
      onTitleClick={handleTitleClick}
      titleMenuOpen={kindMenuOpen}
    />
  )

  return (
    <>
      <DraggableSlot slotId={slot.id} fromSide={fromSide} header={header} flex={slot.flex}>
        {body}
      </DraggableSlot>
      {activeTab.type === 'lens' && pickerPos && (
        <ListDefinitionPickerPopup
          x={pickerPos.x}
          y={pickerPos.y}
          mode="canvas"
          onSelect={(listDefinitionId) => updateSlot(slot.id, { listDefinitionId })}
          onCreateNew={() => setShowEditor(true)}
          onClose={() => setPickerPos(null)}
        />
      )}
      {showEditor && <DashboardListsEditor onClose={() => setShowEditor(false)} />}
      {activeTab.type === 'taskboard' && taskboardPickerPos && (
        <TaskboardPickerPopup
          x={taskboardPickerPos.x}
          y={taskboardPickerPos.y}
          currentTaskboardId={activeTab.taskboardId}
          onSelect={(taskboardId) => updateSlot(slot.id, { taskboardId })}
          onClose={() => setTaskboardPickerPos(null)}
        />
      )}
      {kindMenuAnchor && (
        <WidgetKindMenu
          anchor={kindMenuAnchor}
          currentKind={activeTab.type}
          onChangeKind={(kind) => { void handleChangeKind(kind) }}
          onOpenSecondary={handleOpenSecondary}
          onClose={() => setKindMenuAnchor(null)}
        />
      )}
      {menuAnchor && (
        <SlotMenu
          anchor={menuAnchor}
          currentKind={activeTab.type}
          orientation={fromSide === 'left' || fromSide === 'right' ? 'vertical' : 'horizontal'}
          onSplit={(dir) => splitSlot(slot.id, dir)}
          onPopOut={handlePopOut}
          onAddTab={() => addTab(slot.id, 'lens')}
          onClose={closeMenuAndFocusTrigger}
        />
      )}
    </>
  )
}

function findSlotKind(rails: RailsState, slotId: string): string | null {
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (slot) return getActiveTab(slot).type
  }
  return null
}

function describeDropZone(zone: ReturnType<typeof decodeRailsDropId>, rails: RailsState): string {
  if (!zone) return 'unknown target'
  if (zone.kind === 'empty-side') return `${zone.side} rail`
  if (zone.kind === 'tab-strip') {
    const targetKind = findSlotKind(rails, zone.slotId) ?? 'slot'
    return `${targetKind} tab strip`
  }
  const targetKind = findSlotKind(rails, zone.slotId) ?? 'slot'
  return `${targetKind} slot`
}

interface RailsDragMonitorResult {
  draggingSlot: RailsDragData | null
  announcement: string
}

function findTabLabel(rails: RailsState, slotId: string, tabId: string): string | null {
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (!slot) continue
    const tab = slot.tabs.find((t) => t.id === tabId)
    if (!tab) return null
    return tab.type
  }
  return null
}

function computeTabInsertIdx(stripEl: Element, pointerX: number, sourceTabId: string | null): number {
  const pills = Array.from(stripEl.querySelectorAll<HTMLElement>('[data-tab-id]'))
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

function useRailsDragMonitor(): RailsDragMonitorResult {
  const [draggingSlot, setDraggingSlot] = useState<RailsDragData | null>(null)
  const [announcement, setAnnouncement] = useState<string>('')
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const dropSlotToSide = useCanvasRailsStore((s) => s.dropSlotToSide)
  const splitDropSlot = useCanvasRailsStore((s) => s.splitDropSlot)
  const reorderTab = useCanvasRailsStore((s) => s.reorderTab)
  const moveTabToSlot = useCanvasRailsStore((s) => s.moveTabToSlot)
  const detachTabToNewSlot = useCanvasRailsStore((s) => s.detachTabToNewSlot)
  const rails = useCanvasRailsStore((s) => s.rails)

  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as RailsDragData | undefined
      if (data?.type !== RAILS_DRAG_TYPE) return
      setDraggingSlot(data)
      if (data.kind === 'tab') {
        const label = findTabLabel(rails, data.slotId, data.tabId) ?? 'tab'
        setAnnouncement(`Dragging tab ${label}`)
      } else {
        const kind = findSlotKind(rails, data.slotId)
        setAnnouncement(`Dragging ${kind ?? 'slot'}`)
      }
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
      }
      window.addEventListener('pointermove', onMove)
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
      }
      ;(pointerRef as unknown as { cleanup?: () => void }).cleanup = cleanup
    },
    onDragEnd: ({ active, over }) => {
      const data = active.data.current as RailsDragData | undefined
      const cleanup = (pointerRef as unknown as { cleanup?: () => void }).cleanup
      if (cleanup) { cleanup(); (pointerRef as unknown as { cleanup?: () => void }).cleanup = undefined }
      if (data?.type !== RAILS_DRAG_TYPE) { setDraggingSlot(null); return }
      setDraggingSlot(null)
      if (!over) { setAnnouncement('Drop cancelled'); return }
      const zone = decodeRailsDropId(String(over.id))
      if (!zone) { setAnnouncement('Drop cancelled'); return }
      setAnnouncement(`Dropped in ${describeDropZone(zone, rails)}`)

      if (data.kind === 'tab') {
        // Tab drag: route by drop zone kind.
        if (zone.kind === 'tab-strip') {
          const pointer = pointerRef.current
          const stripEl = document.querySelector(`[data-drop-id="${String(over.id)}"]`)
          let insertIdx = 0
          if (pointer && stripEl) {
            insertIdx = computeTabInsertIdx(stripEl, pointer.x, data.tabId)
          }
          if (zone.slotId === data.slotId) {
            reorderTab(data.slotId, data.tabId, insertIdx)
          } else {
            moveTabToSlot(data.slotId, data.tabId, zone.slotId, insertIdx)
          }
          return
        }
        // Tab dropped onto a slot-level zone → detach to a new slot.
        if (zone.kind === 'empty-side') {
          detachTabToNewSlot(data.slotId, data.tabId, { kind: 'empty-side', side: zone.side })
        } else if (zone.kind === 'slot') {
          if (zone.slotId === data.slotId) return // dropped onto own body — ignore
          const pointer = pointerRef.current
          const rect = over.rect
          if (!pointer || !rect) return
          let orientation: 'vertical' | 'horizontal' = 'vertical'
          for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
            const rail = rails[side]
            if (!rail) continue
            if (rail.slots.some((s) => s.id === zone.slotId)) {
              orientation = rail.orientation
              break
            }
          }
          const splitZone = pointerToSplitZone(pointer, {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }, orientation)
          // Center on another slot → merge as tab into that slot's strip (resolved decision).
          if (splitZone === 'center') {
            const dest = rails[(['left', 'right', 'top', 'bottom'] as RailSide[]).find((side) => rails[side]?.slots.some((s) => s.id === zone.slotId)) ?? 'right']
            const insertIdx = dest?.slots.find((s) => s.id === zone.slotId)?.tabs.length ?? 0
            moveTabToSlot(data.slotId, data.tabId, zone.slotId, insertIdx)
            return
          }
          const target: TabDropTarget = { kind: 'slot', slotId: zone.slotId, zone: splitZone }
          detachTabToNewSlot(data.slotId, data.tabId, target)
        }
        return
      }

      // Slot drag (existing behavior, unchanged).
      if (zone.kind === 'empty-side') {
        dropSlotToSide(data.slotId, zone.side)
      } else if (zone.kind === 'slot') {
        const pointer = pointerRef.current
        const rect = over.rect
        if (!pointer || !rect) return
        let orientation: 'vertical' | 'horizontal' = 'vertical'
        for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
          const rail = rails[side]
          if (!rail) continue
          if (rail.slots.some((s) => s.id === zone.slotId)) {
            orientation = rail.orientation
            break
          }
        }
        const splitZone = pointerToSplitZone(pointer, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }, orientation)
        splitDropSlot(data.slotId, zone.slotId, splitZone)
      }
      // Slot drag onto a tab-strip drop zone is intentionally ignored — slots
      // don't merge into other slots' strips (that'd be a destructive op).
    },
    onDragCancel: () => {
      const cleanup = (pointerRef as unknown as { cleanup?: () => void }).cleanup
      if (cleanup) { cleanup(); (pointerRef as unknown as { cleanup?: () => void }).cleanup = undefined }
      setDraggingSlot(null)
      setAnnouncement('Drop cancelled')
    },
  })

  return { draggingSlot, announcement }
}

export function RailsFrame({ children }: RailsFrameProps) {
  const rails = useDefaultRails()
  const setRailSize = useCanvasRailsStore((s) => s.setRailSize)
  const { draggingSlot, announcement } = useRailsDragMonitor()
  const railsDragging = draggingSlot !== null

  const emptySides = useMemo(() => {
    const out: RailSide[] = []
    for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
      if (!rails[side]) out.push(side)
    }
    return out
  }, [rails])

  const renderRail = (side: RailSide) => {
    const rail = rails[side]
    if (!rail) return null
    return (
      <RailContainer
        side={side}
        rail={rail}
        size={railSize(rails, side)}
        onResize={(px) => setRailSize(side, px)}
      >
        {rail.slots.map((slot, idx) => (
          <Fragment key={slot.id}>
            <SlotRenderer slot={slot} fromSide={side} />
            {idx < rail.slots.length - 1 && (
              <SlotDivider
                side={side}
                aboveSlotId={slot.id}
                belowSlotId={rail.slots[idx + 1].id}
              />
            )}
          </Fragment>
        ))}
      </RailContainer>
    )
  }

  return (
    <div className={styles.frame}>
      {renderRail('left')}
      <div className={styles.center}>
        {renderRail('top')}
        <div className={styles.canvasHost}>
          {children}
          {railsDragging && <DockOverlay emptySides={emptySides} />}
        </div>
        {renderRail('bottom')}
      </div>
      {renderRail('right')}
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
    </div>
  )
}
