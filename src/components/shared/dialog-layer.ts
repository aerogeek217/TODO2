import { createContext, useContext } from 'react'
import type { DialogLayer } from './Dialog'

/** The tier of the dialog a component renders in (through portals too); `null` outside any dialog. */
export const DialogLayerContext = createContext<DialogLayer | null>(null)

/**
 * Marks a modal's backdrop (the dialog frame's and Quick Add's scrim): a
 * dialog that opens while one is in the page is stacked, and its backdrop
 * adds no second blur. Named in `utils/dom-contract`, which the task drag's
 * collision reads too (nothing under a modal takes a drop).
 */
export { MODAL_BACKDROP_ATTR } from '../../utils/dom-contract'

/** The tier of the dialog this component sits in, or `null` (the workspace, the top bar). */
export function useDialogLayer(): DialogLayer | null {
  return useContext(DialogLayerContext)
}
