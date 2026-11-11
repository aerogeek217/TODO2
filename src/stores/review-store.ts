import { create } from 'zustand'
import { useTodoStore } from './todo-store'
import {
  EMPTY_SESSION,
  reviewSessionActions,
  type ReviewDivider,
  type ReviewSession,
} from './review-session'

export {
  allReviewed,
  followedUpCount,
  shownMark,
  unrecordedDraftIds,
  type ReviewDivider,
  type ReviewMark,
  type ReviewSort,
} from './review-session'

/**
 * The review deck's state (D26): a **frozen** queue stepped through one card
 * at a time — the tasks taken when it opened (a task deleted since is
 * pruned), re-taken only by an explicit toggle of its lens switch (item 10:
 * the source evaluated again with / without the top bar's lens). Its place,
 * sort, marks and typed text are a review session (`review-session`); UI
 * state only — never saved, so reopening starts fresh (no resume).
 * `services/review.openReview` starts one; the deck
 * (`components/overlays/ReviewDeck`) shows it while `open`.
 */

/**
 * Where a review came from: a list tab, a person, several people, a tag; a
 * Breakdown row (D26 P8) — a status, a priority group or another split's row
 * (`chart`); the top bar's screen filter, from its filtered-tasks panel (`screen`).
 */
export type ReviewSourceKind = 'list' | 'person' | 'people' | 'tag' | 'status' | 'priority' | 'chart' | 'screen'

export interface ReviewSource {
  kind: ReviewSourceKind
  /** The source's name in the header: the list's name, the person, `#tag`. */
  title: string
  /** One line saying what was taken. */
  description: string
}

/** A queue as a source gives it: its tasks in order, each once, and its group headers. */
export interface ReviewQueue {
  ids: readonly number[]
  dividers?: readonly ReviewDivider[]
}

/**
 * The top bar's lens on the deck (item 10): whether the queue was taken
 * without it (`ignored`), how many tasks of the source it hides there
 * (`hides`, the switch's `−N`, taken with the queue) and how to take the
 * queue again with or without it (`requery`).
 */
export interface ReviewLens {
  ignored: boolean
  hides: number
  /** The switch was used in this review: it stays shown while the lens does. */
  used: boolean
  requery: (ignoreLens: boolean) => ReviewQueue
}

/** What a review starts with. */
export interface ReviewStart {
  source: ReviewSource
  /** The tasks in queue order, each once. */
  ids: readonly number[]
  dividers?: readonly ReviewDivider[]
  /** Its lens switch; absent: a source that can't be taken again (no switch). */
  lens?: ReviewLens
}

interface ReviewState extends ReviewSession {
  open: boolean
  source: ReviewSource | null
  lens: ReviewLens | null

  /** Opens a review of `start` (replacing one that is open), on its first card, in queue order. */
  start: (start: ReviewStart) => void
  close: () => void
  setLens: (lens: ReviewLens | null) => void
  /** Drops the tasks not in `live` (deleted meanwhile), keeping the current card where it can. */
  prune: (live: ReadonlySet<number>) => void
}

const CLOSED = {
  ...EMPTY_SESSION,
  open: false,
  source: null,
  lens: null,
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i))

/**
 * `ids` and `order` without the tasks not in `live`, the dividers moved with
 * them (a divider whose group lost every task goes) and the current place
 * kept on the same task — or, that one gone, on the task after it in the
 * order shown.
 */
export function pruneQueue(
  queue: { ids: readonly number[]; dividers: readonly ReviewDivider[]; order: readonly number[]; index: number },
  live: ReadonlySet<number>,
): { ids: number[]; dividers: ReviewDivider[]; order: number[]; index: number } {
  const ids: number[] = []
  /** Each old place's new one: the count of kept tasks before it. */
  const before: number[] = []
  for (const id of queue.ids) {
    before.push(ids.length)
    if (live.has(id)) ids.push(id)
  }
  before.push(ids.length)
  const dividers: ReviewDivider[] = []
  queue.dividers.forEach((d, i) => {
    const end = queue.dividers[i + 1]?.index ?? queue.ids.length
    const from = before[d.index] ?? ids.length
    const to = before[end] ?? ids.length
    if (to > from) dividers.push({ index: from, label: d.label })
  })
  const order: number[] = []
  let index = 0
  queue.order.forEach((id, i) => {
    if (i === queue.index) index = order.length
    if (live.has(id)) order.push(id)
  })
  return { ids, dividers, order, index: order.length === 0 ? 0 : clamp(index, order.length) }
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...CLOSED,
  ...reviewSessionActions(set, get),

  start({ source, ids, dividers = [], lens }) {
    set({ ...CLOSED, open: true, source, ids: [...ids], dividers: [...dividers], order: [...ids], lens: lens ?? null })
  },

  close() {
    set(CLOSED)
  },

  setLens(lens) {
    set({ lens })
  },

  prune(live) {
    const s = get()
    if (!s.open || s.order.every((id) => live.has(id))) return
    set(pruneQueue(s, live))
  },
}))

// A task deleted while the review is open leaves the queue (a completed one stays).
useTodoStore.subscribe((state, prev) => {
  if (state.todos === prev.todos || !useReviewStore.getState().open) return
  useReviewStore.getState().prune(new Set(state.todos.map((t) => t.id)))
})
