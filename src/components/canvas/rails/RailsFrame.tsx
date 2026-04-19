import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useSettingsStore } from '../../../stores/settings-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useListInsetStore } from '../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../stores/floating-calendar-store'
import { useFloatingNoteStore } from '../../../stores/floating-note-store'
import { useCanvasRailsStore, createLensSlot } from '../../../stores/canvas-rails-store'
import type { RailSide, RailsState, Slot } from '../../../models/canvas-rails'
import { railSize } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { DraggableSlot } from './DraggableSlot'
import { SlotHeader } from './SlotHeader'
import { LensSlotContent } from './LensSlotContent'
import { CalendarSlotContent } from './CalendarSlotContent'
import { NotesSlotContent } from './NotesSlotContent'
import { LensTitleButton } from './LensTitleButton'
import { DockOverlay } from './DockOverlay'
import { SlotMenu } from './SlotMenu'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'
import {
  decodeRailsDropId,
  pointerToSplitZone,
  RAILS_DRAG_TYPE,
  type RailsDragData,
} from './rail-dnd'
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

  if (slot.kind === 'notes') {
    await useFloatingNoteStore.getState().add(canvasId, pos.x, pos.y)
    return true
  }
  if (slot.kind === 'lens') {
    if (slot.listDefinitionId == null) return false
    await useListInsetStore.getState().add(slot.listDefinitionId, canvasId, pos.x, pos.y)
    return true
  }
  if (slot.kind === 'calendar') {
    await useFloatingCalendarStore.getState().add(canvasId, pos.x, pos.y)
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
  const splitSlot = useCanvasRailsStore((s) => s.splitSlot)
  const pendingFocusSlotId = useCanvasRailsStore((s) => s.pendingFocusSlotId)
  const clearPendingFocus = useCanvasRailsStore((s) => s.clearPendingFocus)
  const rails = useCanvasRailsStore((s) => s.rails)
  const [title, setTitle] = useState<string>('')
  const [count, setCount] = useState<number>(0)
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)

  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuOpen = menuAnchor !== null

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

  const canPopOut = !(slot.kind === 'lens' && slot.listDefinitionId == null)
  const handlePopOut = canPopOut
    ? () => { void popSlotToCanvas(slot).then((moved) => { if (moved) closeSlot(slot.id) }) }
    : undefined

  let header: ReactNode
  let body: ReactNode
  if (slot.kind === 'lens') {
    header = (
      <SlotHeader
        slotKind={slot.kind}
        title={(
          <LensTitleButton
            label={title || 'Lens'}
            onOpen={(x, y) => setPickerPos({ x, y })}
          />
        )}
        meta={count > 0 ? count : undefined}
        onMore={(anchor) => setMenuAnchor(anchor)}
        onPopOut={handlePopOut}
        menuOpen={menuOpen}
        moreButtonRef={moreButtonRef}
        onClose={closeThisSlot}
      />
    )
    body = (
      <LensSlotContent
        listDefinitionId={slot.listDefinitionId}
        onTitleChange={(t, c) => {
          setTitle(t)
          setCount(c)
        }}
      />
    )
  } else if (slot.kind === 'calendar') {
    header = (
      <SlotHeader
        slotKind={slot.kind}
        title="📅 Calendar · next 2 wks"
        onMore={(anchor) => setMenuAnchor(anchor)}
        onPopOut={handlePopOut}
        menuOpen={menuOpen}
        moreButtonRef={moreButtonRef}
        onClose={closeThisSlot}
      />
    )
    body = <CalendarSlotContent />
  } else if (slot.kind === 'notes') {
    header = (
      <SlotHeader
        slotKind={slot.kind}
        title="◰ Notes · Inbox"
        onMore={(anchor) => setMenuAnchor(anchor)}
        onPopOut={handlePopOut}
        menuOpen={menuOpen}
        moreButtonRef={moreButtonRef}
        onClose={closeThisSlot}
      />
    )
    body = <NotesSlotContent />
  } else {
    header = (
      <SlotHeader
        slotKind={slot.kind}
        title={slot.kind}
        onMore={(anchor) => setMenuAnchor(anchor)}
        menuOpen={menuOpen}
        moreButtonRef={moreButtonRef}
        onClose={closeThisSlot}
      />
    )
    body = (
      <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-meta)' }}>
        Coming soon
      </div>
    )
  }

  return (
    <>
      <DraggableSlot slotId={slot.id} fromSide={fromSide} header={header}>
        {body}
      </DraggableSlot>
      {slot.kind === 'lens' && pickerPos && (
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
      {menuAnchor && (
        <SlotMenu
          anchor={menuAnchor}
          currentKind={slot.kind}
          onChangeKind={(kind) => updateSlot(slot.id, { kind })}
          onSplit={(dir) => splitSlot(slot.id, dir)}
          onPopOut={handlePopOut}
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
    if (slot) return slot.kind
  }
  return null
}

function describeDropZone(zone: ReturnType<typeof decodeRailsDropId>, rails: RailsState): string {
  if (!zone) return 'unknown target'
  if (zone.kind === 'empty-side') return `${zone.side} rail`
  if (zone.kind === 'edge') return `${zone.side} rail ${zone.edge === 'head' ? 'start' : 'end'}`
  const targetKind = findSlotKind(rails, zone.slotId) ?? 'slot'
  return `${targetKind} slot`
}

interface RailsDragMonitorResult {
  draggingSlot: RailsDragData | null
  announcement: string
}

function useRailsDragMonitor(): RailsDragMonitorResult {
  const [draggingSlot, setDraggingSlot] = useState<RailsDragData | null>(null)
  const [announcement, setAnnouncement] = useState<string>('')
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const dropSlotToSide = useCanvasRailsStore((s) => s.dropSlotToSide)
  const edgeDropSlot = useCanvasRailsStore((s) => s.edgeDropSlot)
  const splitDropSlot = useCanvasRailsStore((s) => s.splitDropSlot)
  const rails = useCanvasRailsStore((s) => s.rails)

  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as RailsDragData | undefined
      if (data?.type !== RAILS_DRAG_TYPE) return
      setDraggingSlot(data)
      const kind = findSlotKind(rails, data.slotId)
      setAnnouncement(`Dragging ${kind ?? 'slot'}`)
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
      if (zone.kind === 'empty-side') {
        dropSlotToSide(data.slotId, zone.side)
      } else if (zone.kind === 'edge') {
        edgeDropSlot(data.slotId, zone.side, zone.edge)
      } else if (zone.kind === 'slot') {
        // Compute split zone from pointer + slot rect. Find the slot's orientation.
        const pointer = pointerRef.current
        const rect = over.rect
        if (!pointer || !rect) return
        // Determine orientation from rails state.
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
        railsDragging={railsDragging}
      >
        {rail.slots.map((slot) => (
          <SlotRenderer key={slot.id} slot={slot} fromSide={side} />
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
