import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUndoStore } from '../../stores/undo-store'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { ChevronDownIcon, WidgetKindIcon } from '../shared/icons'
import { focusEditItem } from './edit-focus'
import { addWidgetKindAt, useCardName } from './widget-hooks'
import { beginNewWidgetDrag } from './workspace-drag'
import { incomingPlaced, type IncomingTransfer } from '../../utils/layout-transfer'
import styles from './LayoutEditTray.module.css'

/**
 * The layout edit mode's widget tray (E3), in the mode bar: the common
 * widget kinds as chips (List, Calendar, Notes, Number, Breakdown) and
 * **More ›** with the rest. A chip dragged onto the workspace drops a new
 * widget where the drop model says (a slot takes it, a card's middle or tab
 * strip adds it as a tab, a card's edge splits it, the layout's edge
 * inserts a row or column; the ghost says which — `beginNewWidgetDrag`); a
 * click adds it to the selected slot or card. It scrolls sideways when the
 * bar is narrow, never pushing the bar's buttons out. While a tap armed a
 * card's move it gives way to the move's hint (Esc cancels it).
 */

/** The chips shown; every other kind is under More ›. */
const COMMON_KINDS: readonly WidgetKind[] = ['lens', 'calendar', 'notes', 'number', 'breakdown']

/** The kinds under More ›, by group. */
function moreKinds(): WidgetKind[] {
  return WIDGET_KIND_GROUPS.flatMap(({ group }) => widgetKindsOf(group)).filter((k) => !COMMON_KINDS.includes(k))
}

/** A click on a chip (or a More › pick): the widget added to the selected slot or card, which keeps the focus. */
function addToSelected(kind: WidgetKind): void {
  const selected = useWorkspaceStore.getState().editing?.selectedCellId
  if (selected == null) {
    useUndoStore.getState().notify('Select a slot or a card first, or drag the widget onto one.')
    return
  }
  addWidgetKindAt(kind, { kind: 'cell', cellId: selected })
  focusEditItem(selected)
}

function TrayChip({ kind }: { kind: WidgetKind }) {
  const label = widgetKindLabel(kind)
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    press.current = { x: e.clientX, y: e.clientY, dragged: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || p.dragged) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_ACTIVATION_DISTANCE_PX) return
    p.dragged = beginNewWidgetDrag(kind, label, e.clientX, e.clientY)
    // The drag follows the pointer over the workspace: hit testing there, not on this chip.
    if (p.dragged && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <button
      type="button"
      className={styles.chip}
      data-tray-kind={kind}
      data-tooltip={`Drag ${label} onto a slot or a card, or click to add it to the selected one`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onClick={() => {
        const dragged = press.current?.dragged === true
        press.current = null
        if (!dragged) addToSelected(kind)
      }}
    >
      <WidgetKindIcon kind={kind} size={13} />
      <span>{label}</span>
    </button>
  )
}

/** No tabs: a card that is gone. */
const NO_TABS: LayoutTab[] = []

/** While a tap armed a card's move: what the next tap does — a slot moves it, a card swaps, a card's tab bar joins it. */
function MoveHint({ cellId }: { cellId: string }) {
  const tabs = useWorkspaceStore((s) => s.working?.cells.find((c) => c.id === cellId)?.tabs ?? NO_TABS)
  const name = useCardName({ tabs })
  return (
    <span className={styles.hint} data-testid="layout-edit-move-hint">
      Click a slot to move “{name}” there, a card to swap, or its tab bar to join it · Esc cancels
    </span>
  )
}

/**
 * Move / Copy to layout: what the widgets in hand wait for (a slot, a card, a "+"), and once placed
 * what Done does — in the tray's place.
 */
function IncomingHint({ incoming, placed }: { incoming: IncomingTransfer; placed: boolean }) {
  const what = incoming.copy ? `a copy of “${incoming.name}”` : `“${incoming.name}”`
  return (
    <span className={styles.hint} data-testid="layout-edit-incoming-hint">
      {placed
        ? incoming.copy
          ? `Done copies “${incoming.name}” here from “${incoming.sourceName}”`
          : `Done moves “${incoming.name}” here from “${incoming.sourceName}”`
        : `Place ${what} from “${incoming.sourceName}”: click a slot, a card to join it, or a +`}
    </span>
  )
}

export function LayoutEditTray() {
  const incoming = useWorkspaceStore((s) => s.editing?.incoming ?? null)
  const placed = useWorkspaceStore((s) => incomingPlaced(s.working, s.editing?.incoming))
  const armedCell = useWorkspaceStore((s) => (s.editing?.moveArmed ? s.editing.selectedCellId : null))
  const armed = incoming ? null : armedCell
  const [more, setMore] = useState(false)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const moreEntries: MenuEntry[] = moreKinds().map((kind) => ({
    kind: 'item',
    label: widgetKindLabel(kind),
    icon: <WidgetKindIcon kind={kind} />,
    onSelect: () => addToSelected(kind),
  }))
  return (
    <div className={styles.tray} role="group" aria-label="Widgets">
      <span role="status" className={styles.status}>
        {armed != null && <MoveHint cellId={armed} />}
        {incoming && <IncomingHint incoming={incoming} placed={placed} />}
      </span>
      {armed == null && !incoming && (
        <>
          <span className={styles.caption} aria-hidden="true">Add</span>
          {COMMON_KINDS.map((kind) => <TrayChip key={kind} kind={kind} />)}
          <button
            ref={moreRef}
            type="button"
            className={styles.chip}
            aria-haspopup="menu"
            aria-expanded={more}
            data-tooltip="More widgets"
            onClick={() => setMore((m) => !m)}
          >
            <span>More</span>
            <ChevronDownIcon size={12} />
          </button>
        </>
      )}
      {more && (
        <MenuPopover anchorRef={moreRef} placement="bottom-start" width={220} label="More widgets" entries={moreEntries} onClose={() => setMore(false)} />
      )}
    </div>
  )
}
