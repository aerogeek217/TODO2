import type { MenuPictureEntry, MenuPictureOption } from '../shared/MenuPopover'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { insertLabel, splitLabel, tabLabel } from '../../utils/workspace-drop'

/**
 * Where Add widget puts the new widget, from a cell (D26 board V; drawn as
 * a picture, board BE): a tab of the cell, a new cell on one of its four
 * sides (a split), or a full-width row at the layout's top / bottom, a
 * full-height column at its left / right (an insert).
 */
export type AddWhere =
  | 'tab'
  | 'above' | 'below' | 'left' | 'right'
  | 'row-top' | 'row-bottom' | 'column-left' | 'column-right'

/** The layout target an Add widget from cell `cellId` lands on, for `where`. */
export function addWhereTarget(cellId: string, where: AddWhere): LayoutDropTarget {
  switch (where) {
    case 'tab': return { kind: 'cell', cellId }
    case 'above': return { kind: 'split', cellId, side: 'top' }
    case 'below': return { kind: 'split', cellId, side: 'bottom' }
    case 'left': return { kind: 'split', cellId, side: 'left' }
    case 'right': return { kind: 'split', cellId, side: 'right' }
    case 'row-top': return { kind: 'insert', edge: 'top' }
    case 'row-bottom': return { kind: 'insert', edge: 'bottom' }
    case 'column-left': return { kind: 'insert', edge: 'left' }
    case 'column-right': return { kind: 'insert', edge: 'right' }
  }
}

/** Each choice's words, in the drag ghost's (`workspace-drop.dropLabel`): an insert also says which edge. */
export function addWhereLabel(where: AddWhere): string {
  const target = addWhereTarget('', where)
  switch (target.kind) {
    case 'split': return splitLabel(target.side)
    case 'insert': return `${insertLabel(target.edge)}, ${target.edge}`
    default: return tabLabel()
  }
}

/**
 * The picture's grid (7 × 7 tracks): the layout's edges as bars outside the
 * cell (tracks 1 and 7), a gap (2 and 6), and the cell's own 3 × 3 — its
 * sides around a wider middle.
 */
const COLUMNS = '12px 10px 1fr 2fr 1fr 10px 12px'
const ROWS = '12px 10px 1fr 1.4fr 1fr 10px 12px'

/** Where each choice sits on the picture, and the short word drawn in it (the bars have none). */
const PLACES: ReadonlyArray<Omit<MenuPictureOption, 'description'> & { value: AddWhere }> = [
  { value: 'row-top', area: { row: 1, col: 3, colSpan: 3 } },
  { value: 'column-left', area: { row: 3, col: 1, rowSpan: 3 } },
  { value: 'above', area: { row: 3, col: 4 }, text: 'Above' },
  { value: 'left', area: { row: 4, col: 3 }, text: 'Left' },
  { value: 'tab', area: { row: 4, col: 4 }, text: 'Tab' },
  { value: 'right', area: { row: 4, col: 5 }, text: 'Right' },
  { value: 'below', area: { row: 5, col: 4 }, text: 'Below' },
  { value: 'column-right', area: { row: 3, col: 7, rowSpan: 3 } },
  { value: 'row-bottom', area: { row: 7, col: 3, colSpan: 3 } },
]

/** Every choice, in the picture's reading order. */
export const ADD_WHERE_OPTIONS: readonly AddWhere[] = PLACES.map((p) => p.value)

export function isAddWhere(value: string): value is AddWhere {
  return (ADD_WHERE_OPTIONS as readonly string[]).includes(value)
}

/**
 * Add widget's Where as a picture (`MenuPictureEntry`): the cell drawn —
 * its middle a tab, a side a split that way —, and the layout's edges as
 * bars outside it, a full-width row or full-height column there.
 */
export function addWherePicture(where: AddWhere, onChange: (where: AddWhere) => void): MenuPictureEntry {
  return {
    kind: 'picture',
    label: 'Where',
    columns: COLUMNS,
    rows: ROWS,
    height: 176,
    frame: { row: 3, col: 3, rowSpan: 3, colSpan: 3 },
    options: PLACES.map((p) => ({ ...p, description: addWhereLabel(p.value) })),
    value: where,
    onChange: (value) => { if (isAddWhere(value)) onChange(value) },
  }
}
