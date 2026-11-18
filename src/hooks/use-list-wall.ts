import { useEffect, useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import { getActiveTab } from '../models/workspace-layout'
import { applyRuntimeFilter } from '../services/build-list'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { listAsShown, useListDraftStore } from '../stores/list-draft-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useScreenFilter } from '../stores/screen-filter'
import { useSettingsStore } from '../stores/settings-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { createPredicateEvaluator, createScreenComposedEvaluator } from '../utils/filter-match'
import { rowTone } from '../utils/list-zoom'
import { buildWallList, wallTone, type WallList } from '../utils/list-wall'
import { readingOrder } from '../utils/workspace-grid'
import { useFilterSettings } from './use-filter-settings'
import { useTodoNameLookups } from './use-todo-name-lookups'
import { useToday } from './use-today'

/**
 * The List wall's blocks: every list tab of the open layout, in reading
 * order (by cell, then strip order), each with the open tasks it shows on
 * opening — the list as edited, its prompt pick and the screen filter, as
 * its tab badge counts them (`use-tab-badges`) — and whether its cell is
 * showing it. A list still waiting on its prompt has an empty block.
 */
export function useListWall(): WallList<PersistedTodoItem>[] {
  const layout = useWorkspaceStore((s) => s.working)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const picks = useListWidgetStore((s) => s.picks)
  const todos = useTodoStore((s) => s.todos)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const { filters: screen, active: screenActive } = useScreenFilter()
  const settings = useFilterSettings()
  const today = useToday()
  // The lists' tabs may be closed: their filters still need the status updates, subtasks and tags.
  const lookups = useTodoNameLookups({ ensureLoaded: true })
  useEffect(() => {
    if (todos.length > 0) loadTagAssignments(todos.map((t) => t.id))
  }, [todos, loadTagAssignments])

  return useMemo(() => {
    if (!layout) return []
    const matches = screenActive
      ? createScreenComposedEvaluator(screen, lookups, today, settings)
      : createPredicateEvaluator(lookups, today, settings)
    const open = todos.filter((t) => !t.isCompleted)
    const toneOf = (t: PersistedTodoItem) => wallTone(rowTone(t, today, { urgentRange, staleAfterDays }))
    const lists: WallList<PersistedTodoItem>[] = []
    for (const cell of readingOrder(layout)) {
      const active = getActiveTab(cell)?.id
      for (const tab of cell.tabs) {
        if (tab.kind !== 'lens') continue
        const id = tab.config.listDefinitionId
        const saved = id != null ? defs.find((d) => d.id === id) : undefined
        const def = listAsShown(saved, drafts)
        if (!saved || !def) continue
        const pick = picks[tab.id]
        const waiting = def.runtimeFilter != null && pick == null
        const predicate = def.runtimeFilter && pick && pick.length > 0
          ? applyRuntimeFilter(def.membership.predicate, def.runtimeFilter, pick)
          : def.membership.predicate
        const tasks = waiting ? [] : open.filter((t) => matches(predicate, t))
        lists.push(buildWallList({ tabId: tab.id, name: def.name, showing: active === tab.id, waiting }, tasks, toneOf))
      }
    }
    return lists
  }, [layout, defs, drafts, picks, todos, lookups, screen, screenActive, settings, today, urgentRange, staleAfterDays])
}
