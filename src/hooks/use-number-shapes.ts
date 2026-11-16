import { useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import { emptyPredicate } from '../models/filter-predicate'
import type { NumberConfig } from '../models/glance-widgets'
import { DEFAULT_NUMBER_OLDEST_BY, type NumberGroupItem, type NumberOldestBy } from '../models/number-shapes'
import type { ListTab } from '../models/workspace-layout'
import { countReplayed, historyExactness, type TaskReplays } from '../services/stats/filter-history'
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
import { historyReplayMemo, lineBeforeWrite, lookupsFor, numberCountOf, useOffRender, type NumberCount, type NumberHistory, type StatsBase } from './use-glance-data'
import { useEffectiveListDefinition } from './use-list-draft'
import { useActiveScreenFilter } from '../stores/screen-filter'
import { useTabBadges, type TabBadge } from './use-tab-badges'
import { useTrendEvents } from './use-trend-events'
import { useHeldLists } from './use-held-lists'

/**
 * A Number's shapes' data (D26 P6, board Y), over the count's parts
 * (`use-glance-data`): each a shared memo keyed by the Number's own objects,
 * so any number of them on screen compute once and never evict each other.
 * The statistics are the pure `services/stats/number-shapes`.
 */

/** The `of` of a share that names none: every open task (one object, so its count is shared). */
const EVERY_OPEN = emptyPredicate()

// ── Share of… ───────────────────────────────────────────────────────────────

interface NumberShareData {
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
export function useNumberShare(base: StatsBase, config: Pick<NumberConfig, 'filter' | 'of'>): NumberShareData {
  const count = numberCountOf(base, config)
  const whole = numberCountOf(base, { filter: config.of ?? EVERY_OPEN })
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
  replays: TaskReplays,
  days: Date[],
  lookups: TodoNameLookups,
  settings: FilterSettings,
  historyLogSince: Date | null,
): NumberHistory {
  const shown = statsFilter(screen)
  const opts = { lookups, settings }
  const parts = countReplayed([shown, of, filter], replays, opts)
  const wholes = countReplayed([shown, of], replays, opts)
  return {
    days,
    series: shareSeries(parts, wholes),
    exactness: historyExactness([shown, of, filter], days[0] ?? new Date(0), historyLogSince),
  }
}, undefined, 2)

/**
 * A share's 14-day line: each day's percent, both filters counted over the
 * one replay every Number shares (`use-glance-data.historyReplayMemo`);
 * `null` until the history is read. After a change it shows the line it had
 * until the new one is computed, a moment later (`useOffRender`).
 */
export function useShareHistory(base: StatsBase, data: NumberShareData): NumberHistory | null {
  const events = useTrendEvents('history')
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  const days = historyDaysMemo(base.ctx.today.getTime())
  const { count, whole } = data
  const lookups = lookupsFor(base, count.screen, count.filter, whole.filter)
  const { todos, markerSettings } = base
  const replayed = events ? historyReplayMemo.peek(todos, events, days, lookups.assignedPeopleMap, lookups.assignedTagsMap) : undefined
  const now = replayed ? shareHistoryMemo.peek(count.filter, whole.filter, count.screen, replayed, days, lookups, markerSettings, historyLogSince) : undefined
  // The line it had while only a write or the screen filter came between (the same whole, day and settings).
  const kept = events ? shareHistoryMemo.last(count.filter) : undefined
  const last = kept && kept.deps[0] === whole.filter && lineBeforeWrite(kept.deps.slice(3), [days, lookups, markerSettings, historyLogSince]) ? kept.value : undefined
  return useOffRender<NumberHistory | null>(now, last, () => {
    if (!events) return null
    const replays = historyReplayMemo(todos, events, days, lookups.assignedPeopleMap, lookups.assignedTagsMap)
    return shareHistoryMemo(count.filter, whole.filter, count.screen, replays, days, lookups, markerSettings, historyLogSince)
  })
}

// ── Oldest ──────────────────────────────────────────────────────────────────

const oldestMemo = sharedMemoByKey(function oldest(count: NumberCount, todoById: ReadonlyMap<number, PersistedTodoItem>, by: NumberOldestBy, today: Date) {
  return oldestOf(count.ids.shown, todoById, by, today)
})

/** An Oldest Number's parts: its count and the ages of its tasks by its date. */
export function useNumberOldest(base: StatsBase, config: Pick<NumberConfig, 'filter' | 'oldestBy'>): { count: NumberCount; oldest: NumberOldest } {
  const count = numberCountOf(base, config)
  const oldest = oldestMemo(count, base.todoById, config.oldestBy ?? DEFAULT_NUMBER_OLDEST_BY, base.ctx.today)
  return useMemo(() => ({ count, oldest }), [count, oldest])
}

// ── Group ───────────────────────────────────────────────────────────────────

const NO_ITEMS: readonly NumberGroupItem[] = []

const groupMemo = sharedMemoByKey(function group(_items: readonly NumberGroupItem[], ...counts: NumberCount[]): NumberCount[] {
  return counts
})

/** A group Number's counts: each item's filter under the screen filter, in item order. */
export function useNumberGroup(base: StatsBase, config: Pick<NumberConfig, 'items'>): NumberCount[] {
  const items = config.items ?? NO_ITEMS
  const counts = items.map((item) => numberCountOf(base, { filter: item.filter }))
  return groupMemo(items, ...counts)
}

// ── Follow a list ───────────────────────────────────────────────────────────

/** The open layout's first list (Follow a list starts on it in the editor); none without one. A list held for deletion (`useHeldLists`) isn't one. */
export function useLayoutFirstListId(): number | undefined {
  const layoutId = useWorkspaceStore((s) => s.working?.id)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const held = useHeldLists()
  return useMemo(() => listedLists([...defs].sort(bySortOrder), layoutId).find((d) => !held.has(d.id))?.id, [defs, layoutId, held])
}

interface NumberListData {
  /** The list as edited (its draft); absent when none is picked or it was deleted. */
  name: string | null
  /** The list as a list tab of the Number's id (its prompt picks are the Number's), for the popover; absent with no list. */
  listTab: ListTab | null
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
 * edited, its prompt (picked per the Number's tab, in the list's popover)
 * and the screen filter; and its tab badge.
 */
export function useNumberList(tabId: string, listId: number | undefined): NumberListData {
  const definition = useEffectiveListDefinition(listId)
  const picks = useListWidgetStore((s) => s.picks[tabId])
  const screen = useActiveScreenFilter()
  const built = useBuiltList(definition, picks, screen)
  const defId = definition?.id
  const listTab = useMemo<ListTab | null>(
    () => (defId != null ? { id: tabId, kind: 'lens', config: { listDefinitionId: defId } } : null),
    [tabId, defId],
  )
  const tabs = useMemo(() => (listTab ? [listTab] : []), [listTab])
  const badge = useTabBadges(tabs).get(tabId)
  const sections = built.list?.sections ?? NO_SECTIONS
  const ids = listIdsMemo(sections)
  return {
    name: definition ? definition.name : null,
    listTab,
    ids,
    baseCount: built.baseCount,
    pending: built.runtimeFilterPending,
    badge,
  }
}
