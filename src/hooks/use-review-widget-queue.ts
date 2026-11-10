import { useEffect, useMemo } from 'react'
import { emptyPredicate, type PersistedTodoItem, type TodoPredicate } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import type { ReviewBy } from '../models/review'
import { applyRuntimeFilter, buildList } from '../services/build-list'
import { queueOfSections } from '../services/review'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { useListOrderStore } from '../stores/list-order-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { usePersonStore } from '../stores/person-store'
import type { ReviewDivider } from '../stores/review-session'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { predicateToCriteria } from '../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator, matchesFilterWithLookups } from '../utils/filter-match'
import { sharedMemoByKey } from '../utils/shared-memo'
import { bySortOrder } from '../utils/sort-order'
import { layoutTabs } from '../utils/workspace-layout-queries'
import { lensHidesWhere, useLensHidden, useStatsBase, type StatsBase } from './use-glance-data'
import { useWidgetScreenFilter } from './use-widget-lens'

/**
 * A Review widget's live queue (item 12, board BM): the open tasks of its
 * picks — one or more of its kind, OR-combined — under the screen filter
 * (the chips, and the top bar's lens unless the widget's lens switch ignores
 * it). People, tags, statuses: a task of any picked one, in `sortOrder` (as
 * their task dialog lists them). Lists: the union of what the picked lists
 * show as a list tab would — each its filter as edited and the screen
 * filter, the widget's lens switch standing for the list's own; a list with
 * a prompt takes the pick a list tab of this layout showing it has (none
 * yet: it waits, `waiting`) —, each task once, at its first place; one list
 * keeps its group headers as dividers, several are divided by list.
 * Kept current as the tasks change: a task leaving the picks leaves the
 * queue. `hides` is the switch's `−N`: what the lens hides there.
 */
export interface ReviewWidgetQueue {
  ids: number[]
  dividers: ReviewDivider[]
  hides: number
  /** The picked lists (their names) whose prompt has no pick yet: nothing of theirs to review until it is answered in a list tab. */
  waiting: string[]
}

/** People's, tags' or statuses' picks as the predicate their task dialog reads (any of `ids`); none for lists. */
export function reviewPicksPredicate(by: ReviewBy, ids: readonly number[]): TodoPredicate | null {
  switch (by) {
    case 'person': return { ...emptyPredicate(), personIds: [...ids] }
    case 'tag': return { ...emptyPredicate(), tags: [...ids] }
    case 'status': return { ...emptyPredicate(), statusIds: [...ids] }
    case 'list': return null
  }
}

const NO_DIVIDERS: ReviewDivider[] = []
const NO_IDS: number[] = []
const NO_NAMES: string[] = []
const NO_LISTS: PersistedListDefinition[] = []
const NO_PROMPT_PICKS: ReadonlyMap<number, number[]> = new Map()
const NO_QUEUE: ReviewWidgetQueue = { ids: NO_IDS, dividers: NO_DIVIDERS, hides: 0, waiting: NO_NAMES }

/** Each predicate's criteria, the same object while the predicate is. */
const criteriaMemo = sharedMemoByKey(function criteria(predicate: TodoPredicate) {
  return predicateToCriteria(predicate)
})

/** The open tasks of `shown` the picks' predicate keeps, in `sortOrder`. */
function pickedIds(base: StatsBase, predicate: TodoPredicate): number[] {
  const criteria = criteriaMemo(predicate)
  return base.shown
    .filter((t) => !t.isCompleted && matchesFilterWithLookups(criteria, t, base.lookups, base.ctx.today, base.markerSettings))
    .sort(bySortOrder)
    .map((t) => t.id)
}

/** The picked lists as built: their queue, the ones waiting on a prompt, and each built list's filter with its prompt pick merged in. */
interface ListsQueue {
  ids: number[]
  dividers: ReviewDivider[]
  waiting: string[]
  merged: TodoPredicate[]
}

/**
 * The queue of `ids` — the picks, ids of `by`'s kind (a list's id that
 * names no list any more is ignored); none is an empty queue. Pass the same
 * array while the picks are the same (the store's).
 */
export function useReviewWidgetQueue(by: ReviewBy, ids: readonly number[]): ReviewWidgetQueue {
  const predicate = useMemo(() => (ids.length > 0 ? reviewPicksPredicate(by, ids) : null), [by, ids])

  // People, tags, statuses: the shared base's tasks (the widget's lens switch through its context).
  const base = useStatsBase()
  const entityIds = useMemo(() => (predicate ? pickedIds(base, predicate) : NO_IDS), [base, predicate])
  const hidden = useLensHidden()
  const entityHides = useMemo(() => {
    if (!predicate) return 0
    const criteria = criteriaMemo(predicate)
    return lensHidesWhere(hidden, (t: PersistedTodoItem, b) => !t.isCompleted && matchesFilterWithLookups(criteria, t, b.lookups, b.ctx.today, b.markerSettings))
  }, [hidden, predicate])

  // Lists: each built as a list tab shows it, the widget's lens switch for the list's.
  const byList = by === 'list'
  const saved = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const lists = useMemo(() => {
    if (!byList || ids.length === 0) return NO_LISTS
    return ids.flatMap((id) => {
      const def = saved.find((d) => d.id === id)
      return def ? [drafts[id] ?? def] : []
    })
  }, [byList, ids, saved, drafts])
  const listing = lists.length > 0
  useEffect(() => {
    if (listing) void useListOrderStore.getState().ensureLoaded()
  }, [listing])
  const ranks = useListOrderStore((s) => s.ranks)
  // The registries a build reads (the same objects the shared base holds).
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const screenActive = useWidgetScreenFilter().active
  // A list with a prompt: the pick of the first list tab of this layout that shows it and has one.
  const working = useWorkspaceStore((s) => s.working)
  const tabPicks = useListWidgetStore((s) => s.picks)
  const promptPicks = useMemo(() => {
    if (!working || !lists.some((d) => d.runtimeFilter != null)) return NO_PROMPT_PICKS
    const byListId = new Map<number, number[]>()
    for (const tab of layoutTabs(working)) {
      if (tab.kind !== 'lens' || tab.config.listDefinitionId == null) continue
      const picked = tabPicks[tab.id]
      if (picked && !byListId.has(tab.config.listDefinitionId)) byListId.set(tab.config.listDefinitionId, picked)
    }
    return byListId
  }, [working, lists, tabPicks])

  const listsQueue = useMemo<ListsQueue | null>(() => {
    if (!listing) return null
    const { today, weekStartsOn, urgentRange } = base.ctx
    const screen = screenActive ? base.screen : undefined
    const evalPredicate = screen
      ? createScreenComposedEvaluator(screen, base.lookups, today, base.markerSettings)
      : createPredicateEvaluator(base.lookups, today, base.markerSettings)
    const built: Array<{ def: PersistedListDefinition; sections: ReturnType<typeof buildList>['sections'] }> = []
    const waiting: string[] = []
    const merged: TodoPredicate[] = []
    for (const def of lists) {
      const prompt = def.runtimeFilter ? promptPicks.get(def.id) : undefined
      const list = buildList(def, base.todos, {
        today,
        weekStartsOn,
        evalPredicate,
        screenFilter: screen,
        assignedTagsMap,
        assignedPeopleMap,
        people,
        statuses,
        runtimeFilterValue: prompt,
        ranks: ranks.get(def.id),
        urgentRange,
      })
      if (list.runtimeFilterUnset) {
        waiting.push(def.name)
        continue
      }
      built.push({ def, sections: list.sections })
      const own = def.membership.predicate
      merged.push(def.runtimeFilter && prompt && prompt.length > 0 ? applyRuntimeFilter(own, def.runtimeFilter, prompt) : own)
    }
    const [only] = built
    // One list: its group headers; several: each list a group, a task at its first list.
    const queue = only && built.length === 1
      ? queueOfSections(only.sections.map((s) => ({ key: s.key, label: s.label, todos: s.todos })), only.def.grouping !== 'none')
      : queueOfSections(built.map(({ def, sections }) => ({ key: String(def.id), label: def.name, todos: sections.flatMap((s) => s.todos) })), true)
    return { ...queue, waiting, merged }
  }, [listing, lists, promptPicks, base, screenActive, people, assignedPeopleMap, assignedTagsMap, statuses, ranks])

  // The lists' −N: their open tasks the lens hides, each once — whether or not the widget applies the lens (as a list's switch counts it).
  const listsHide = useMemo(() => {
    if (!listsQueue || !hidden) return 0
    const { base: b } = hidden
    const matches = createPredicateEvaluator(b.lookups, b.ctx.today, b.markerSettings)
    return lensHidesWhere(hidden, (t) => !t.isCompleted && listsQueue.merged.some((p) => matches(p, t)))
  }, [hidden, listsQueue])

  return useMemo<ReviewWidgetQueue>(() => {
    if (ids.length === 0) return NO_QUEUE
    if (!byList) return { ids: entityIds, dividers: NO_DIVIDERS, hides: entityHides, waiting: NO_NAMES }
    return {
      ids: listsQueue?.ids ?? NO_IDS,
      dividers: listsQueue?.dividers ?? NO_DIVIDERS,
      hides: listsHide,
      waiting: listsQueue?.waiting ?? NO_NAMES,
    }
  }, [ids, byList, entityIds, entityHides, listsQueue, listsHide])
}
