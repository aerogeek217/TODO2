import type { KeyboardEvent, MouseEvent } from 'react'
import { getActiveTab, type CellArea, type LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { altMove, areaRulerName, spatialNeighbour, type DrawnAxis, type RulerNames, type StretchDirection } from '../../utils/layout-edit-cards'
import type { Side } from '../../utils/workspace-grid'
import { bodyZone } from '../../utils/workspace-drop'
import { drawnGap, drawnSizes } from './divider-drag'
import { focusEditItem } from './edit-focus'
import { cardTabArea } from './measure'

/**
 * The layout edit mode's cards and slots (E3): what their presses and keys
 * do (`EditCard` draws them). Each acts on the draft through the store and
 * keeps the focus on what moved (`focusEditItem`).
 */

/** Where a card's menu opens: under its ⋯ (`null`), or at a point (a right-click). */
export type CardMenuAt = { x: number; y: number } | null

export const ARROW_SIDES: Readonly<Record<string, Side>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }
const STRETCH_OF: Readonly<Record<Side, StretchDirection>> = { left: 'left', right: 'right', top: 'up', bottom: 'down' }

const store = useWorkspaceStore.getState

/**
 * A card's or slot's focus selects it (the keyboard's way to the
 * selection) — not while a tap armed a move: the tap on the next card or
 * slot focuses it first, and that tap is the move.
 */
export function selectOnFocus(cellId: string): void {
  const editing = store().editing
  if (!editing || editing.moveArmed || editing.selectedCellId === cellId) return
  store().selectEditCell(cellId)
}

/** After a tap that moved or joined the armed card, or placed the widgets in hand: the focus on where it is now. */
export function focusAfterTap(kind: string): void {
  if (kind !== 'move' && kind !== 'join' && kind !== 'swap' && kind !== 'place') return
  const selected = store().editing?.selectedCellId
  if (selected != null) focusEditItem(selected)
}

/** The arrow keys on a card or slot: the selection to the neighbour that way (and the focus with it). */
export function moveSelection(cellId: string, side: Side): boolean {
  const layout = store().working
  const next = layout ? spatialNeighbour(layout, cellId, side) : undefined
  if (!next) return false
  store().selectEditCell(next.id)
  focusEditItem(next.id)
  return true
}

/** The card menu's width (px): `EditCardMenu`'s. */
const CARD_MENU_WIDTH_PX = 248

/**
 * Where the keys open a card's menu: under its ⋯, its right edge there — a
 * point, not the ⋯ as its anchor, so closing it hands the focus back to the
 * card (an anchored menu gives it to its anchor).
 */
function keyMenuPoint(surface: HTMLElement): CardMenuAt {
  const more = surface.parentElement?.querySelector('[data-edit-card-more]')
  const r = (more ?? surface).getBoundingClientRect()
  return { x: Math.max(8, r.right - CARD_MENU_WIDTH_PX), y: r.bottom + 4 }
}

/**
 * A key on a card (`cell`): arrows, Shift+arrow (stretch one track),
 * Alt+arrow (onto the slot beside it, or swap with the card there), Enter /
 * Shift+F10 / the Menu key (its menu), Space (a tap), Delete / Backspace
 * (Remove widget on its active tab). The focus stays on the card.
 */
export function onCardKey(e: KeyboardEvent<HTMLElement>, cell: LayoutCell, onMenu: (at: CardMenuAt) => void): void {
  if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey) return
  const side = ARROW_SIDES[e.key]
  if (side) {
    e.preventDefault()
    const layout = store().working
    if (!layout) return
    if (e.altKey) {
      const move = altMove(layout, cell.id, side)
      if (move?.kind === 'move') {
        if (store().moveEditCard(cell.id, { kind: 'cell', cellId: move.cellId })) {
          const selected = store().editing?.selectedCellId
          if (selected != null) focusEditItem(selected)
        }
      } else if (move?.kind === 'swap') {
        store().swapCells(cell.id, move.cellId)
        focusEditItem(cell.id)
      }
      return
    }
    if (e.shiftKey) {
      store().stretchCell(cell.id, STRETCH_OF[side])
      focusEditItem(cell.id)
      return
    }
    moveSelection(cell.id, side)
    return
  }
  if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault()
    store().selectEditCell(cell.id)
    onMenu(keyMenuPoint(e.currentTarget))
    return
  }
  if (e.key === ' ') {
    e.preventDefault()
    focusAfterTap(store().tapEdit({ kind: 'card', cellId: cell.id, zone: 'middle' }).kind)
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const tab = getActiveTab(cell)
    if (!tab) return
    e.preventDefault()
    store().removeWidget(tab.id)
    focusEditItem(cell.id)
  }
}

/**
 * Which part of a card a click landed on: its tab area (`cardTabArea`: a
 * join, after an armed card), its middle (a swap) or near an edge (selects
 * it) — the zones a drop reads (`workspace-drop.hitTestWorkspace`).
 */
function tapZone(e: MouseEvent<HTMLElement>): 'middle' | 'tabs' | 'edge' {
  const card = e.currentTarget.closest<HTMLElement>('[data-ws-cell]') ?? e.currentTarget
  const r = card.getBoundingClientRect()
  const p = { x: e.clientX, y: e.clientY }
  const tabs = cardTabArea(card)
  if (tabs && p.x >= tabs.left && p.x <= tabs.right && p.y >= tabs.top && p.y <= tabs.bottom) return 'tabs'
  const top = tabs ? Math.max(r.top, tabs.bottom) : r.top
  return bodyZone({ left: r.left, top, right: r.right, bottom: r.bottom }, p) === 'middle' ? 'middle' : 'edge'
}

/** A click on a card (its surface, a strip's Number): a tap (`workspace-store.tapEdit`). */
export function tapCard(e: MouseEvent<HTMLElement>, cellId: string): void {
  focusAfterTap(store().tapEdit({ kind: 'card', cellId, zone: tapZone(e) }).kind)
}

/** The px each track of the table spans along an axis (its start in the viewport, its size), as drawn. */
export function drawnAxis(table: HTMLElement, axis: 'columns' | 'rows'): DrawnAxis {
  const sizes = drawnSizes(table, axis)
  const gap = drawnGap(table, axis)
  const r = table.getBoundingClientRect()
  const style = getComputedStyle(table)
  const pad = Number.parseFloat(axis === 'columns' ? style.paddingLeft : style.paddingTop) || 0
  let at = (axis === 'columns' ? r.left + table.clientLeft - table.scrollLeft : r.top + table.clientTop - table.scrollTop) + pad
  const starts = sizes.map((size) => {
    const start = at
    at += size + gap
    return start
  })
  return { starts, sizes }
}

/** The words a stretch's preview carries: where the card's corner reaches (`B2–C3`). */
export function stretchLabel(area: CellArea, names: RulerNames): string {
  return `Stretch · ${areaRulerName(area, names)}`
}
