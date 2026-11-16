import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { getActiveTab, type LayoutCell, type LayoutTab } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { cellRulerName, cornerArea, emptySlots, otherCards, stretchedArea, trackReached } from '../../utils/layout-edit-cards'
import { mergeNeighbour, sameArea } from '../../utils/workspace-grid'
import { MenuPopover } from '../shared/MenuPopover'
import { MoreIcon, PlusIcon } from '../shared/icons'
import { EDIT_CARD_MENU_LABEL, editCardMenuEntries } from './cell-menu'
import { ARROW_SIDES, drawnAxis, focusAfterTap, moveSelection, onCardKey, selectOnFocus, tapCard, type CardMenuAt } from './edit-card-actions'
import { EDIT_FOCUS_ATTR, focusEditItem } from './edit-focus'
import { useLayoutEditView, useRulerNames } from './layout-edit-view'
import { TabIcon } from './TabIcon'
import { AddWidgetFlow } from './AddWidgetFlow'
import { useTabTitles } from './widget-hooks'
import { WORKSPACE_PANEL_DRAG, workspacePanelDragId, type WorkspacePanelDragData } from './workspace-drag'
import styles from './EditCard.module.css'

const store = useWorkspaceStore.getState

/**
 * The layout edit mode's cards and slots (E3). Every cell is a card: its
 * whole surface drags it (past dnd-kit's 5px; the drop model decides what
 * the drop does), a short click selects it — and arms a move, so a click on
 * a slot next moves it there, on another card's middle joins them
 * (`workspace-store.tapEdit`) —, and it is a Tab stop: the arrow keys move
 * the selection to the card or slot beside it, Shift+arrow stretches it one
 * track, Alt+arrow moves it onto the slot beside it or swaps it with the
 * card there, Enter opens its menu (Cell layout: Move to ▸, Swap with ▸,
 * Split ▸, Merge with ▸, Stretch, Remove widget, Close cell) and Delete
 * removes its active widget. Its corner stretches it over empty slots. An
 * empty cell is a slot: dashed, named by the rulers (`B4`), a click opens
 * the widget kinds.
 */

/**
 * A card's surface (`data-edit-surface`): under the card's dimmed content
 * (which takes no presses), so a press anywhere on the card lands here —
 * the drag of the whole card, a click's tap, the keys. The card's Tab stop.
 */
export function EditCardSurface({ cell, title, onMenu }: { cell: LayoutCell; title: string; onMenu: (at: CardMenuAt) => void }) {
  const titles = useTabTitles(cell.tabs)
  const names = useRulerNames()
  const data: WorkspacePanelDragData = {
    type: WORKSPACE_PANEL_DRAG,
    panelId: cell.id,
    tabs: cell.tabs.map((t, i) => ({ id: t.id, kind: t.kind, title: titles[i] ?? '', ...(t.icon ? { icon: t.icon } : {}) })),
  }
  const { setNodeRef, listeners } = useDraggable({ id: `${workspacePanelDragId(cell.id)}:card`, data })
  const place = cellRulerName(cell, names)
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={styles.surface}
      role="button"
      tabIndex={0}
      data-edit-surface={cell.id}
      {...{ [EDIT_FOCUS_ATTR]: cell.id }}
      aria-label={`${title} card, ${place}. Drag or Alt+arrow to move, Shift+arrow to stretch, Enter for its menu, Delete removes ${title}`}
      onFocus={() => selectOnFocus(cell.id)}
      onClick={(e) => tapCard(e, cell.id)}
      onKeyDown={(e) => onCardKey(e, cell, onMenu)}
    />
  )
}

/**
 * A card's bottom-right corner (`data-edit-corner`): dragged, it stretches
 * the card over empty slots — or shrinks it, leaving slots — from its
 * top-left, track by track (`cornerArea`, `trackReached`: a track once the
 * pointer passes its middle); the table draws where it lands while it runs
 * (`StretchPreview`), Esc puts it back, a release stores it on the draft
 * (`setCellArea`). The keyboard's way is Shift+arrow on the card.
 */
function EditCardCorner({ cell }: { cell: LayoutCell }) {
  const view = useLayoutEditView()
  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !view) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    const table = el.closest<HTMLElement>('[data-ws-table]')
    if (!table) return
    el.setPointerCapture(e.pointerId)
    const cols = drawnAxis(table, 'columns')
    const rows = drawnAxis(table, 'rows')
    const from = cell.area
    let last = from
    const move = (ev: PointerEvent) => {
      const layout = store().working
      if (!layout) return
      const end = { col: trackReached(cols, ev.clientX, from.col), row: trackReached(rows, ev.clientY, from.row) }
      last = cornerArea(layout, cell.id, end) ?? last
      view.setStretch({ cellId: cell.id, area: last })
    }
    const finish = (commit: boolean) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      view.setStretch(null)
      if (commit && !sameArea(last, from)) {
        store().setCellArea(cell.id, last)
        focusEditItem(cell.id)
      }
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    view.setStretch({ cellId: cell.id, area: from })
  }
  return (
    <span
      className={styles.corner}
      data-edit-corner={cell.id}
      data-tooltip="Drag to stretch over empty slots"
      aria-hidden="true"
      onPointerDown={onPointerDown}
    />
  )
}

/**
 * A card's chrome over its content (E3): its label (the widget's icon and
 * name; a card with a tab strip shows its tabs instead), its ⋯ (**Cell
 * layout**: the card's menu) and its corner. Clicks on the label fall
 * through to the content and the surface.
 */
export function EditCardControls({ cell, label, stripLabel, labelTab, menuOpen, setMoreButton, onMore }: {
  cell: LayoutCell
  /** The card's label (none: a strip of tabs names it). */
  label: string | null
  /**
   * A strip of tabs names the card, but too narrow for its active tab's
   * title (`data-strip-squeezed`): its name, shown under the strip only
   * while the strip is squeezed.
   */
  stripLabel?: string
  /** The tab whose icon leads the label. */
  labelTab?: LayoutTab
  menuOpen: boolean
  setMoreButton: (el: HTMLButtonElement | null) => (() => void) | undefined
  onMore: () => void
}) {
  return (
    <>
      {label != null && (
        <span className={styles.label} data-edit-card-label="" aria-hidden="true">
          {labelTab && <TabIcon tab={labelTab} size={12} className={styles.labelIcon} />}
          <span className={styles.labelText}>{label}</span>
        </span>
      )}
      {label == null && stripLabel != null && (
        <span className={`${styles.label} ${styles.stripLabel}`} data-edit-strip-label="" aria-hidden="true">
          {labelTab && <TabIcon tab={labelTab} size={12} className={styles.labelIcon} />}
          <span className={styles.labelText}>{stripLabel}</span>
        </span>
      )}
      <button
        ref={setMoreButton}
        type="button"
        className={`${styles.more} ${menuOpen ? styles.pressed : ''}`}
        aria-label={EDIT_CARD_MENU_LABEL}
        data-edit-card-more=""
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-tooltip="Move, swap, split, stretch…"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          store().selectEditCell(cell.id)
          onMore()
        }}
      >
        <MoreIcon size={14} />
      </button>
      <EditCardCorner cell={cell} />
    </>
  )
}

/**
 * A card's menu (Cell layout, `editCardMenuEntries`): mounted only while
 * open — it reads the whole layout (the slots and cards it offers). Each
 * entry acts on the draft; the card keeps the focus where it moved.
 */
export function EditCardMenu({ cell, tab, at, anchorRef, onClose }: {
  cell: LayoutCell
  /** What Remove widget removes. */
  tab: LayoutTab | undefined
  at: CardMenuAt
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const working = useWorkspaceStore((s) => s.working)
  const names = useRulerNames()
  const actives = useMemo(() => (working?.cells ?? []).map((c) => getActiveTab(c)).filter((t): t is LayoutTab => t != null), [working])
  const titles = useTabTitles(actives)
  if (!working) return null
  const titleOf = (c: LayoutCell) => {
    const t = getActiveTab(c)
    const i = t ? actives.indexOf(t) : -1
    return i >= 0 ? (titles[i] ?? 'A widget') : 'A widget'
  }
  const entries = editCardMenuEntries({
    cell,
    tab,
    slots: emptySlots(working).map((s) => ({ cellId: s.id, label: cellRulerName(s, names) })),
    cards: otherCards(working, cell.id).map((c) => ({ cellId: c.id, label: titleOf(c), note: cellRulerName(c, names) })),
    mergeWith: (side) => mergeNeighbour(working, cell.id, side)?.id,
    canStretch: (direction) => stretchedArea(working, cell.id, direction) != null,
    onMoveTo: (slotId) => {
      if (!store().moveEditCard(cell.id, { kind: 'cell', cellId: slotId })) return
      const selected = store().editing?.selectedCellId
      if (selected != null) focusEditItem(selected)
    },
    onSwap: (other) => {
      store().swapCells(cell.id, other)
      focusEditItem(cell.id)
    },
    onSplit: (side) => { store().splitCell(cell.id, side) },
    onMerge: (other) => { store().mergeCells(cell.id, other) },
    onStretch: (direction) => {
      store().stretchCell(cell.id, direction)
      focusEditItem(cell.id)
    },
    onRemoveWidget: (tabId) => {
      store().removeWidget(tabId)
      focusEditItem(cell.id)
    },
    onCloseCell: () => { store().closeCell(cell.id) },
  })
  return (
    <MenuPopover
      {...(at ? { point: at } : { anchorRef, placement: 'bottom-end' as const })}
      // The focus back where it was: the card's surface (Enter), its ⋯ (a click).
      restoreFocus
      width={248}
      label={EDIT_CARD_MENU_LABEL}
      entries={entries}
      onClose={onClose}
    />
  )
}

/**
 * An empty cell in the layout edit mode: a slot (dashed, its ruler name).
 * A click opens the widget kinds (Tasks, Insights; `AddWidgetFlow`, the new
 * widget filling the slot) — or, after a tap armed a card, moves that card
 * here. A Tab stop: the arrow keys move the selection, Enter opens the
 * kinds, Delete closes it (the absorb rule).
 */
export function EditSlot({ cell }: { cell: LayoutCell }) {
  const names = useRulerNames()
  const place = cellRulerName(cell, names)
  const button = useRef<HTMLButtonElement | null>(null)
  const [kinds, setKinds] = useState<{ x: number; y: number } | null>(null)
  const openKinds = () => {
    const r = button.current?.getBoundingClientRect()
    setKinds(r ? { x: r.left + r.width / 2 - 110, y: r.top + r.height / 2 } : { x: 100, y: 100 })
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const side = ARROW_SIDES[e.key]
    if (side) {
      e.preventDefault()
      moveSelection(cell.id, side)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const { col, row } = cell.area
      store().closeCell(cell.id)
      // The focus to the cell that took its place.
      const taker = store().working?.cells.find((c) => c.area.col <= col && col < c.area.col + c.area.colSpan && c.area.row <= row && row < c.area.row + c.area.rowSpan)
      if (taker) {
        store().selectEditCell(taker.id)
        focusEditItem(taker.id)
      }
    }
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.slot}
        {...{ [EDIT_FOCUS_ATTR]: cell.id }}
        data-edit-slot={cell.id}
        aria-label={`Empty slot ${place}`}
        data-tooltip="Add a widget here, or drop one on it"
        onFocus={() => selectOnFocus(cell.id)}
        onClick={() => {
          const outcome = store().tapEdit({ kind: 'slot', cellId: cell.id })
          if (outcome.kind === 'menu') openKinds()
          else focusAfterTap(outcome.kind)
        }}
        onKeyDown={onKey}
      >
        <PlusIcon size={14} />
        <span className={styles.slotName}>{place}</span>
      </button>
      {kinds && <AddWidgetFlow cellId={cell.id} anchor={kinds} onClose={() => setKinds(null)} />}
    </>
  )
}
