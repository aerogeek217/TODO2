import { createContext, useContext } from 'react'
import type { CellArea } from '../../models/workspace-layout'
import type { RulerNames } from '../../utils/layout-edit-cards'

/** A card's corner drag in progress (E3): the area its release gives the card, drawn over the table. */
export interface StretchPreview {
  cellId: string
  area: CellArea
}

/**
 * What the layout edit mode's table lends its cards and slots (E3): the
 * rulers' names of the tracks as drawn (`B4`), and the stretch preview's
 * setter. `null` outside the mode.
 */
export interface LayoutEditView {
  names: RulerNames
  setStretch: (preview: StretchPreview | null) => void
}

export const LayoutEditViewContext = createContext<LayoutEditView | null>(null)

/** No names measured yet: cards and slots are named by their track indices (`A1`). */
const UNMEASURED: RulerNames = { columns: [], rows: [] }

export function useLayoutEditView(): LayoutEditView | null {
  return useContext(LayoutEditViewContext)
}

/** The rulers' names, as the mode's table measured them (unmeasured: by index). */
export function useRulerNames(): RulerNames {
  return useContext(LayoutEditViewContext)?.names ?? UNMEASURED
}
