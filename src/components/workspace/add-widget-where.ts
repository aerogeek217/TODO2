import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'

/**
 * Where Add widget puts the new widget, from a cell (D26 board V): a tab
 * of the cell, a new cell on its right or below it (a split), or a
 * full-width row at the layout's bottom / a full-height column at its right
 * (an insert).
 */
export type AddWhere = 'tab' | 'right' | 'below' | 'row' | 'column'

/** The where choices, in the order Add widget shows them. */
export const ADD_WHERE_OPTIONS: ReadonlyArray<{ value: AddWhere; label: string; title: string }> = [
  { value: 'tab', label: 'Tab', title: 'A tab of this cell' },
  { value: 'right', label: 'Right', title: 'A new cell on its right' },
  { value: 'below', label: 'Below', title: 'A new cell below it' },
  { value: 'row', label: 'Row', title: 'A new full-width row at the bottom' },
  { value: 'column', label: 'Column', title: 'A new full-height column at the right' },
]

/** The layout target an Add widget from cell `cellId` lands on, for `where`. */
export function addWhereTarget(cellId: string, where: AddWhere): LayoutDropTarget {
  switch (where) {
    case 'tab': return { kind: 'cell', cellId }
    case 'right': return { kind: 'split', cellId, side: 'right' }
    case 'below': return { kind: 'split', cellId, side: 'bottom' }
    case 'row': return { kind: 'insert', edge: 'bottom' }
    case 'column': return { kind: 'insert', edge: 'right' }
  }
}

export function isAddWhere(value: string): value is AddWhere {
  return ADD_WHERE_OPTIONS.some((o) => o.value === value)
}
