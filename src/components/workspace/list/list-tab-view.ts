import { createContext } from 'react'
import type { ListTabViewState } from '../../../models/workspace-layout'

/**
 * Where a list widget's view state — its zoom, its row details width — is
 * kept when its tab is not a list tab of the layout: the list a Number
 * follows, shown in the widget popup as a list tab of the Number's id
 * (`WidgetPopupHost`). A write to the layout's tab of that id would change
 * nothing — it is a Number (cr34 U3) —, so the popup holds the view state
 * itself and the list writes it here.
 *
 * `null` (the default): the layout's own list tab, written through
 * `workspace-store.patchTabViewState` / `services/list-zoom`.
 */
export interface ListTabViewHost {
  /** Shallow-patches the held view state; a key patched to `undefined` goes back to its default. */
  patch: (patch: Partial<ListTabViewState>) => void
}

export const ListTabViewContext = createContext<ListTabViewHost | null>(null)
