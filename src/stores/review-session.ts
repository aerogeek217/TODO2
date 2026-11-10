import { createStore, type StoreApi } from 'zustand/vanilla'
import { registerModuleReset } from '../utils/module-reset'

/**
 * A review's place (D26): what the review deck (`review-store`, one, frozen)
 * and each Review widget (item 12, one per tab, live) step through — the
 * queue, the order the rail shows it in (its sort, item 7), the current card,
 * the marks and the text typed per task. The rail, the card and the footer
 * (`components/review/`) read and step one through `ReviewSessionContext`,
 * whichever hosts it. The order a sort gives is computed by
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

/**
 * The rail's sort (item 7): the queue's own order (`queue`, the default —
 * its group dividers show only then), or by due date, next follow-up, last
 * follow-up, priority or title (`services/review-queue.reviewOrder`).
 */
export type ReviewSort = 'queue' | 'due' | 'next' | 'last' | 'priority' | 'title'

/** The sorts in menu order, with their names. */
export const REVIEW_SORTS: ReadonlyArray<{ sort: ReviewSort; label: string }> = [
  { sort: 'queue', label: 'Queue order' },
  { sort: 'due', label: 'Due' },
  { sort: 'next', label: 'Next follow-up' },
  { sort: 'last', label: 'Last follow-up' },
  { sort: 'priority', label: 'Priority' },
  { sort: 'title', label: 'Title' },
]

export function isReviewSort(v: unknown): v is ReviewSort {
  return typeof v === 'string' && REVIEW_SORTS.some((s) => s.sort === v)
}

/** A sort's name (`Queue order`, `Due`, …). */
export function reviewSortLabel(sort: ReviewSort): string {
  return REVIEW_SORTS.find((s) => s.sort === sort)?.label ?? 'Queue order'
}

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
  marks: Readonly<Record<number, ReviewMark>>
  /** The Status update line's text per task (Back brings it back). */
  drafts: Readonly<Record<number, string>>
  /** The Next follow-up field's text per task while typed and not set (Back brings it back). */
  nextDrafts: Readonly<Record<number, string>>
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
}

export type ReviewSession = ReviewSessionData & ReviewSessionActions

/** What the review components read a session through (the deck's store, or a widget's). */
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
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i))

/** The task at the current card, if any. */
export function currentReviewId(s: Pick<ReviewSessionData, 'order' | 'index'>): number | undefined {
  return s.order[s.index]
}

/**
 * The session's actions over its data, for a store whose state holds it
 * (the deck's adds its own fields; a widget's is just this).
 */
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
      if (marks[id] === mark || (mark === 'skipped' && marks[id] === 'done')) return
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

// ── What the rail and the header read ──────────────────────────────────────

/**
 * The tasks of the review whose field (`drafts`: the Status update line's,
 * `nextDrafts`: the Next follow-up field's) holds text not recorded or set
 * yet (only spaces count as none), in queue order.
 */
export function unrecordedDraftIds(drafts: Readonly<Record<number, string>>, ids: readonly number[]): number[] {
  return ids.filter((id) => (drafts[id] ?? '').trim() !== '')
}

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

/** The header's `N followed up`: how many tasks of the queue are followed up today (its ✓ rows), wherever that happened. */
export function followedUpCount(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): number {
  return ids.filter((id) => shownMark(marks, id, followedUpToday) === 'done').length
}

/** Every task of the review has a mark as shown (followed up today or skipped). */
export function allReviewed(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): boolean {
  return ids.length > 0 && ids.every((id) => shownMark(marks, id, followedUpToday) != null)
}
