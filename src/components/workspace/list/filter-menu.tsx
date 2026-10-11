import { useMemo, type ReactNode } from 'react'
import type { DateField } from '../../../models/app-view'
import { usePersonStore } from '../../../stores/person-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import type { ListFilterField } from '../../../stores/list-widget-store'
import type { FilterChipNames } from '../../../utils/filter-chips'
import { FocusIcon } from '../../shared/FocusMarker'
import { AtIcon, FlagIcon, HashIcon, SearchIcon, StatusRingIcon, WidgetKindIcon } from '../icons'

/** The entity names chips resolve ids against, kept current. */
export function useChipNames(): FilterChipNames {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const projects = useProjectStore((s) => s.projects)
  return useMemo(() => ({ people, tags, statuses, projects }), [people, tags, statuses, projects])
}

/** "+ Filter" menu items: a field, then that field's picker. */
export const ADD_FILTER_ITEMS: ReadonlyArray<{ label: string; field: ListFilterField; dateField?: DateField; icon: ReactNode; submenu: boolean }> = [
  { label: 'People', field: 'people', icon: <AtIcon />, submenu: true },
  { label: 'Tags', field: 'tags', icon: <HashIcon />, submenu: true },
  { label: 'Due date', field: 'dates', dateField: 'deadline', icon: <WidgetKindIcon kind="calendar" />, submenu: true },
  { label: 'Follow-up date', field: 'dates', dateField: 'followup', icon: <FlagIcon />, submenu: true },
  { label: 'Status', field: 'status', icon: <StatusRingIcon />, submenu: true },
  { label: 'Focus', field: 'focus', icon: <FocusIcon />, submenu: true },
  { label: 'Text contains…', field: 'text', icon: <SearchIcon />, submenu: false },
]
