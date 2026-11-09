import { createContext, useContext, useState } from 'react'
import { tabIgnoresLens, type LensSwitchTab } from '../models/workspace-layout'
import { useFilterStore } from '../stores/filter-store'
import { useAppliedLens, type ScreenFilterState } from '../stores/screen-filter'
import { useWorkspaceStore } from '../stores/workspace-store'
import { withLens, type Lens } from '../utils/lens'

/**
 * A widget's lens switch (G3, board BD): one control on every widget the
 * top bar's filter reaches. `WidgetLensContext` says whether the widget
 * being drawn ignores the top bar's lens (`WidgetBody` provides it from
 * the tab, `tabIgnoresLens`), and everything that filters by the screen
 * filter inside it — the glance widgets' shared base, the calendar, the
 * Eisenhower, the Neglect map — reads the screen filter through
 * `useWidgetScreenFilter`, so its data follows the switch. A list's switch
 * is its list's (`useListScreenFilter`).
 */

/** The widget being drawn ignores the top bar's lens (`false` outside a widget: the top bar, Settings). */
export const WidgetLensContext = createContext(false)

/** Whether the widget being drawn ignores the top bar's lens. */
export function useWidgetIgnoresLens(): boolean {
  return useContext(WidgetLensContext)
}

/**
 * The screen filter as the widget being drawn applies it: the top bar's
 * chips with its lens (`stores/screen-filter.useScreenFilter`) — without
 * the lens while the widget ignores it (`ignore`, else the context's).
 */
export function useWidgetScreenFilter(ignore?: boolean): ScreenFilterState {
  const context = useContext(WidgetLensContext)
  const chips = useFilterStore((s) => s.filters)
  const chipsActive = useFilterStore((s) => s.isActive)
  const lens = useAppliedLens()
  const applied = (ignore ?? context) ? undefined : lens
  return { filters: withLens(chips, applied), active: chipsActive || applied != null }
}

/** The top bar's lens as it applies to the widget being drawn: none while it ignores it. */
export function useWidgetAppliedLens(): Lens | undefined {
  const ignored = useContext(WidgetLensContext)
  const lens = useAppliedLens()
  return ignored ? undefined : lens
}

/** The top bar's lens on one widget, as its switch shows it (a list's too: `ListLensMark`). */
export interface LensMark {
  /** The lens's name. */
  name: string
  /** The widget ignores the lens. */
  ignored: boolean
  /** What the lens hides (or would hide) there. */
  hides: number
}

/** Turns the top bar's lens off (`ignore`) or on for a widget: its view state, saved at once (a case per kind). */
export function setTabIgnoresLens(tab: LensSwitchTab, ignore: boolean): void {
  const ws = useWorkspaceStore.getState()
  const patch = { ignoreLens: ignore }
  switch (tab.kind) {
    case 'calendar': void ws.patchTabViewState(tab.id, 'calendar', patch); return
    case 'eisenhower': void ws.patchTabViewState(tab.id, 'eisenhower', patch); return
    case 'neglect': void ws.patchTabViewState(tab.id, 'neglect', patch); return
    case 'number': void ws.patchTabViewState(tab.id, 'number', patch); return
    case 'pulse': void ws.patchTabViewState(tab.id, 'pulse', patch); return
    case 'breakdown': void ws.patchTabViewState(tab.id, 'breakdown', patch); return
    case 'pivot': void ws.patchTabViewState(tab.id, 'pivot', patch); return
    case 'tagMap': void ws.patchTabViewState(tab.id, 'tagMap', patch); return
  }
}

/** A widget's switch: its mark (while shown) and its toggle. */
export interface WidgetLensSwitch {
  mark: LensMark | undefined
  toggle: () => void
}

/**
 * The lens switch of a widget (not a list): shown while a lens applies at
 * the top bar and it hides something there (`hides`), or the widget
 * ignores it — and, once used, for as long as that lens stays picked, so a
 * click that leaves it nothing to hide doesn't take it from under the
 * focus (as a list's, U7). Its toggle writes the tab's view state.
 */
export function useWidgetLensSwitch(tab: LensSwitchTab, hides: number): WidgetLensSwitch {
  const lens = useAppliedLens()
  const ignored = tabIgnoresLens(tab)
  const [usedFor, setUsedFor] = useState<string | null>(null)
  const used = lens != null && usedFor === lens.id
  const mark = lens && (ignored || hides > 0 || used) ? { name: lens.name, ignored, hides } : undefined
  return {
    mark,
    toggle: () => {
      if (lens) setUsedFor(lens.id)
      setTabIgnoresLens(tab, !ignored)
    },
  }
}
