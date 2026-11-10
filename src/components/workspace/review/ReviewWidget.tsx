import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import type { ReviewPick } from '../../../models/review'
import type { ReviewTab, ReviewTabViewState } from '../../../models/workspace-layout'
import { useReviewWidgetQueue } from '../../../hooks/use-review-widget-queue'
import { useToday } from '../../../hooks/use-today'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { setReviewQueue } from '../../../services/review-queue'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import {
  allReviewed,
  currentReviewId,
  followedUpCount,
  reviewWidgetSession,
  shownMark,
  type ReviewSession,
  type ReviewSessionData,
} from '../../../stores/review-session'
import { useStatusStore } from '../../../stores/status-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { dayKey } from '../../../utils/date'
import { isFollowedUpToday } from '../../../utils/followup'
import { reviewFaceFor } from '../../../utils/widget-face'
import { ChevronDownIcon, HashIcon, PersonIcon, ReviewIcon, StatusRingIcon, WidgetKindIcon } from '../../shared/icons'
import { ReviewCard, ReviewCompactCard, type ReviewFocusOnOpen } from '../../review/ReviewCard'
import { ReviewRail } from '../../review/ReviewRail'
import { ReviewSessionContext, useReviewSession } from '../../review/review-session-context'
import { TabLensSwitch } from '../LensSwitch'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { ReviewPicker } from './ReviewPicker'
import styles from './ReviewWidget.module.css'

/**
 * The Review widget (item 12, board BK): the review deck in a cell. Its top
 * line: `Review`, the pick as a chip that opens the picker (Person · Tag ·
 * Status · List), the progress (`3 of 8 · 2 followed up`), its lens switch
 * and the cell's ⋯. The queue is **live** (`useReviewWidgetQueue`): the
 * pick's open tasks under the screen filter and the widget's lens switch —
 * a task leaving the pick leaves the rail; the current one stays until the
 * review moves on. Its place, sort and – marks are view state, saved at once
 * (✓ is followed up today, item 11; a day's skips read as none the next day).
 * Faces (`utils/widget-face.reviewFaceFor`): large — the rail, the deck's
 * card (`components/review/ReviewCard`) and its footer; medium — the card's
 * essentials, the update line and the footer (the phone's face too); small
 * — `Review · <pick>` and `N left · M followed up`, a click opens the whole
 * widget over the cell. Every write is the deck's (`useReviewFollowUp`, the
 * card's fields), each its own undo step.
 */
export function ReviewWidget({ tab }: { tab: ReviewTab }) {
  const [faceRef, face] = useWidgetFace(reviewFaceFor)
  const session = useMemo(() => reviewWidgetSession(tab.id, () => sessionFromView(tab.viewState)), [tab.id, tab.viewState])
  // A card opening takes the focus only while the user is working in the widget: the focus is (or was, until the
  // card it was in went) inside it — not when it went elsewhere on the page.
  const focusWithin = useRef(false)
  const focusOnOpen = useCallback(() => {
    const active = document.activeElement
    return focusWithin.current && (active == null || active === document.body || active.closest('[data-review-widget]') != null)
  }, [])
  const onBlur = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) focusWithin.current = false
  }
  return (
    <ReviewSessionContext.Provider value={session}>
      <div
        ref={faceRef}
        className={styles.faceHost}
        data-review-widget={tab.id}
        data-review-face={face}
        onFocus={() => { focusWithin.current = true }}
        onBlur={onBlur}
      >
        <ReviewWidgetBody tab={tab} face={face} session={session} focusOnOpen={focusOnOpen} />
      </div>
    </ReviewSessionContext.Provider>
  )
}

/** A session's starting point from the widget's view state: its sort and today's skips (the task it was on comes back with the queue). */
function sessionFromView(view: ReviewTabViewState | undefined): Partial<ReviewSessionData> {
  const today = dayKey(new Date())
  const skipped = view?.skipped?.day === today ? view.skipped.ids : []
  return {
    sort: view?.sort ?? 'queue',
    marks: Object.fromEntries(skipped.map((id) => [id, 'skipped' as const])),
  }
}

/** Where the session stands, as view state (a field it doesn't have cleared). */
function viewOf(s: ReviewSession): Pick<ReviewTabViewState, 'sort' | 'currentId' | 'skipped'> {
  const ids = Object.entries(s.marks).flatMap(([id, mark]) => (mark === 'skipped' ? [Number(id)] : [])).sort((a, b) => a - b)
  return {
    sort: s.sort,
    currentId: currentReviewId(s),
    skipped: ids.length > 0 ? { day: dayKey(new Date()), ids } : undefined,
  }
}

function sameView(a: ReturnType<typeof viewOf>, b: ReviewTabViewState | undefined): boolean {
  return (a.sort ?? 'queue') === (b?.sort ?? 'queue')
    && a.currentId === b?.currentId
    && JSON.stringify(a.skipped ?? null) === JSON.stringify(b?.skipped ?? null)
}

function ReviewWidgetBody({ tab, face, session, focusOnOpen }: {
  tab: ReviewTab
  face: 'small' | 'medium' | 'large'
  session: ReturnType<typeof reviewWidgetSession>
  focusOnOpen: ReviewFocusOnOpen
}) {
  const pick = tab.config.pick
  const queue = useReviewWidgetQueue(tab.id, pick)
  const todos = useTodoStore((s) => s.todos)
  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const today = useToday()
  const order = useReviewSession((s) => s.order)
  const index = useReviewSession((s) => s.index)
  const marks = useReviewSession((s) => s.marks)
  const pickName = usePickName(pick)
  const [pickerOpen, setPickerOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)

  // The checklist and the status updates load on demand.
  useEffect(() => {
    void useSubtaskStore.getState().ensureLoaded()
    void useStatusUpdateStore.getState().ensureLoaded()
  }, [])

  // A new session (a reload): the task it was on, put back once the queue holds it — while the tasks
  // still load (an empty queue), it waits; a queue without it gives it up.
  const restore = useRef<number | null | undefined>(undefined)
  if (restore.current === undefined) {
    restore.current = session.getState().order.length === 0 ? (tab.viewState?.currentId ?? null) : null
  }

  // The live queue into the session: the place kept — the current task staying after it leaves the
  // pick until the review moves on, except on a new pick.
  const synced = useRef<{ key: string; ids: readonly number[] } | null>(null)
  const pickKey = pick ? `${pick.kind}:${pick.id}` : ''
  useEffect(() => {
    const last = synced.current
    if (last && last.key === pickKey && sameIds(last.ids, queue.ids)) return
    const target = restore.current
    if (target != null && queue.ids.length === 0) return
    const first = last == null || last.key !== pickKey
    synced.current = { key: pickKey, ids: queue.ids }
    setReviewQueue(session, queue, { keepCurrent: !first })
    if (target != null) {
      restore.current = null
      const at = session.getState().order.indexOf(target)
      if (at >= 0) session.getState().go(at)
    }
  }, [session, pickKey, queue])

  // Where it stands, as view state (saved at once): its sort, the current task, today's skips — not while
  // the task it was on still waits to come back.
  const view = tab.viewState
  useEffect(() => session.subscribe((s) => {
    if (restore.current != null) return
    const next = viewOf(s)
    if (!sameView(next, view)) void useWorkspaceStore.getState().patchTabViewState(tab.id, 'review', next)
  }), [session, tab.id, view])

  const followedUpToday = useCallback((id: number) => {
    const t = todoById.get(id)
    return t != null && isFollowedUpToday(t, today)
  }, [todoById, today])
  const n = order.length
  const done = followedUpCount(marks, order, followedUpToday)
  const left = order.filter((id) => shownMark(marks, id, followedUpToday) == null).length
  const finished = allReviewed(marks, order, followedUpToday)
  const currentId = order[index]
  const todo = currentId != null ? todoById.get(currentId) : undefined

  const setPick = (next: ReviewPick) => {
    if (next.kind === pick?.kind && next.id === pick.id) return
    useWorkspaceStore.getState().patchTabConfig(tab.id, 'review', { pick: next })
  }
  const picker = pickerOpen && (
    <ReviewPicker anchorRef={chipRef} pick={pick} onPick={setPick} onClose={() => setPickerOpen(false)} />
  )

  if (face === 'small') {
    return (
      <div className={styles.small} data-testid="review-small-face">
        <span className={styles.smallGlyph} aria-hidden="true"><ReviewIcon size={16} /></span>
        <span className={styles.smallText}>
          <span className={styles.smallTitle}>{pick ? `Review · ${pickName}` : 'Review'}</span>
          <span className={styles.smallCaption} data-testid="review-small-caption">
            {pick ? `${left} left · ${done} followed up` : 'Nothing picked'}
          </span>
        </span>
      </div>
    )
  }

  const progress = !pick || n === 0 ? null : face === 'medium'
    ? `${index + 1} / ${n}`
    : finished ? `All ${n} reviewed · ${done} followed up` : `${index + 1} of ${n} · ${done} followed up`

  const topLine = (
    <WidgetTopLine className={styles.topLine} lead={<TopLineName>Review</TopLineName>}>
      <button
        ref={chipRef}
        type="button"
        className={styles.pickChip}
        data-kind={pick?.kind}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label={pick ? `Reviewing ${pickName}: change` : 'Pick what to review'}
        data-testid="review-pick"
        onClick={() => setPickerOpen((o) => !o)}
      >
        {pick && <PickGlyph pick={pick} />}
        <span className={styles.pickName}>{pick ? pickName : 'Pick…'}</span>
        <ChevronDownIcon size={11} />
      </button>
      {progress && <span className={styles.progress} data-testid="review-widget-progress" aria-live="polite">{progress}</span>}
      <span className={styles.spacer} />
      {pick && <TabLensSwitch tab={tab} hides={queue.hides} />}
    </WidgetTopLine>
  )

  let body: ReactNode
  if (!pick) {
    body = (
      <div className={styles.empty} data-testid="review-empty">
        <p className={styles.emptyTitle}>Who do you want to review?</p>
        <button type="button" className={styles.emptyButton} onClick={() => setPickerOpen(true)}>Pick someone…</button>
      </div>
    )
  } else if (queue.missing) {
    body = <EmptyWords>The list this widget reviewed was deleted. Pick another.</EmptyWords>
  } else if (queue.pending) {
    body = <EmptyWords>{pickName} asks for a pick first: answer it in a list widget showing it.</EmptyWords>
  } else if (!todo) {
    body = <EmptyWords>Nothing to review: no open tasks for {pickName} here.</EmptyWords>
  } else if (face === 'medium') {
    body = (
      <div className={styles.medium}>
        <ReviewCompactCard key={todo.id} todo={todo} focusOnOpen={focusOnOpen} />
      </div>
    )
  } else {
    body = (
      <div className={styles.large}>
        <ReviewRail todoById={todoById} followedUpToday={followedUpToday} className={styles.rail} label={`Review queue: ${pickName}`} />
        <ReviewCard key={todo.id} todo={todo} focusOnOpen={focusOnOpen} />
      </div>
    )
  }

  return (
    <>
      {topLine}
      {body}
      {picker}
    </>
  )
}

function EmptyWords({ children }: { children: ReactNode }) {
  return <div className={styles.empty} data-testid="review-empty"><p className={styles.emptyWords}>{children}</p></div>
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** The pick's glyph on its chip. */
function PickGlyph({ pick }: { pick: ReviewPick }) {
  switch (pick.kind) {
    case 'person': return <PersonIcon size={12} />
    case 'tag': return <HashIcon size={12} />
    case 'status': return <StatusRingIcon size={12} />
    case 'list': return <WidgetKindIcon kind="lens" size={12} />
  }
}

/** The pick's name: the person, `#tag`, the status, the list (`Deleted` once gone). */
function usePickName(pick: ReviewPick | undefined): string {
  const person = usePersonStore((s) => (pick?.kind === 'person' ? s.people.find((p) => p.id === pick.id)?.name : undefined))
  const tag = useTagStore((s) => (pick?.kind === 'tag' ? s.tags.find((t) => t.id === pick.id)?.name : undefined))
  const status = useStatusStore((s) => (pick?.kind === 'status' ? s.statuses.find((st) => st.id === pick.id)?.name : undefined))
  const list = useListDefinitionStore((s) => (pick?.kind === 'list' ? s.listDefinitions.find((d) => d.id === pick.id)?.name : undefined))
  if (!pick) return ''
  switch (pick.kind) {
    case 'person': return person ?? 'Deleted person'
    case 'tag': return tag != null ? `#${tag}` : 'Deleted tag'
    case 'status': return status ?? 'Deleted status'
    case 'list': return list ?? 'Deleted list'
  }
}
