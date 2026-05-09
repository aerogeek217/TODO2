import { useMemo } from 'react'
import type { Person, PersistedTodoItem, ProjectGroupBy } from '../models'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
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
 * (`status-N`, `person-N`, `org-N`, `tag-N`) and a swatch color.
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
 * The hook subscribes to org / tag / status / settings / filter stores so
 * `SortableTaskList` doesn't have to thread the grouping context through.
 * `assignedPeopleMap` stays a parameter because callers already pass a
 * per-canvas filtered/stable reference.
 *
 * Filter-aware ordering matches the runtime / manual filter contract:
 * when `groupBy` aligns with an active filter dimension, restrict the
 * visible groups to that filter's keys (P6 intersection rule) and surface
 * cross-axis "implicit" tasks (org→members for people, person→orgs for
 * org) as members of the named group rather than the ungrouped bucket.
 */
export function useGroupedTaskBlocks(
  displayItems: PersistedTodoItem[],
  groupBy: ProjectGroupBy | null | undefined,
  assignedPeopleMap: Map<number, Person[]> | undefined,
): RenderBlock[] | null {
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const orgs = useOrgStore((s) => s.orgs)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const today = useMemo(() => startOfToday(), [])

  const filterPersonIds = useFilterStore((s) => s.filters.personIds)
  const personFilterMode = useFilterStore((s) => s.filters.personFilterMode)
  const filterOrgIds = useFilterStore((s) => s.filters.orgIds)
  const orgFilterMode = useFilterStore((s) => s.filters.orgFilterMode)
  const filterTags = useFilterStore((s) => s.filters.tags)

  return useMemo<RenderBlock[] | null>(() => {
    if (!groupBy) return null
    const ctx = {
      assignedPeopleMap: assignedPeopleMap ?? new Map(),
      assignedOrgsMap,
      assignedTagsMap,
      statuses,
      orgs,
      personOrgMap,
      today,
      weekStartsOn,
    }
    let restrictToFilterSet: string[] | undefined
    let implicitKeysFor:
      | ((todo: PersistedTodoItem, axis: ProjectGroupBy) => readonly string[])
      | undefined
    if (groupBy === 'people' && filterPersonIds && filterPersonIds.size > 0) {
      restrictToFilterSet = [...filterPersonIds].map((id) => `person-${id}`)
      // Implicit (cross-axis) keys for the people grouping: when the
      // person-filter mode is `include-orgs` (the manual-filter default),
      // tasks that survive the filter via "task has org X, X has member A"
      // emit under person-A as implicit. Direct-only mode (the runtime-
      // filter hardcode + the user's explicit "People only" toggle) skips
      // this branch — those tasks shouldn't have passed the filter anyway,
      // so the partition's empty-intersection skip leaves them out of every
      // visible group.
      if (personFilterMode === 'include-orgs') {
        implicitKeysFor = (todo) => {
          const taskOrgs = assignedOrgsMap.get(todo.id) ?? []
          if (taskOrgs.length === 0) return []
          const orgIdSet = new Set<number>()
          for (const o of taskOrgs) {
            if (o.id != null) orgIdSet.add(o.id)
          }
          const memberKeys: string[] = []
          const seen = new Set<string>()
          for (const [pid, orgIds] of personOrgMap) {
            for (const oid of orgIds) {
              if (orgIdSet.has(oid)) {
                const k = `person-${pid}`
                if (!seen.has(k)) {
                  seen.add(k)
                  memberKeys.push(k)
                }
                break
              }
            }
          }
          return memberKeys
        }
      }
    } else if (groupBy === 'org' && filterOrgIds && filterOrgIds.size > 0) {
      restrictToFilterSet = [...filterOrgIds].map((id) => `org-${id}`)
      // Symmetric to people grouping: in `include-people` mode, tasks that
      // survive the filter via "task has person P, P is a member of org X"
      // emit under org-X as implicit.
      if (orgFilterMode === 'include-people') {
        implicitKeysFor = (todo) => {
          const taskPeople = assignedPeopleMap?.get(todo.id) ?? []
          if (taskPeople.length === 0) return []
          const orgKeys: string[] = []
          const seen = new Set<string>()
          for (const p of taskPeople) {
            if (p.id == null) continue
            const orgIds = personOrgMap.get(p.id) ?? []
            for (const oid of orgIds) {
              const k = `org-${oid}`
              if (!seen.has(k)) {
                seen.add(k)
                orgKeys.push(k)
              }
            }
          }
          return orgKeys
        }
      }
    } else if (groupBy === 'tag' && filterTags && filterTags.size > 0) {
      // Tags have no cross-axis path — direct-only intersection.
      restrictToFilterSet = [...filterTags].map((id) => `tag-${id}`)
    }
    const partition = partitionByGroup(
      displayItems,
      groupBy,
      ctx,
      undefined,
      restrictToFilterSet,
      implicitKeysFor,
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
  }, [groupBy, displayItems, assignedPeopleMap, assignedOrgsMap, assignedTagsMap, statuses, orgs, personOrgMap, today, weekStartsOn, filterPersonIds, personFilterMode, filterOrgIds, orgFilterMode, filterTags])
}
