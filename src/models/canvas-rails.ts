export type RailSide = 'left' | 'right' | 'top' | 'bottom'
export type RailOrientation = 'vertical' | 'horizontal'
export type SlotKind = 'lens' | 'notes' | 'calendar'

export interface Slot {
  id: string
  kind: SlotKind
  listDefinitionId?: number
}

export interface Rail {
  orientation: RailOrientation
  slots: Slot[]
}

export type RailsState = Record<RailSide, Rail | null>

export const EMPTY_RAILS: RailsState = {
  left: null,
  right: null,
  top: null,
  bottom: null,
}

export function railOrientationForSide(side: RailSide): RailOrientation {
  return side === 'left' || side === 'right' ? 'vertical' : 'horizontal'
}
