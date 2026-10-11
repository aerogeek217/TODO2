import { useMemo } from 'react'
import type { Person, PersistedTodoItem, ProjectGroupBy } from '../models'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useFilterStore } from '../stores/filter-store'
import { partitionByGroup, getGroupColor } from '../utils/task-grouping'
import { UNGROUPED_GROUP_KEY } from '../utils/cross-group-drag'
import { startOfToday } from '../utils/date'

/**
 * One rendered group block emitted by {@link useGroupedTaskBlocks}.
 *
 * `key` is the SortableContext id used by `SortableTaskList`. The synthetic
 * ungrouped collection uses `UNGROUPED_GROUP_KEY` and a null label (no
 * `TaskGroup` wrapper); named groups carry the entity-specific key
 * (`status-N`, `person-N`, `tag-N`) and a swatch color.
 *
 * `nextBlockFirstId` lets the row renderer compute the after-row insert
 * trigger's `beforeId` without peeking at sibling blocks.
 */
export interface RenderBlock {
  key: string
  label: string | null
  color?: string
  todos: PersistedTodoItem[]
  nextBlockFirstId: number | null
}

/**
 * Partition `displayItems` into the rendered blocks `SortableTaskList` walks
 * to render grouped layouts. Returns `null` when `groupBy` is unset — the
 * caller falls back to the flat single-`SortableContext` path.
 *
 * The hook subscribes to the tag / status / filter stores so
 * `SortableTaskList` doesn't have to thread the grouping context through.
 * `assignedPeopleMap` stays a parameter because callers already pass a
 * per-canvas filtered/stable reference.
 *
 * Filter-aware ordering matches the runtime / manual filter contract:
 * when `groupBy` aligns with an active filter dimension, restrict the
 * visible groups to that filter's keys.
 */
export function useGroupedTaskBlocks(
  displayItems: PersistedTodoItem[],
  groupBy: ProjectGroupBy | null | undefined,
  assignedPeopleMap: Map<number, Person[]> | undefined,
): RenderBlock[] | null {
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const today = useMemo(() => startOfToday(), [])

  const filterPersonIds = useFilterStore((s) => s.filters.personIds)
  const filterTags = useFilterStore((s) => s.filters.tags)

  return useMemo<RenderBlock[] | null>(() => {
    if (!groupBy) return null
    const ctx = {
      assignedPeopleMap: assignedPeopleMap ?? new Map(),
      assignedTagsMap,
      statuses,
      today,
    }
    let restrictToFilterSet: string[] | undefined
    if (groupBy === 'people' && filterPersonIds && filterPersonIds.size > 0) {
      restrictToFilterSet = [...filterPersonIds].map((id) => `person-${id}`)
    } else if (groupBy === 'tag' && filterTags && filterTags.size > 0) {
      restrictToFilterSet = [...filterTags].map((id) => `tag-${id}`)
    }
    const partition = partitionByGroup(
      displayItems,
      groupBy,
      ctx,
      undefined,
      restrictToFilterSet,
    )
    const out: RenderBlock[] = []
    if (partition.ungrouped.length > 0) {
      out.push({ key: UNGROUPED_GROUP_KEY, label: null, todos: partition.ungrouped, nextBlockFirstId: null })
    }
    for (const g of partition.groups) {
      out.push({
        key: g.key,
        label: g.label,
        color: getGroupColor(g.key, groupBy, ctx),
        todos: g.todos,
        nextBlockFirstId: null,
      })
    }
    for (let i = 0; i < out.length - 1; i++) {
      const current = out[i]
      const next = out[i + 1]
      if (current && next) {
        current.nextBlockFirstId = next.todos[0]?.id ?? null
      }
    }
    return out
  }, [groupBy, displayItems, assignedPeopleMap, assignedTagsMap, statuses, today, filterPersonIds, filterTags])
}
