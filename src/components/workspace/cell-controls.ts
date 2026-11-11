import { createContext } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'

/**
 * What a cell without a tab strip (one widget, D26 AA1) lends its widget's
 * top line (`WidgetTopLine`): the controls slot — the grip that drags the
 * whole cell and, clicked, opens its layout menu, and the ⋯ that opens the
 * widget's menu (`cell-menu`) — and the tab the
 * line stands for. `null` (the context's default) wherever the widget isn't
 * alone in a cell: a strip names it there, and its ⋯ is in the strip's header
 * (a cell of two or more widgets, the small face's popover, Settings).
 */
export interface CellControlsValue {
  /** The cell: the grip drags it whole (`workspace-drag` panel drag). */
  cellId: string
  /** Its tabs (one), for the grip's drag data. */
  tabs: readonly LayoutTab[]
  /** The tab its widget's top line stands for (`data-ws-tab`). */
  tabId: string
  /** Its widget's title (the ⋯'s and the grip's words). */
  title: string
  /** Touch layout (the phone): no grip, the ⋯ always shown. */
  touch: boolean
  /** Takes the ⋯ button (a callback ref, with its cleanup): the menu opens under it. */
  setMoreButton: (el: HTMLButtonElement | null) => (() => void) | undefined
  /** A menu of the cell is open (the ⋯'s, the grip's, Add widget): the slot stays shown. */
  menuOpen: boolean
  /** The ⋯'s menu is open (pressed, `aria-expanded`); default `menuOpen`. */
  moreOpen?: boolean
  /** The ⋯ was pressed. */
  onMore: () => void
  /** The grip was clicked (UX cleanup 4A): the cell's layout menu. No grip without it (touch has none). */
  onGrip?: () => void
  /** The grip's menu is open. */
  gripOpen?: boolean
  /** Takes the grip's button (a callback ref, with its cleanup): its menu opens under it. */
  setGripButton?: (el: HTMLButtonElement | null) => (() => void) | undefined
  /** Every row track the cell covers is collapsed: the slot adds an Expand button, always shown. */
  collapsed: boolean
  onExpand: () => void
  /**
   * A top line mounted (`holdsSlot`: holding the slot): the cell draws no
   * slot of its own while one holds it — a face without one gets the cell's,
   * floating at its top-right corner, which also stands for the tab while no
   * top line does (a face with no line of its own: the calendar's). Returns its unmount.
   */
  claim: (holdsSlot: boolean) => () => void
}

export const CellControlsContext = createContext<CellControlsValue | null>(null)

/** The attribute on a widget's top line: a right-click or Shift+F10 on it opens its cell's ⋯ menu. */
export const TOP_LINE_ATTR = 'data-widget-top-line'
