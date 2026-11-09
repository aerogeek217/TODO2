import { useMemo } from 'react'
import type { PersistedTodoItem, TodoEvent } from '../models'
import { emptyPredicate } from '../models/filter-predicate'
import type { NumberConfig } from '../models/glance-widgets'
import { DEFAULT_NUMBER_OLDEST_BY, type NumberGroupItem, type NumberOldestBy } from '../models/number-shapes'
import type { LensTab } from '../models/workspace-layout'
import { filterHistory, historyExactness } from '../services/stats/filter-history'
import { numberHistoryDays } from '../services/stats/number-count'
import { oldestOf, shareOf, shareSeries, type NumberOldest, type NumberShare } from '../services/stats/number-shapes'
import { statsFilter } from '../services/stats/stats-context'
import type { Section } from '../services/list-sections'
import { listedLists } from '../models/list-definition'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { bySortOrder } from '../utils/sort-order'
import { useSettingsStore } from '../stores/settings-store'
import type { TodoNameLookups } from '../utils/filter'
import type { FilterCriteria } from '../utils/filter-criteria'
import type { FilterSettings } from '../utils/filter-match'
import { sharedMemo, sharedMemoByKey } from '../utils/shared-memo'
import { useBuiltList } from './use-built-list'
import { lookupsFor, numberCountOf, type NumberCount, type NumberHistory, type StatsBase } from './use-glance-data'
import { useEffectiveListDefinition } from './use-list-draft'
import { useListScreenFilter } from './use-list-screen-filter'
import { useTabBadges, type TabBadge } from './use-tab-badges'
import { useTrendEvents } from './use-trend-events'

/**
 * A Number's shapes' data (D26 P6, board Y), over the count's parts
 * (`use-glance-data`): each a shared memo keyed by the Number's own objects,
 * so any number of them on screen compute once and never evict each other.
 * The statistics are the pure `services/stats/number-shapes`.
 */

type Tasks = readonly PersistedTodoItem[]

/** The `of` of a share that names none: every open task (one object, so its count is shared). */
const EVERY_OPEN = emptyPredicate()

// ── Share of… ───────────────────────────────────────────────────────────────

export interface NumberShareData {
  /** Its own filter's count. */
  count: NumberCount
  /** The second filter's count: the whole. */
  whole: NumberCount
  share: NumberShare
}

const shareMemo = sharedMemoByKey(function share(count: NumberCount, wholeIds: number[]): NumberShare {
  return shareOf(count.ids.shown, wholeIds)
})

/** A share Number's parts: its count, the whole's (its `of`, every open task by default) and the share, under the same screen filter. */
export function useNumberShare(base: StatsBase, config: Pick<NumberConfig, 'filter' | 'of' | 'ignoreLens'>): NumberShareData {
  const count = numberCountOf(base, config)
  const whole = numberCountOf(base, { filter: config.of ?? EVERY_OPEN, ignoreLens: config.ignoreLens })
  const share = shareMemo(count, whole.ids.shown)
  return useMemo(() => ({ count, whole, share }), [count, whole, share])
}

const historyDaysMemo = sharedMemo(function shapeHistoryDays(todayMs: number) {
  return numberHistoryDays(new Date(todayMs))
})

const shareHistoryMemo = sharedMemoByKey(function shareHistory(
  filter: FilterCriteria,
  of: FilterCriteria,
  screen: FilterCriteria,
  todos: Tasks,
  events: readonly TodoEvent[],
  days: Date[],
  lookups: TodoNameLookups,
  settings: FilterSettings,
  historyLogSince: Date | null,
): NumberHistory {
  const shown = statsFilter(screen)
  const opts = { lookups, settings }
  const parts = filterHistory([shown, of, filter], todos, events, days, opts)
  const wholes = filterHistory([shown, of], todos, events, days, opts)
  return {
    days,
    series: shareSeries(parts, wholes),
    exactness: historyExactness([shown, of, filter], days[0] ?? new Date(0), historyLogSince),
  }
})

/** A share's 14-day line: each day's percent, both filters replayed (`filter-history`); `null` until the history is read. */
export function useShareHistory(base: StatsBase, data: NumberShareData): NumberHistory | null {
  const events = useTrendEvents('history')
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  const days = historyDaysMemo(base.ctx.today.getTime())
  if (!events) return null
  const { count, whole } = data
  const lookups = lookupsFor(base, count.screen, count.filter, whole.filter)
  return shareHistoryMemo(count.filter, whole.filter, count.screen, base.todos, events, days, lookups, base.markerSettings, historyLogSince)
}

// ── Oldest ──────────────────────────────────────────────────────────────────

const oldestMemo = sharedMemoByKey(function oldest(count: NumberCount, todoById: ReadonlyMap<number, PersistedTodoItem>, by: NumberOldestBy, today: Date) {
  return oldestOf(count.ids.shown, todoById, by, today)
})

/** An Oldest Number's parts: its count and the ages of its tasks by its date. */
export function useNumberOldest(base: StatsBase, config: Pick<NumberConfig, 'filter' | 'ignoreLens' | 'oldestBy'>): { count: NumberCount; oldest: NumberOldest } {
  const count = numberCountOf(base, config)
  const oldest = oldestMemo(count, base.todoById, config.oldestBy ?? DEFAULT_NUMBER_OLDEST_BY, base.ctx.today)
  return useMemo(() => ({ count, oldest }), [count, oldest])
}

// ── Group ───────────────────────────────────────────────────────────────────

const NO_ITEMS: readonly NumberGroupItem[] = []

const groupMemo = sharedMemoByKey(function group(_items: readonly NumberGroupItem[], ...counts: NumberCount[]): NumberCount[] {
  return counts
})

/** A group Number's counts: each item's filter under the screen filter (the group's lens choice for every one), in item order. */
export function useNumberGroup(base: StatsBase, config: Pick<NumberConfig, 'items' | 'ignoreLens'>): NumberCount[] {
  const items = config.items ?? NO_ITEMS
  const counts = items.map((item) => numberCountOf(base, { filter: item.filter, ignoreLens: config.ignoreLens }))
  return groupMemo(items, ...counts)
}

// ── Follow a list ───────────────────────────────────────────────────────────

/** The open layout's first list (Follow a list starts on it in the editor); none without one. */
export function useLayoutFirstListId(): number | undefined {
  const layoutId = useWorkspaceStore((s) => s.working?.id)
  return useListDefinitionStore((s) => listedLists([...s.listDefinitions].sort(bySortOrder), layoutId)[0]?.id)
}

export interface NumberListData {
  /** The list as edited (its draft); absent when none is picked or it was deleted. */
  name: string | null
  /** The list as a list tab of the Number's id (its prompt picks are the Number's), for the popover; absent with no list. */
  lensTab: LensTab | null
  /** The tasks it shows, each once, in order. */
  ids: number[]
  /** What its filter (and prompt) keeps before the screen filter — the `of N`. */
  baseCount: number
  /** Its prompt is still unanswered. */
  pending: boolean
  /** Its tab badge (due / follow-up counts). */
  badge: TabBadge | undefined
}

const NO_SECTIONS: readonly Section[] = []

const listIdsMemo = sharedMemoByKey(function listIds(sections: readonly Section[]): number[] {
  const seen = new Set<number>()
  for (const s of sections) for (const t of s.todos) seen.add(t.id)
  return [...seen]
})

/**
 * What the list a Number follows shows (`useBuiltList`): its filter as
 * edited, its own lens switch, its prompt (picked per the Number's tab, in
 * the list's popover) and the screen filter; and its tab badge.
 */
export function useNumberList(tabId: string, listId: number | undefined): NumberListData {
  const definition = useEffectiveListDefinition(listId)
  const picks = useListWidgetStore((s) => s.picks[tabId])
  const screenFor = useListScreenFilter(definition?.id)
  const built = useBuiltList(definition, picks, screenFor.filters, undefined, screenFor.probe)
  const defId = definition?.id
  const lensTab = useMemo<LensTab | null>(
    () => (defId != null ? { id: tabId, kind: 'lens', config: { listDefinitionId: defId } } : null),
    [tabId, defId],
  )
  const tabs = useMemo(() => (lensTab ? [lensTab] : []), [lensTab])
  const badge = useTabBadges(tabs).get(tabId)
  const sections = built.list?.sections ?? NO_SECTIONS
  const ids = listIdsMemo(sections)
  return {
    name: definition ? definition.name : null,
    lensTab,
    ids,
    baseCount: built.baseCount,
    pending: built.runtimeFilterPending,
    badge,
  }
}
