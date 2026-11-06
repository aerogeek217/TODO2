import { useEffect, useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import type { PersistedListDefinition, TabBadgeRanges } from '../models/list-definition'
import type { LayoutTab } from '../models/workspace-layout'
import { applyRuntimeFilter } from '../services/build-list'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useScreenFilter } from '../stores/screen-filter'
import { useFilterStore } from '../stores/filter-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { createPredicateEvaluator, createScreenComposedEvaluator } from '../utils/filter-match'
import { countTabBadges, inTabBadgeRange, tabBadgeRangesFor, tabBadgeSummary, type TabBadgeCounts } from '../utils/tab-badges'
import { useFilterSettings } from './use-filter-settings'
import { useTodoNameLookups } from './use-todo-name-lookups'
import { useToday } from './use-today'

export interface TabBadge {
  counts: TabBadgeCounts
  /** The badge in words, a line per kind. */
  summary: string[]
}

const NO_BADGES: ReadonlyMap<string, TabBadge> = new Map()

/**
 * The badges of a strip's list tabs (by tab id; a tab with nothing to count
 * has none): the open tasks the tab shows on opening — the list as edited,
 * its prompt pick and the screen filter (without the lens for a list that
 * ignores it) — inside the list's ranges or the
 * app's. A list still waiting on its prompt has none.
 */
export function useTabBadges(tabs: readonly LayoutTab[]): ReadonlyMap<string, TabBadge> {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const picks = useListWidgetStore((s) => s.picks)
  const appRanges = useSettingsStore((s) => s.tabBadges)
  const todos = useTodoStore((s) => s.todos)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const { filters: screen, active: screenActive } = useScreenFilter()
  const chips = useFilterStore((s) => s.filters)
  const chipsActive = useFilterStore((s) => s.isActive)
  const settings = useFilterSettings()
  const today = useToday()
  const hasListTab = tabs.some((tab) => tab.kind === 'lens')
  // A list tab may be the only reader of the status updates and subtasks: its widget isn't mounted until it is opened.
  const lookups = useTodoNameLookups({ ensureLoaded: hasListTab })
  useEffect(() => {
    if (hasListTab && todos.length > 0) loadTagAssignments(todos.map((t) => t.id))
  }, [hasListTab, todos, loadTagAssignments])

  return useMemo(() => {
    if (!hasListTab) return NO_BADGES
    const matches = screenActive
      ? createScreenComposedEvaluator(screen, lookups, today, settings)
      : createPredicateEvaluator(lookups, today, settings)
    // A list that ignores the lens counts under the chips alone (as it shows).
    let chipsOnly: typeof matches | null = null
    const matcherFor = (def: PersistedListDefinition) => {
      if (def.ignoreLens !== true || !screen.lens) return matches
      chipsOnly ??= chipsActive
        ? createScreenComposedEvaluator(chips, lookups, today, settings)
        : createPredicateEvaluator(lookups, today, settings)
      return chipsOnly
    }
    // Only a task inside a badge range can count: each list's filter runs on
    // those alone (a few of every open task), once per set of ranges.
    const candidatesByRanges = new Map<string, PersistedTodoItem[]>()
    const candidatesFor = (ranges: TabBadgeRanges) => {
      const key = `${String(ranges.due)}|${String(ranges.followup)}`
      let candidates = candidatesByRanges.get(key)
      if (!candidates) {
        candidates = todos.filter((t) => inTabBadgeRange(t, ranges, today))
        candidatesByRanges.set(key, candidates)
      }
      return candidates
    }
    const badges = new Map<string, TabBadge>()
    for (const tab of tabs) {
      if (tab.kind !== 'lens') continue
      const id = tab.config.listDefinitionId
      if (id == null) continue
      const saved = defs.find((d) => d.id === id)
      if (!saved) continue
      const def = drafts[id] ?? saved
      const ranges = tabBadgeRangesFor(def.tabBadges, appRanges)
      if (ranges.due === 'off' && ranges.followup === 'off') continue
      const pick = picks[tab.id]
      if (def.runtimeFilter && pick == null) continue
      const predicate = def.runtimeFilter && pick && pick.length > 0
        ? applyRuntimeFilter(def.membership.predicate, def.runtimeFilter, pick)
        : def.membership.predicate
      const match = matcherFor(saved)
      const counts = countTabBadges(candidatesFor(ranges).filter((t) => match(predicate, t)), ranges, today)
      if (counts.due + counts.followup > 0) badges.set(tab.id, { counts, summary: tabBadgeSummary(counts, ranges) })
    }
    return badges
  }, [hasListTab, tabs, defs, drafts, picks, appRanges, todos, lookups, screen, screenActive, chips, chipsActive, settings, today])
}
