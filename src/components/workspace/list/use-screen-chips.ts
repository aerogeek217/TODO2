import { useMemo } from 'react'
import { useFilterStore } from '../../../stores/filter-store'
import { filterChips, type FilterChip } from '../../../utils/filter-chips'
import { useChipNames } from '../../shared/filters/filter-menu'

/** The screen filter's chips (read-only, set in the top bar), or none while it is off. */
export function useScreenChips(): readonly FilterChip[] {
  const screen = useFilterStore((s) => s.filters)
  const screenActive = useFilterStore((s) => s.isActive)
  const names = useChipNames()
  return useMemo(() => (screenActive ? filterChips(screen, names, true) : []), [screenActive, screen, names])
}
