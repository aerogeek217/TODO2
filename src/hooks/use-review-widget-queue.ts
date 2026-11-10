import { useMemo } from 'react'
import { emptyPredicate, type PersistedTodoItem, type TodoPredicate } from '../models'
import type { ReviewPick } from '../models/review'
import { queueOfSections } from '../services/review'
import { useFilterStore } from '../stores/filter-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import type { ReviewDivider } from '../stores/review-session'
import { useAppliedLens } from '../stores/screen-filter'
import { predicateToCriteria } from '../utils/filter-criteria'
import { matchesFilterWithLookups } from '../utils/filter-match'
import { withLens } from '../utils/lens'
import { sharedMemoByKey } from '../utils/shared-memo'
import { bySortOrder } from '../utils/sort-order'
import { useBuiltList, type LensProbe } from './use-built-list'
import { lensHidesWhere, useLensHidden, useStatsBase, type StatsBase } from './use-glance-data'
import { useEffectiveListDefinition } from './use-list-draft'
import { useWidgetScreenFilter } from './use-widget-lens'

/**
 * A Review widget's live queue (item 12): its pick's open tasks under the
 * screen filter (the chips, and the top bar's lens unless the widget's lens
 * switch ignores it) — a person's, a tag's or a status's, in `sortOrder` (as
 * their task dialog lists them); a list as a list tab shows it (its filter
 * as edited, its prompt — picked per this tab — and the screen filter, with
 * its group headers), the widget's lens switch standing for the list's.
 * Kept current as the tasks change: a task leaving the pick leaves the
 * queue. `hides` is the switch's `−N`: what the lens hides there.
 */
export interface ReviewWidgetQueue {
  ids: number[]
  dividers: ReviewDivider[]
  hides: number
  /** A list pick whose prompt has no pick yet (nothing to review until it is answered in a list tab). */
  pending: boolean
  /** The picked list was deleted. */
  missing: boolean
}

/** A person's, tag's or status's pick as the predicate their task dialog reads. */
export function reviewPickPredicate(pick: ReviewPick): TodoPredicate | null {
  switch (pick.kind) {
    case 'person': return { ...emptyPredicate(), personIds: [pick.id] }
    case 'tag': return { ...emptyPredicate(), tags: [pick.id] }
    case 'status': return { ...emptyPredicate(), statusIds: [pick.id] }
    case 'list': return null
  }
}

const NO_DIVIDERS: ReviewDivider[] = []
const NO_IDS: number[] = []

/** Each predicate's criteria, the same object while the predicate is. */
const criteriaMemo = sharedMemoByKey(function criteria(predicate: TodoPredicate) {
  return predicateToCriteria(predicate)
})

/** The open tasks of `shown` the pick's predicate keeps, in `sortOrder`. */
function pickedIds(base: StatsBase, predicate: TodoPredicate): number[] {
  const criteria = criteriaMemo(predicate)
  return base.shown
    .filter((t) => !t.isCompleted && matchesFilterWithLookups(criteria, t, base.lookups, base.ctx.today, base.markerSettings))
    .sort(bySortOrder)
    .map((t) => t.id)
}

export function useReviewWidgetQueue(tabId: string, pick: ReviewPick | undefined): ReviewWidgetQueue {
  const pickKind = pick?.kind
  const pickId = pick?.id
  const predicate = useMemo(
    () => (pickKind != null && pickId != null ? reviewPickPredicate({ kind: pickKind, id: pickId }) : null),
    [pickKind, pickId],
  )

  // A person, a tag, a status: the shared base's tasks (the widget's lens switch through its context).
  const base = useStatsBase()
  const entityIds = useMemo(() => (predicate ? pickedIds(base, predicate) : NO_IDS), [base, predicate])
  const hidden = useLensHidden()
  const entityHides = useMemo(() => {
    if (!predicate) return 0
    const criteria = criteriaMemo(predicate)
    return lensHidesWhere(hidden, (t: PersistedTodoItem, b) => !t.isCompleted && matchesFilterWithLookups(criteria, t, b.lookups, b.ctx.today, b.markerSettings))
  }, [hidden, predicate])

  // A list: built as a list tab of this tab's id shows it, the widget's lens switch for the list's.
  const listId = pickKind === 'list' ? pickId : undefined
  const definition = useEffectiveListDefinition(listId)
  const picks = useListWidgetStore((s) => s.picks[tabId])
  const screen = useWidgetScreenFilter()
  const chips = useFilterStore((s) => s.filters)
  const chipsActive = useFilterStore((s) => s.isActive)
  const lens = useAppliedLens()
  const probe = useMemo<LensProbe | undefined>(
    () => (lens && definition ? { chips: chipsActive ? chips : undefined, lensed: withLens(chips, lens) } : undefined),
    [lens, definition, chipsActive, chips],
  )
  const built = useBuiltList(definition, picks, screen.active ? screen.filters : undefined, undefined, probe)
  const grouped = definition != null && definition.grouping !== 'none'
  const listQueue = useMemo(
    () => (built.list ? queueOfSections(built.list.sections.map((s) => ({ key: s.key, label: s.label, todos: s.todos })), grouped) : null),
    [built.list, grouped],
  )

  return useMemo<ReviewWidgetQueue>(() => {
    if (pickKind !== 'list') return { ids: entityIds, dividers: NO_DIVIDERS, hides: entityHides, pending: false, missing: false }
    return {
      ids: listQueue?.ids ?? NO_IDS,
      dividers: listQueue?.dividers ?? NO_DIVIDERS,
      // The list's own −N, whether or not the widget applies the lens (as a list's switch counts it).
      hides: built.lensHides,
      pending: built.runtimeFilterPending,
      missing: definition == null,
    }
  }, [pickKind, entityIds, entityHides, listQueue, built.lensHides, built.runtimeFilterPending, definition])
}
