import { FilterChipBarDesktop } from './FilterChipBar.desktop'
import { FilterChipBarMobile } from './FilterChipBar.mobile'
import type { FilterChipBarProps, FilterChipDensity } from './FilterChipBar.shared'

export type { FilterChipBarProps, FilterChipDensity }

/**
 * Dispatcher that routes to the desktop or mobile variant based on the
 * `density` prop. Each variant lives in its own file (`.desktop.tsx` /
 * `.mobile.tsx`) and shares predicate-management state via the
 * `useFilterChipBarState` hook in `FilterChipBar.shared.ts`. The split
 * mirrors the `TaskRow` / `MobileTaskRow` precedent — see
 * `code-review-tail-2026-05-09` P4.
 */
export function FilterChipBar(props: FilterChipBarProps) {
  if (props.density === 'mobile') return <FilterChipBarMobile {...props} />
  return <FilterChipBarDesktop {...props} />
}
