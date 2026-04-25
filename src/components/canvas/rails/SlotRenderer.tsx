import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { copyTasksRich } from '../../../services/task-copy'
import { popTabToCanvas } from '../../../services/rail-pop-out'
import type { PersistedTodoItem } from '../../../models'
import type { RailSide, Slot, SlotKind, Tab } from '../../../models/canvas-rails'
import { getActiveTab } from '../../../models/canvas-rails'
import { DraggableSlot } from './DraggableSlot'
import { TabStrip } from './TabStrip'
import { LensSlotContent } from './LensSlotContent'
import { CalendarSlotContent } from './CalendarSlotContent'
import { CalendarOrientationToggle } from './calendar/CalendarOrientationToggle'
import { NotesSlotContent } from './NotesSlotContent'
import { TaskboardSlotContent } from './TaskboardSlotContent'
import { HorizonsSlotContent } from './HorizonsSlotContent'
import { SlotMenu } from './SlotMenu'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'

interface SlotRendererProps {
  slot: Slot
  fromSide: RailSide
}

export function SlotRenderer({ slot, fromSide }: SlotRendererProps) {
  const {
    closeSlot,
    updateSlot,
    setSlotKind,
    setSlotOrientation,
    setSlotWeekOffset,
    splitSlot,
    addTab,
    closeTab,
    activateTab,
    changeTabType,
    setTabRuntimeFilterValue,
    clearPendingFocus,
  } = useCanvasRailsStore(useShallow((s) => ({
    closeSlot: s.closeSlot,
    updateSlot: s.updateSlot,
    setSlotKind: s.setSlotKind,
    setSlotOrientation: s.setSlotOrientation,
    setSlotWeekOffset: s.setSlotWeekOffset,
    splitSlot: s.splitSlot,
    addTab: s.addTab,
    closeTab: s.closeTab,
    activateTab: s.activateTab,
    changeTabType: s.changeTabType,
    setTabRuntimeFilterValue: s.setTabRuntimeFilterValue,
    clearPendingFocus: s.clearPendingFocus,
  })))
  const { rails, pendingFocusSlotId } = useCanvasRailsStore(useShallow((s) => ({
    rails: s.rails,
    pendingFocusSlotId: s.pendingFocusSlotId,
  })))

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
    | { kind: 'change-kind'; tabId: string }
    | { kind: 'split'; dir: 'above' | 'below' | 'left' | 'right' }
    | null
  >(null)
  const [showEditor, setShowEditor] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  // Per-tab kind menu — caret can fire on any pill, so anchor + tabId travel
  // together (lists-consistency P9 / code-review-2026-04-25 P5 wired the per-
  // pill caret through `changeTabType`).
  const [kindMenuTarget, setKindMenuTarget] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const activeTab = getActiveTab(slot)
  // Tab the kind menu currently targets — falls back to active when the menu
  // is closed so derived UI (e.g. the title-bar lens count meta) keeps working.
  const kindMenuTab: Tab | undefined = kindMenuTarget
    ? slot.tabs.find((t) => t.id === kindMenuTarget.tabId)
    : undefined

  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuOpen = menuAnchor !== null
  const kindMenuOpen = kindMenuTarget !== null

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
    if (kindMenuTab && kindMenuTab.id !== activeTab.id) {
      // Editing the list on a non-active lens tab — write the listDefinitionId
      // into that tab specifically rather than via the "active-tab" updateSlot
      // contract.
      changeTabType(slot.id, kindMenuTab.id, 'lens', { listDefinitionId })
      return
    }
    updateSlot(slot.id, { listDefinitionId })
  }

  const handleChangeKind = (nextKind: SlotKind) => {
    if (!kindMenuTarget) return
    const target = kindMenuTab
    if (!target || target.type === nextKind) return
    if (nextKind === 'lens') {
      // Require a list pick before swapping to lens so we never land on an empty list.
      setPendingLensAction({ kind: 'change-kind', tabId: target.id })
      setPickerPos({ x: kindMenuTarget.x, y: kindMenuTarget.y })
      return
    }
    if (target.id === activeTab.id) {
      // Active-tab swap goes through `setSlotKind` so slot-level fields
      // (orientation/weekOffset for calendar) are preserved/cleared as a unit.
      setSlotKind(slot.id, nextKind)
    } else {
      // Non-active tab swap targets the specific tab.
      changeTabType(slot.id, target.id, nextKind)
    }
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

  const handleAddTab = (kind: SlotKind, anchor: { x: number; y: number }) => {
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
      onOpenChangeType={(tabId, anchor) => setKindMenuTarget({ tabId, x: anchor.x, y: anchor.y })}
      meta={metaContent}
      menuOpen={menuOpen}
      changeTypeMenuOpen={kindMenuOpen}
      changeTypeMenuTabId={kindMenuTarget?.tabId}
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
              const targetTabId = pendingLensAction.tabId
              if (targetTabId === activeTab.id) {
                setSlotKind(slot.id, 'lens', { listDefinitionId })
              } else {
                changeTabType(slot.id, targetTabId, 'lens', { listDefinitionId })
              }
            } else if (pendingLensAction?.kind === 'split') {
              splitSlot(slot.id, pendingLensAction.dir, { listDefinitionId })
            } else {
              // "Change list…" on an already-lens slot
              if (kindMenuTab && kindMenuTab.id !== activeTab.id) {
                changeTabType(slot.id, kindMenuTab.id, 'lens', { listDefinitionId })
              } else {
                updateSlot(slot.id, { listDefinitionId })
              }
            }
            setPendingLensAction(null)
            setPickerPos(null)
          }}
          onCreateNew={() => setShowEditor(true)}
          onClose={() => { setPickerPos(null); setPendingLensAction(null) }}
        />
      )}
      {showEditor && <DashboardListsEditor onClose={() => setShowEditor(false)} />}
      {kindMenuTarget && kindMenuTab && (
        <WidgetKindMenu
          anchor={{ x: kindMenuTarget.x, y: kindMenuTarget.y }}
          currentKind={kindMenuTab.type}
          onChangeKind={handleChangeKind}
          pickListForLens={kindMenuTab.type === 'lens' ? handlePickListForLens : undefined}
          onEditList={
            kindMenuTab.type === 'lens' && kindMenuTab.listDefinitionId != null
              ? () => useUIStore.getState().openListsEditor(kindMenuTab.listDefinitionId!)
              : undefined
          }
          onClose={() => setKindMenuTarget(null)}
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
