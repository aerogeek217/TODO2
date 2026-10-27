import type { FilterCriteria } from '../utils/filter-criteria'
import { findLens, withLens, type Lens } from '../utils/lens'
import { useFilterStore } from './filter-store'
import { useSettingsStore } from './settings-store'
import { useUIStore } from './ui-store'

/**
 * The screen filter as the widgets apply it: the top bar's chips
 * (`filter-store`) with the top bar's lens (`settings-store.activeLensId`,
 * the same on every layout) composed under them (`utils/lens.withLens`) —
 * unless it is lifted for now (`ui-store`).
 * Everything that filters by the screen filter reads it here (lists, the
 * Eisenhower, the dashboard, the calendar, the counter and the filtered
 * tasks); what edits the chips, counts them or seeds a new task from them
 * reads `filter-store` itself.
 */

/** The top bar's lens as it applies now: picked, still there, not lifted. */
export function appliedLensOf(lenses: readonly Lens[], lensId: string | null, lifted: boolean): Lens | undefined {
  return lifted ? undefined : findLens(lenses, lensId)
}

/** The top bar's lens as picked, lifted or not. */
export function currentPickedLens(): Lens | undefined {
  const { lenses, activeLensId } = useSettingsStore.getState()
  return findLens(lenses, activeLensId)
}

/** The top bar's lens as it applies now (`appliedLensOf`). */
export function currentAppliedLens(): Lens | undefined {
  const { lenses, activeLensId } = useSettingsStore.getState()
  return appliedLensOf(lenses, activeLensId, useUIStore.getState().lensLifted)
}

/** The screen filter with the lens, as it is now (the same object while nothing changed). */
export function currentScreenFilter(): FilterCriteria {
  return withLens(useFilterStore.getState().filters, currentAppliedLens())
}

/** The top bar's lens as picked — lifted or not — kept current; none when none is picked (or one deleted since). */
export function usePickedLens(): Lens | undefined {
  const lenses = useSettingsStore((s) => s.lenses)
  const lensId = useSettingsStore((s) => s.activeLensId)
  return findLens(lenses, lensId)
}

/** The top bar's lens as it applies now, kept current. */
export function useAppliedLens(): Lens | undefined {
  const picked = usePickedLens()
  const lifted = useUIStore((s) => s.lensLifted)
  return lifted ? undefined : picked
}

/** What a widget filters by: the screen filter with the lens, and whether anything narrows (chips or a lens). */
export interface ScreenFilterState {
  filters: FilterCriteria
  active: boolean
}

/** The screen filter with the lens (`currentScreenFilter`), kept current. */
export function useScreenFilter(): ScreenFilterState {
  const chips = useFilterStore((s) => s.filters)
  const chipsActive = useFilterStore((s) => s.isActive)
  const lens = useAppliedLens()
  const filters = withLens(chips, lens)
  return { filters, active: chipsActive || lens != null }
}
