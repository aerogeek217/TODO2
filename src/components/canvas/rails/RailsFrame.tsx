import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useSettingsStore } from '../../../stores/settings-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useListInsetStore } from '../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../stores/floating-calendar-store'
import { useFloatingHorizonsStore } from '../../../stores/floating-horizons-store'
import { useFloatingNoteStore } from '../../../stores/floating-note-store'
import { useFloatingTaskboardStore } from '../../../stores/floating-taskboard-store'
import { useCanvasRailsStore, createLensSlot } from '../../../stores/canvas-rails-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { copyTasksRich } from '../../../services/task-copy'
import type { PersistedTodoItem } from '../../../models'
import type { CalendarOrientation, Corner, CornerOwner, RailSide, RailsState, Slot, Tab } from '../../../models/canvas-rails'
import { computeRailGridArea, cornerForSideClaim, getActiveTab, isRailCollapsed, railSize } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { DraggableSlot } from './DraggableSlot'
import { SlotDivider } from './SlotDivider'
import { TabStrip } from './TabStrip'
import { LensSlotContent } from './LensSlotContent'
import { CalendarSlotContent } from './CalendarSlotContent'
import { CalendarOrientationToggle } from './calendar/CalendarOrientationToggle'
import { NotesSlotContent } from './NotesSlotContent'
import { TaskboardSlotContent } from './TaskboardSlotContent'
import { HorizonsSlotContent } from './HorizonsSlotContent'
import { DockOverlay } from './DockOverlay'
import { SlotMenu } from './SlotMenu'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'
import {
  decodeRailsDropId,
  encodeRailsDropId,
  pointerToFlowPosition,
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
 * Pure pop-out dispatcher: given a tab, a canvas id, and a flow-space
 * position, create the corresponding floating widget and return whether the
 * caller should follow up with `closeTab`. Resolves to `false` for no-op
 * cases (lens tab without a list definition). The `init` opts only apply to
 * calendar tabs — they thread slot-level orientation/weekOffset so the user's
 * strip orientation survives tab → float (the reverse of `slotFromFloat`'s
 * threading for the float → slot direction).
 *
 * Two call paths:
 *   - Menu pop-out (`popTabToCanvas` / `popSlotToCanvas`) uses
 *     `computePopOutFlowPosition()` for upper-left-of-viewport placement.
 *   - Drag pop-out (Phase 5 of float-dock, dispatched from
 *     `useRailsDragMonitor`) uses `pointerToFlowPosition` so the widget lands
 *     near the cursor.
 *
 * Exported for unit testing.
 */
export async function popTabAtPosition(
  tab: Tab,
  canvasId: number,
  x: number,
  y: number,
  init?: { orientation?: CalendarOrientation; weekOffset?: number },
): Promise<boolean> {
  if (tab.type === 'notes') {
    await useFloatingNoteStore.getState().add(canvasId, x, y)
    return true
  }
  if (tab.type === 'lens') {
    if (tab.listDefinitionId == null) return false
    await useListInsetStore.getState().add(tab.listDefinitionId, canvasId, x, y)
    return true
  }
  if (tab.type === 'calendar') {
    await useFloatingCalendarStore.getState().add(canvasId, x, y, {
      orientation: init?.orientation,
      weekOffset: init?.weekOffset,
    })
    return true
  }
  if (tab.type === 'taskboard') {
    await useFloatingTaskboardStore.getState().add(canvasId, x, y)
    return true
  }
  if (tab.type === 'horizons') {
    await useFloatingHorizonsStore.getState().add(canvasId, x, y)
    return true
  }
  return false
}

/**
 * Pop one tab out of a rail slot to the canvas as a free-floating node.
 * Resolves to true when a node was created (and the caller should remove the
 * tab via `closeTab`), false if the operation was a no-op (no canvas selected
 * / lens without a list definition / tabId not found in slot).
 *
 * Exported for testing.
 */
export async function popTabToCanvas(slot: Slot, tabId: string): Promise<boolean> {
  const tab = slot.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  const canvasId = useCanvasStore.getState().selectedCanvasId
  if (canvasId == null) return false
  const pos = computePopOutFlowPosition()
  return popTabAtPosition(tab, canvasId, pos.x, pos.y, {
    orientation: slot.orientation,
    weekOffset: slot.weekOffset,
  })
}

/**
 * Pop the slot's active tab out to the canvas. Retained as a thin wrapper
 * over `popTabToCanvas` so existing callers keep working; new code that
 * targets a specific tab should call `popTabToCanvas` directly.
 */
export function popSlotToCanvas(slot: Slot): Promise<boolean> {
  return popTabToCanvas(slot, slot.activeTabId)
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
  const setTabRuntimeFilterValue = useCanvasRailsStore((s) => s.setTabRuntimeFilterValue)
  const pendingFocusSlotId = useCanvasRailsStore((s) => s.pendingFocusSlotId)
  const clearPendingFocus = useCanvasRailsStore((s) => s.clearPendingFocus)
  const rails = useCanvasRailsStore((s) => s.rails)
  const [count, setCount] = useState<number>(0)
  const [lensTodos, setLensTodos] = useState<PersistedTodoItem[]>([])
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id!, s])), [statuses])
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  // When set, the picker's onSelect creates a new lens tab (or converts the
  // active tab to a lens) instead of updating the current tab's listDefinitionId.
  // Also used by "Change list…" from the kind menu, which keeps pendingLensAction null.
  const [pendingLensAction, setPendingLensAction] = useState<
    | { kind: 'add-tab' }
    | { kind: 'change-kind' }
    | { kind: 'split'; dir: 'above' | 'below' | 'left' | 'right' }
    | null
  >(null)
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
    ? () => { void popTabToCanvas(slot, activeTab.id).then((moved) => { if (moved) closeTab(slot.id, activeTab.id) }) }
    : undefined

  const handlePickListForLens = (listDefinitionId: number) => {
    updateSlot(slot.id, { listDefinitionId })
  }

  const handleChangeKind = (nextKind: typeof activeTab.type, anchor?: { x: number; y: number }) => {
    if (nextKind === activeTab.type) return
    if (nextKind === 'lens') {
      // Require a list pick before swapping to lens so we never land on an empty list.
      setPendingLensAction({ kind: 'change-kind' })
      setPickerPos(anchor ?? kindMenuAnchor ?? { x: 100, y: 100 })
      return
    }
    setSlotKind(slot.id, nextKind)
  }

  const handleSplit = (dir: 'above' | 'below' | 'left' | 'right', anchor?: { x: number; y: number }) => {
    // Split always creates a new lens by default — require a list pick first so
    // the split never produces an empty widget.
    setPendingLensAction({ kind: 'split', dir })
    setPickerPos(anchor ?? menuAnchor ?? { x: 100, y: 100 })
  }

  let body: ReactNode
  let headerMeta: ReactNode = undefined
  if (activeTab.type === 'lens') {
    body = (
      <LensSlotContent
        listDefinitionId={activeTab.listDefinitionId}
        onTitleChange={(_t, c, todos) => { setCount(c); setLensTodos(todos) }}
        runtimeFilterValue={activeTab.runtimeFilterValue}
        onRuntimeFilterChange={(v) => setTabRuntimeFilterValue(slot.id, activeTab.id, v)}
      />
    )
  } else if (activeTab.type === 'calendar') {
    const orientation = slot.orientation ?? 'vertical'
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
        scope={`slot-${slot.id}`}
      />
    )
  } else if (activeTab.type === 'notes') {
    body = <NotesSlotContent />
  } else if (activeTab.type === 'taskboard') {
    body = <TaskboardSlotContent />
  } else if (activeTab.type === 'horizons') {
    body = <HorizonsSlotContent />
  } else {
    body = (
      <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-meta)' }}>
        Coming soon
      </div>
    )
  }

  const handleAddTab = (kind: typeof activeTab.type, anchor: { x: number; y: number }) => {
    if (kind === 'lens') {
      setPendingLensAction({ kind: 'add-tab' })
      setPickerPos(anchor)
      return
    }
    addTab(slot.id, kind)
  }

  const lensMeta = activeTab.type === 'lens' ? (
    <>
      {count > 0 && <span aria-label={`${count} items`}>{count}</span>}
      <button
        type="button"
        onClick={() => {
          void copyTasksRich(
            [{ todos: lensTodos }],
            { assignedPeopleMap, statusMap },
          )
        }}
        aria-label="Copy tasks"
        title="Copy tasks"
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', opacity: 0.7 }}
      >
        ⧉
      </button>
    </>
  ) : null
  const metaContent = headerMeta ?? lensMeta
  const header = (
    <TabStrip
      slot={slot}
      fromSide={fromSide}
      onActivateTab={(tabId) => activateTab(slot.id, tabId)}
      onCloseTab={(tabId) => closeTab(slot.id, tabId)}
      onAddTab={(kind, anchor) => { handleAddTab(kind, anchor) }}
      onMore={(anchor) => setMenuAnchor(anchor)}
      onPopOut={handlePopOut}
      onClose={closeThisSlot}
      onOpenChangeType={(anchor) => setKindMenuAnchor(anchor)}
      meta={metaContent}
      menuOpen={menuOpen}
      changeTypeMenuOpen={kindMenuOpen}
      moreButtonRef={moreButtonRef}
    />
  )

  return (
    <>
      <DraggableSlot
        slotId={slot.id}
        fromSide={fromSide}
        header={header}
        flex={slot.flex}
        bodyRole="tabpanel"
        bodyLabelledBy={slot.activeTabId}
      >
        {body}
      </DraggableSlot>
      {pickerPos && (
        <ListDefinitionPickerPopup
          x={pickerPos.x}
          y={pickerPos.y}
          onSelect={(listDefinitionId) => {
            if (pendingLensAction?.kind === 'add-tab') {
              addTab(slot.id, 'lens', { listDefinitionId })
            } else if (pendingLensAction?.kind === 'change-kind') {
              setSlotKind(slot.id, 'lens', { listDefinitionId })
            } else if (pendingLensAction?.kind === 'split') {
              splitSlot(slot.id, pendingLensAction.dir, { listDefinitionId })
            } else {
              // "Change list…" on an already-lens slot
              updateSlot(slot.id, { listDefinitionId })
            }
            setPendingLensAction(null)
            setPickerPos(null)
          }}
          onCreateNew={() => setShowEditor(true)}
          onClose={() => { setPickerPos(null); setPendingLensAction(null) }}
        />
      )}
      {showEditor && <DashboardListsEditor onClose={() => setShowEditor(false)} />}
      {kindMenuAnchor && (
        <WidgetKindMenu
          anchor={kindMenuAnchor}
          currentKind={activeTab.type}
          onChangeKind={(kind) => { handleChangeKind(kind, kindMenuAnchor) }}
          pickListForLens={activeTab.type === 'lens' ? handlePickListForLens : undefined}
          onEditList={
            activeTab.type === 'lens' && activeTab.listDefinitionId != null
              ? () => useUIStore.getState().openListsEditor(activeTab.listDefinitionId)
              : undefined
          }
          onClose={() => setKindMenuAnchor(null)}
        />
      )}
      {menuAnchor && (
        <SlotMenu
          anchor={menuAnchor}
          currentKind={activeTab.type}
          orientation={fromSide === 'left' || fromSide === 'right' ? 'vertical' : 'horizontal'}
          onSplit={(dir) => handleSplit(dir, menuAnchor ?? undefined)}
          onAddTab={(anchor) => handleAddTab('lens', anchor)}
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
  if (zone.kind === 'canvas') return 'canvas'
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
  // Holds the active pointer-listener cleanup between onDragStart and
  // onDragEnd/Cancel. A ref (rather than the old `as unknown as` laundering
  // on `pointerRef`) plus an unmount effect covers the case where the dnd
  // provider unmounts mid-drag without firing end/cancel.
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { cleanupRef.current?.(); cleanupRef.current = null }, [])
  const dropSlotToSide = useCanvasRailsStore((s) => s.dropSlotToSide)
  const splitDropSlot = useCanvasRailsStore((s) => s.splitDropSlot)
  const reorderTab = useCanvasRailsStore((s) => s.reorderTab)
  const moveTabToSlot = useCanvasRailsStore((s) => s.moveTabToSlot)
  const detachTabToNewSlot = useCanvasRailsStore((s) => s.detachTabToNewSlot)
  const closeTab = useCanvasRailsStore((s) => s.closeTab)
  const setCornerOwner = useCanvasRailsStore((s) => s.setCornerOwner)
  const clearCornerOwner = useCanvasRailsStore((s) => s.clearCornerOwner)
  const rails = useCanvasRailsStore((s) => s.rails)

  /**
   * Apply the corner-ownership implied by an empty-side drop. Two roles per
   * adjacent corner:
   *   - claimed: dropped rail extends into the corner → owner matches the
   *     dropped rail's axis (`'h'` for top/bottom, `'v'` for left/right).
   *   - pinched: dropped rail does NOT extend into the corner → owner is
   *     the opposite axis, so perpendicular rails own the corner when
   *     present (and `resolveCorner` falls back cleanly when absent).
   *
   * Claim dispatch:
   *   - `claim='start'` → start corner claimed, end corner pinched
   *   - `claim='end'`   → end corner claimed, start corner pinched
   *   - no claim        → both corners pinched (the dropped rail is pinched
   *     between its perpendicular neighbors)
   *
   * Writes via `setCornerOwner` / `clearCornerOwner`: when the target owner
   * equals the default (`'v'`), we clear the entry instead of storing it,
   * so the persisted bag stays minimal (and single-side-present layouts
   * keep `rails.corners === undefined`).
   */
  const applyEmptySideCorners = (side: RailSide, claim: 'start' | 'end' | undefined) => {
    const isHorizontal = side === 'top' || side === 'bottom'
    const claimedOwner: CornerOwner = isHorizontal ? 'h' : 'v'
    const pinchedOwner: CornerOwner = isHorizontal ? 'v' : 'h'
    const startCorner = cornerForSideClaim(side, 'start')
    const endCorner = cornerForSideClaim(side, 'end')
    const apply = (corner: Corner, owner: CornerOwner) => {
      if (owner === 'v') clearCornerOwner(corner)
      else setCornerOwner(corner, owner)
    }
    if (claim === 'start') {
      apply(startCorner, claimedOwner)
      apply(endCorner, pinchedOwner)
    } else if (claim === 'end') {
      apply(startCorner, pinchedOwner)
      apply(endCorner, claimedOwner)
    } else {
      apply(startCorner, pinchedOwner)
      apply(endCorner, pinchedOwner)
    }
  }

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
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        cleanupRef.current = null
      }
    },
    onDragEnd: ({ active, over }) => {
      const data = active.data.current as RailsDragData | undefined
      cleanupRef.current?.()
      if (data?.type !== RAILS_DRAG_TYPE) { setDraggingSlot(null); return }
      setDraggingSlot(null)
      if (!over) { setAnnouncement('Drop cancelled'); return }
      const zone = decodeRailsDropId(String(over.id))
      if (!zone) { setAnnouncement('Drop cancelled'); return }
      setAnnouncement(`Dropped in ${describeDropZone(zone, rails)}`)

      if (data.kind === 'tab') {
        // Tab drag: route by drop zone kind.
        if (zone.kind === 'canvas') {
          // Phase 5 float-dock (reverse): pop the tab out to a free-floating
          // node at pointer position. Mirrors the menu pop-out flow, but uses
          // `pointerToFlowPosition` instead of `computePopOutFlowPosition` so
          // the widget lands under the cursor.
          const pointer = pointerRef.current
          if (!pointer) return
          const canvasEl = document.querySelector<HTMLElement>(
            `[data-rails-drop-id="${encodeRailsDropId({ kind: 'canvas' })}"]`,
          )
          if (!canvasEl) return
          // P5 fix: `canvasViewport` is null until the user pans/zooms (it's
          // populated by React Flow's `onViewportChange`, which doesn't fire
          // on initial render). Without a fallback, the pop-out path silently
          // aborts on a fresh canvas — fall back to identity so the widget
          // still lands under the cursor in flow coords (= canvas coords when
          // no transform has been applied).
          const vp = useSettingsStore.getState().canvasViewport ?? { x: 0, y: 0, zoom: 1 }
          const srcSlot = (['left', 'right', 'top', 'bottom'] as RailSide[])
            .map((s) => rails[s]?.slots.find((sl) => sl.id === data.slotId))
            .find((s): s is Slot => Boolean(s))
          if (!srcSlot) return
          const srcTab = srcSlot.tabs.find((t) => t.id === data.tabId)
          if (!srcTab) return
          const canvasId = useCanvasStore.getState().selectedCanvasId
          if (canvasId == null) return
          const canvasRect = canvasEl.getBoundingClientRect()
          const pos = pointerToFlowPosition(
            pointer,
            { left: canvasRect.left, top: canvasRect.top },
            { x: vp.x, y: vp.y, zoom: vp.zoom },
          )
          void popTabAtPosition(srcTab, canvasId, pos.x, pos.y, {
            orientation: srcSlot.orientation,
            weekOffset: srcSlot.weekOffset,
          }).then((moved) => {
            if (moved) closeTab(data.slotId, data.tabId)
          })
          return
        }
        if (zone.kind === 'tab-strip') {
          const pointer = pointerRef.current
          const stripEl = document.querySelector(`[data-rails-drop-id="${String(over.id)}"]`)
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
          applyEmptySideCorners(zone.side, zone.claim)
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
          // Same-slot drop: only a split-edge quadrant splits the tab off into
          // a new adjacent slot. A center drop on own body is a no-op (would
          // otherwise try to merge the tab back into itself).
          if (zone.slotId === data.slotId) {
            if (splitZone === 'center') return
            // Single-tab source → detaching would remove the source before
            // placing relative to it; skip rather than losing the tab.
            const srcLoc = (['left', 'right', 'top', 'bottom'] as RailSide[])
              .map((s) => rails[s]?.slots.find((sl) => sl.id === data.slotId))
              .find(Boolean)
            if (!srcLoc || srcLoc.tabs.length <= 1) return
            const target: TabDropTarget = { kind: 'slot', slotId: zone.slotId, zone: splitZone }
            detachTabToNewSlot(data.slotId, data.tabId, target)
            return
          }
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
        applyEmptySideCorners(zone.side, zone.claim)
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
      cleanupRef.current?.()
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
  const floatDragActive = useUIStore((s) => s.floatDrag !== null)
  const floatAnnouncement = useUIStore((s) => s.floatAnnouncement)

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
    const area = computeRailGridArea(rails, side)
    const gridStyle: CSSProperties = {
      gridColumn: `${area.colStart} / ${area.colEnd}`,
      gridRow: `${area.rowStart} / ${area.rowEnd}`,
    }
    const collapsed = isRailCollapsed(rails, side)
    return (
      <RailContainer
        side={side}
        rail={rail}
        size={railSize(rails, side)}
        collapsed={collapsed}
        onResize={(px) => setRailSize(side, px)}
        style={gridStyle}
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

  const frameStyle: CSSProperties = {
    '--left-size': rails.left ? `${railSize(rails, 'left')}px` : '0px',
    '--right-size': rails.right ? `${railSize(rails, 'right')}px` : '0px',
    '--top-size': rails.top ? `${railSize(rails, 'top')}px` : '0px',
    '--bottom-size': rails.bottom ? `${railSize(rails, 'bottom')}px` : '0px',
  } as CSSProperties

  return (
    <div className={styles.frame} style={frameStyle}>
      {renderRail('left')}
      {renderRail('top')}
      <div className={styles.canvasHost}>
        {children}
      </div>
      {renderRail('bottom')}
      {renderRail('right')}
      {(railsDragging || floatDragActive) && (
        <DockOverlay emptySides={emptySides} floatDragActive={floatDragActive} />
      )}
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {floatAnnouncement}
      </div>
    </div>
  )
}
