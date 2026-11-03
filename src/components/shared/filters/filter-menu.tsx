import { useMemo, type ReactNode } from 'react'
import { useToday } from '../../../hooks/use-today'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import type { ListFilterField } from '../../../stores/list-widget-store'
import type { ChipDay, FilterChipNames } from '../../../utils/filter-chips'
import { MARKERS_LABEL } from '../../../utils/markers'
import { ImportantIcon } from '../MarkerIcons'
import { AtIcon, HashIcon, SearchIcon, StatusRingIcon, WidgetKindIcon } from '../icons'

/**
 * The entity names chips resolve ids against, and today with the week start
 * (a date chip's tooltip spells its range's days), kept current.
 */
export function useChipNames(): FilterChipNames {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const day = useChipDay()
  return useMemo(() => ({ people, tags, statuses, day }), [people, tags, statuses, day])
}

/** Today (rolling over at midnight) and the week start, for a date chip's tooltip. */
export function useChipDay(): ChipDay {
  const today = useToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  return useMemo(() => ({ today, weekStartsOn }), [today, weekStartsOn])
}

/**
 * "+ Filter" menu items, in the top bar's filter order: a field, then that
 * field's picker (Dates opens the date panel on the first type that filters, else Due).
 */
export const ADD_FILTER_ITEMS: ReadonlyArray<{ label: string; field: ListFilterField; icon: ReactNode; submenu: boolean }> = [
  { label: MARKERS_LABEL, field: 'markers', icon: <ImportantIcon outline />, submenu: true },
  { label: 'Tags', field: 'tags', icon: <HashIcon />, submenu: true },
  { label: 'People', field: 'people', icon: <AtIcon />, submenu: true },
  { label: 'Dates', field: 'dates', icon: <WidgetKindIcon kind="calendar" />, submenu: true },
  { label: 'Status', field: 'status', icon: <StatusRingIcon />, submenu: true },
  { label: 'Text contains…', field: 'text', icon: <SearchIcon />, submenu: false },
]
