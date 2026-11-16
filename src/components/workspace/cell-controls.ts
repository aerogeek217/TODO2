import { createContext } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'

/**
 * What a cell without a tab strip (one widget, D26 AA1) lends its widget's
 * top line (`WidgetTopLine`): the controls slot — Open larger (the widget
 * popup, where the widget offers it) and the ⋯ that opens the
 * widget's menu (`cell-menu`) — and the tab the
 * line stands for. `null` (the context's default) wherever the widget isn't
 * alone in a cell: a strip names it there, and its ⋯ is in the strip's header
 * (a cell of two or more widgets, the widget popup, Settings).
 */
export interface CellControlsValue {
  /** The cell. */
  cellId: string
  /** Its tabs (one). */
  tabs: readonly LayoutTab[]
  /** The tab its widget's top line stands for (`data-ws-tab`). */
  tabId: string
  /** Its widget's title. */
  title: string
  /** Touch layout (the phone): the ⋯ always shown. */
  touch: boolean
  /** Takes the ⋯ button (a callback ref, with its cleanup): the menu opens under it. */
  setMoreButton: (el: HTMLButtonElement | null) => (() => void) | undefined
  /** A menu of the cell is open (the ⋯'s, Add widget): the slot stays shown. */
  menuOpen: boolean
  /** The ⋯'s menu is open (pressed, `aria-expanded`); default `menuOpen`. */
  moreOpen?: boolean
  /** The ⋯ was pressed. */
  onMore: () => void
  /** Opens the widget larger (the widget popup), where it offers that; no Open larger button without it. */
  onOpenLarger?: () => void
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
