import { createContext, useContext } from 'react'
import type { DialogLayer } from './Dialog'

/** The tier of the dialog a component renders in (through portals too); `null` outside any dialog. */
export const DialogLayerContext = createContext<DialogLayer | null>(null)

/** The tier of the dialog this component sits in, or `null` (the workspace, the top bar). */
export function useDialogLayer(): DialogLayer | null {
  return useContext(DialogLayerContext)
}
