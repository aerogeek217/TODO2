import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useSettingsStore } from '../../../stores/settings-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useCanvasRailsStore, createLensSlot } from '../../../stores/canvas-rails-store'
import type { RailSide, Slot } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { DraggableSlot } from './DraggableSlot'
import { SlotHeader } from './SlotHeader'
import { LensSlotContent } from './LensSlotContent'
import { CalendarSlotContent } from './CalendarSlotContent'
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
  const listDefinitionsLoaded = useListDefinitionStore((s) => s.listDefinitions.length > 0)
  const { rails, hydrated, hydrate } = useCanvasRailsStore()

  useEffect(() => {
    if (hydrated) return
    if (!listDefinitionsLoaded) return
    const thisweekId = horizonSlots?.thisweek
    const slot = createLensSlot(thisweekId)
    hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
  }, [hydrated, hydrate, horizonSlots, listDefinitionsLoaded])

  return rails
}

interface SlotRendererProps {
  slot: Slot
  fromSide: RailSide
}

function SlotRenderer({ slot, fromSide }: SlotRendererProps) {
  const closeSlot = useCanvasRailsStore((s) => s.closeSlot)
  const updateSlot = useCanvasRailsStore((s) => s.updateSlot)
  const splitSlot = useCanvasRailsStore((s) => s.splitSlot)
  const [title, setTitle] = useState<string>('')
  const [count, setCount] = useState<number>(0)
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)

  let header: ReactNode
  let body: ReactNode
  if (slot.kind === 'lens') {
    header = (
      <SlotHeader
        title={(
          <LensTitleButton
            label={title || 'Lens'}
            onOpen={(x, y) => setPickerPos({ x, y })}
          />
        )}
        meta={count > 0 ? count : undefined}
        onMore={(anchor) => setMenuAnchor(anchor)}
        onClose={() => closeSlot(slot.id)}
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
        title="📅 Calendar · next 2 wks"
        onMore={(anchor) => setMenuAnchor(anchor)}
        onClose={() => closeSlot(slot.id)}
      />
    )
    body = <CalendarSlotContent />
  } else {
    header = (
      <SlotHeader
        title={slot.kind}
        onMore={(anchor) => setMenuAnchor(anchor)}
        onClose={() => closeSlot(slot.id)}
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
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </>
  )
}

function useRailsDragMonitor() {
  const [draggingSlot, setDraggingSlot] = useState<RailsDragData | null>(null)
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
      if (!over) return
      const zone = decodeRailsDropId(String(over.id))
      if (!zone) return
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
    },
  })

  return draggingSlot
}

export function RailsFrame({ children }: RailsFrameProps) {
  const rails = useDefaultRails()
  const draggingSlot = useRailsDragMonitor()
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
      <RailContainer side={side} rail={rail} railsDragging={railsDragging}>
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
    </div>
  )
}
