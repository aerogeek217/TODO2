import { create } from 'zustand'
import { useTodoStore } from './todo-store'

/**
 * The review deck's state (D26): a frozen set of tasks stepped through one
 * card at a time. UI state only — never saved, so reopening starts fresh
 * (no resume). `services/review.openReview` starts one; the deck
 * (`components/overlays/ReviewDeck`) shows it while `open`.
 */

/** Where a review came from: a list tab, a person, several people, a tag; a Breakdown row (D26 P8) — a status, a priority group or another split's row (`chart`). */
export type ReviewSourceKind = 'list' | 'person' | 'people' | 'tag' | 'status' | 'priority' | 'chart'

export interface ReviewSource {
  kind: ReviewSourceKind
  /** The source's name in the header: the list's name, the person, `#tag`. */
  title: string
  /** One line saying what was taken. */
  description: string
}

/** A group header of the source list, as a divider in the queue before task `index`. */
export interface ReviewDivider {
  index: number
  label: string
}

/** A task's mark in this review: followed up here, or skipped. */
export type ReviewMark = 'done' | 'skipped'

/** What a review starts with. */
export interface ReviewStart {
  source: ReviewSource
  /** The tasks in queue order, each once. */
  ids: readonly number[]
  dividers?: readonly ReviewDivider[]
}

interface ReviewState {
  open: boolean
  source: ReviewSource | null
  /** The queue, fixed when the review starts (a task deleted since is pruned). */
  ids: readonly number[]
  dividers: readonly ReviewDivider[]
  /** The current card's place in `ids`. */
  index: number
  marks: Readonly<Record<number, ReviewMark>>
  /** The Status update field's text per task, kept while the review is open (Back brings it back). */
  drafts: Readonly<Record<number, string>>
  /** The Next follow-up field's text per task while it is typed and not set yet (Back brings it back). */
  nextDrafts: Readonly<Record<number, string>>

  /** Opens a review of `start` (replacing one that is open), on its first card. */
  start: (start: ReviewStart) => void
  close: () => void
  /** Jumps to card `i` (clamped). */
  go: (i: number) => void
  next: () => void
  back: () => void
  /** Marks task `id`; a task followed up stays `done` (a later Skip doesn't take it back). */
  mark: (id: number, mark: ReviewMark) => void
  setDraft: (id: number, text: string) => void
  /** Sets (or with `null`, drops) the Next follow-up text typed for `id` and not set yet. */
  setNextDraft: (id: number, text: string | null) => void
  /** Drops the tasks not in `live` (deleted meanwhile), keeping the current card where it can. */
  prune: (live: ReadonlySet<number>) => void
}

const CLOSED = {
  open: false,
  source: null,
  ids: [] as readonly number[],
  dividers: [] as readonly ReviewDivider[],
  index: 0,
  marks: {} as Readonly<Record<number, ReviewMark>>,
  drafts: {} as Readonly<Record<number, string>>,
  nextDrafts: {} as Readonly<Record<number, string>>,
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i))

/**
 * `ids` without the ones not in `live`, its dividers moved with them (a
 * divider whose group lost every task goes) and the current place kept on
 * the same task — or, that one gone, on the task after it.
 */
export function pruneQueue(
  queue: { ids: readonly number[]; dividers: readonly ReviewDivider[]; index: number },
  live: ReadonlySet<number>,
): { ids: number[]; dividers: ReviewDivider[]; index: number } {
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
  const index = ids.length === 0 ? 0 : clamp(before[queue.index] ?? 0, ids.length)
  return { ids, dividers, index }
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...CLOSED,

  start({ source, ids, dividers = [] }) {
    set({ ...CLOSED, open: true, source, ids: [...ids], dividers: [...dividers] })
  },

  close() {
    set(CLOSED)
  },

  go(i) {
    const n = get().ids.length
    if (n > 0) set({ index: clamp(i, n) })
  },

  next() {
    get().go(get().index + 1)
  },

  back() {
    get().go(get().index - 1)
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

  prune(live) {
    const s = get()
    if (!s.open || s.ids.every((id) => live.has(id))) return
    set(pruneQueue(s, live))
  },
}))

// A task deleted while the review is open leaves the queue (a completed one stays).
useTodoStore.subscribe((state, prev) => {
  if (state.todos === prev.todos || !useReviewStore.getState().open) return
  useReviewStore.getState().prune(new Set(state.todos.map((t) => t.id)))
})

/**
 * The tasks of the review whose field (`drafts`: the Status update line's,
 * `nextDrafts`: the Next follow-up field's) holds text not recorded or set
 * yet (only spaces count as none), in queue order.
 */
export function unrecordedDraftIds(drafts: Readonly<Record<number, string>>, ids: readonly number[]): number[] {
  return ids.filter((id) => (drafts[id] ?? '').trim() !== '')
}

/**
 * Task `id`'s mark as the deck shows it: `done` only while the task is still
 * followed up today (`followedUpToday`) — an undo of the follow-up takes the
 * ✓ away (no mark then) —; `skipped` as marked.
 */
export function shownMark(
  marks: Readonly<Record<number, ReviewMark>>,
  id: number,
  followedUpToday: (id: number) => boolean,
): ReviewMark | undefined {
  const mark = marks[id]
  return mark === 'done' && !followedUpToday(id) ? undefined : mark
}

/** How many tasks of the review are followed up in it (and still followed up today). */
export function followedUpCount(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): number {
  return ids.filter((id) => shownMark(marks, id, followedUpToday) === 'done').length
}

/** Every task of the review has a mark as shown (followed up or skipped). */
export function allReviewed(
  marks: Readonly<Record<number, ReviewMark>>,
  ids: readonly number[],
  followedUpToday: (id: number) => boolean,
): boolean {
  return ids.length > 0 && ids.every((id) => shownMark(marks, id, followedUpToday) != null)
}
