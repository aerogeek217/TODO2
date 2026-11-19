import { createContext, useContext } from 'react'
import type { GridAxis } from '../../models/workspace-layout'

/** The gutters' "+" (`GutterPlus`): what the table lends its dividers. */

/** The marker on the "+" (a divider's pointer leaving onto it keeps it). */
export const GUTTER_PLUS_ATTR = 'data-gutter-plus'

/** Where the pointer is along a divider: its line, the "+"'s centre (the viewport's px) and the divider's extent along it. */
export interface GutterHover {
  axis: GridAxis
  line: number
  x: number
  y: number
  from: number
  to: number
}

/** The table lends its dividers this setter while the mode is on (`null` outside it). */
export const GutterPlusContext = createContext<((hover: GutterHover | null) => void) | null>(null)

export function useGutterPlus(): ((hover: GutterHover | null) => void) | null {
  return useContext(GutterPlusContext)
}

