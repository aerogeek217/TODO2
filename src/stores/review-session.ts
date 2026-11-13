import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ReviewSort } from '../models/review'
import { registerModuleReset } from '../utils/module-reset'

/**
 * A review's place (D26): what each Review widget (item 12, one per tab,
 * live) steps through — the queue, the order the rail shows it in (its sort,
 * item 7), the current card, the marks and the text typed per task. The
 * rail, the card and the footer (`components/review/`) read and step one
 * through `ReviewSessionContext`. The order a sort gives is computed by
 * `services/review-queue` (a store doesn't sort tasks) and handed in with
 * `place`.
 */

/** A group header of the source list, as a divider in the queue before task `index`. */
export interface ReviewDivider {
  index: number
  label: string
}

/** A task's mark: followed up (today, here or elsewhere — `shownMark`), or skipped in this review. */
export type ReviewMark = 'done' | 'skipped'

// The rail's sort (item 7) is stored by a Review widget: its type lives with the models.
export { REVIEW_SORTS, isReviewSort, reviewSortLabel, type ReviewSort } from '../models/review'

/** What a session holds. */
export interface ReviewSessionData {
  /** The queue in its source's order, each task once. */
  ids: readonly number[]
  /** The source's group headers, over `ids`. */
  dividers: readonly ReviewDivider[]
  sort: ReviewSort
  /**
   * The tasks as the rail shows them: `ids` in the sort's order — and, in a
   * live queue, the current task while it stays after leaving the queue,
   * until the review moves on from it.
   */
  order: readonly number[]
  /** The current card's place in `order`. */
  index: number
  /**
   * Each task's mark in this review: `done` — followed up here (kept after
   * the task leaves the queue: the header's count) —, or `skipped`, which
   * takes a `done`'s place (a follow-up undone, the card then skipped).
   */
  marks: Readonly<Record<number, ReviewMark>>
  /** The Status update line's text per task (Back brings it back). */
  drafts: Readonly<Record<number, string>>
  /** The Next follow-up field's text per task while typed and not set (Back brings it back). */
  nextDrafts: Readonly<Record<number, string>>
  /**
   * The filter this review is of (`list-widget-store.reviewFilterKey`; null:
   * none): the place and the marks last as long as it — a different filter
   * starts a new review (`restart`), the same one sent again resumes.
   */
  filterKey: string | null
}

/** A new queue and its place, as `services/review-queue` computes them. */
export interface ReviewPlace {
  ids: readonly number[]
  dividers: readonly ReviewDivider[]
  sort: ReviewSort
  order: readonly number[]
  index: number
}

export interface ReviewSessionActions {
  /** Jumps to card `i` of `order` (clamped); moving off a current task no longer in the queue drops it from the rail. */
  go: (i: number) => void
  next: () => void
  back: () => void
  /** Skip: the current task marked skipped, then the next card. Writes nothing. */
  skip: () => void
  mark: (id: number, mark: ReviewMark) => void
  setDraft: (id: number, text: string) => void
  /** Sets (or with `null`, drops) the Next follow-up text typed for `id` and not set yet. */
  setNextDraft: (id: number, text: string | null) => void
  /** Puts in a new queue, sort, order and place (`services/review-queue`). */
  place: (place: ReviewPlace) => void
  /**
   * A new review, of filter `filterKey`: no queue yet, the first card, no
   * marks. The sort stays (view state), and so does the text typed per task
   * — the tasks are the same ones.
   */
  restart: (filterKey: string | null) => void
  /** Back to nothing but the sort (a data replace: every id may now name another task). */
  reset: () => void
}

export type ReviewSession = ReviewSessionData & ReviewSessionActions

/** What the review components read a session through (a widget's). */
export type ReviewSessionApi = Pick<StoreApi<ReviewSession>, 'getState' | 'getInitialState' | 'subscribe'>

export const EMPTY_SESSION: ReviewSessionData = {
  ids: [],
  dividers: [],
  sort: 'queue',
  order: [],
  index: 0,
  marks: {},
  drafts: {},
  nextDrafts: {},
  filterKey: null,
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i))

/** The task at the current card, if any. */
export function currentReviewId(s: Pick<ReviewSessionData, 'order' | 'index'>): number | undefined {
  return s.order[s.index]
}

/** The session's actions over its data, for a store whose state holds it. */
export function reviewSessionActions(
  set: (partial: Partial<ReviewSessionData>) => void,
  get: () => ReviewSessionData & Pick<ReviewSessionActions, 'go' | 'next' | 'mark'>,
): ReviewSessionActions {
  return {
    go(i) {
      const s = get()
      const n = s.order.length
      if (n === 0) return
      const to = clamp(i, n)
      const current = s.order[s.index]
      const target = s.order[to]
      // A current task kept after it left a live queue goes once the review moves on from it.
      if (current != null && to !== s.index && target != null && !s.ids.includes(current)) {
        const order = s.order.filter((id) => id !== current)
        set({ order, index: Math.max(0, order.indexOf(target)) })
        return
      }
      if (to !== s.index) set({ index: to })
    },

    next() {
      get().go(get().index + 1)
    },

    back() {
      get().go(get().index - 1)
    },

    skip() {
      const id = currentReviewId(get())
      if (id != null) get().mark(id, 'skipped')
      get().next()
    },

    mark(id, mark) {
      const marks = get().marks
      // A skip takes a `done`'s place too: `done` shows only while the task is followed up today
      // (`shownMark`), so a follow-up undone and the card then skipped shows its –.
      if (marks[id] === mark) return
      set({ marks: { ...marks, [id]: mark } })
    },

    setDraft(id, text) {
      const drafts = get().drafts
      if ((drafts[id] ?? '') === text) return
      const next = { ...drafts }
      if (text === '') delete next[id]
      else next[id] = text
      set({ drafts: next })
    },

    setNextDraft(id, text) {
      const nextDrafts = get().nextDrafts
      if (text === null ? !(id in nextDrafts) : nextDrafts[id] === text) return
      const next = { ...nextDrafts }
      if (text === null) delete next[id]
      else next[id] = text
      set({ nextDrafts: next })
    },

    place({ ids, dividers, sort, order, index }) {
      set({ ids: [...ids], dividers: [...dividers], sort, order: [...order], index: order.length === 0 ? 0 : clamp(index, order.length) })
    },

    restart(filterKey) {
      set({ ids: [], dividers: [], order: [], index: 0, marks: {}, filterKey })
    },

    reset() {
      set({ ...EMPTY_SESSION, sort: get().sort })
    },
  }
}

/** A session of its own (a Review widget's), starting on `initial`. */
export function createReviewSession(initial: Partial<ReviewSessionData> = {}): StoreApi<ReviewSession> {
  return createStore<ReviewSession>()((set, get) => ({
    ...EMPTY_SESSION,
    ...initial,
    ...reviewSessionActions(set, get),
  }))
}

// ── The widgets' sessions ───────────────────────────────────────────────────

let widgetSessions = new Map<string, StoreApi<ReviewSession>>()
registerModuleReset(() => { widgetSessions = new Map() })

/**
 * The session of Review widget `tabId` (item 12), made on first use from
 * `initial` (its view state) and kept while the app runs — the small face's
 * popover and the cell share it, and the typed text outlives a face change.
 */
export function reviewWidgetSession(tabId: string, initial?: () => Partial<ReviewSessionData>): StoreApi<ReviewSession> {
  let session = widgetSessions.get(tabId)
  if (!session) {
    session = createReviewSession(initial?.())
    widgetSessions.set(tabId, session)
  }
  return session
}

/**
 * Every widget's review back to nothing but its sort (a data replace: the
 * queue, the marks and the typed update text and Next dates are keyed by
 * task ids the replaced data may reuse for other tasks). In place — a
 * mounted widget keeps its session.
 */
export function clearReviewSessions(): void {
  for (const session of widgetSessions.values()) session.getState().reset()
}

/** Drops the sessions of the tabs not among `tabIds` (closed tabs: so they don't pile up over a session). */
export function keepReviewSessions(tabIds: ReadonlySet<string>): void {
  for (const tabId of [...widgetSessions.keys()]) if (!tabIds.has(tabId)) widgetSessions.delete(tabId)
}

// ── What the rail and the header read ──────────────────────────────────────

/**
 * Task `id`'s mark as the rail shows it (item 11): `done` — ✓ — while the
 * task's last follow-up is today (`followedUpToday`), whether it was
 * followed up in this review or anywhere else today (an undo of the
 * follow-up takes the ✓ away); else `skipped` — – — as marked here; else
 * none.
 */
export function shownMark(
  marks: Readonly<Record<number, ReviewMark>>,
  id: number,
  followedUpToday: (id: number) => boolean,
): ReviewMark | undefined {
  if (followedUpToday(id)) return 'done'
  return marks[id] === 'skipped' ? 'skipped' : undefined
}

/**
 * The header's `N followed up`: how many tasks of the queue are followed up
 * today (its ✓ rows), wherever that happened — and the ones followed up in
 * this review (`done`) that left the queue since (a review of follow-ups
 * due: each follow-up takes its task out of the filter), while still
 * followed up today (an undo takes it back).
 */
export function followedUpCount(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): number {
  const counted = new Set(ids)
  for (const [id, mark] of Object.entries(marks)) if (mark === 'done') counted.add(Number(id))
  let n = 0
  for (const id of counted) if (followedUpToday(id)) n += 1
  return n
}

/** Every task of the review has a mark as shown (followed up today or skipped). */
export function allReviewed(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): boolean {
  return ids.length > 0 && ids.every((id) => shownMark(marks, id, followedUpToday) != null)
}
