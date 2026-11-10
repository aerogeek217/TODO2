import { useCallback, useContext, useEffect, useMemo, useRef, type FocusEvent, type ReactNode } from 'react'
import { REVIEW_BY_LABEL, reviewBy, type ReviewBy } from '../../../models/review'
import type { ReviewTab } from '../../../models/workspace-layout'
import { useReviewWidgetQueue } from '../../../hooks/use-review-widget-queue'
import { useToday } from '../../../hooks/use-today'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { setReviewQueue } from '../../../services/review-queue'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import {
  allReviewed,
  followedUpCount,
  reviewWidgetSession,
  shownMark,
} from '../../../stores/review-session'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { isFollowedUpToday } from '../../../utils/followup'
import { reviewFaceFor } from '../../../utils/widget-face'
import { EmptyState } from '../../shared/EmptyState'
import { ReviewIcon } from '../../shared/icons'
import { ReviewCard, ReviewCompactCard, type ReviewFocusOnOpen } from '../../review/ReviewCard'
import { ReviewRail } from '../../review/ReviewRail'
import { ReviewSessionContext, useReviewSession } from '../../review/review-session-context'
import { CellControlsContext } from '../cell-controls'
import { TabLensSwitch } from '../LensSwitch'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { ReviewField } from './ReviewField'
import { REVIEW_KIND_WORDS, useReviewChoices } from './review-choices'
import styles from './ReviewWidget.module.css'

/**
 * The Review widget (item 12, board BM): the review deck in a cell. Alone in
 * its cell its top line reads `Review`, the progress (`3 of 12 · 2 followed
 * up`, with picks), its lens switch and the cell's ⋯; under it the prompt
 * row (`ReviewField`): the kind it reviews by as the row's label — a small
 * menu, the widget's saved setting (layout config `by`) — and the field the
 * user types in, a list's Prompt for. In a cell of several widgets there is
 * no top line: the prompt row is its first row and ends with the progress
 * and the lens switch. **The picks are temporary**, stored as a list's
 * prompt picks are (`list-widget-store.picks`, by tab id: never saved, gone
 * with a reload), one or more of the kind, OR-combined. The queue is
 * **live** (`useReviewWidgetQueue`): the picks' open tasks under the screen
 * filter and the widget's lens switch — a task leaving the picks leaves the
 * rail; the current one stays until the review moves on. Its place and –
 * marks last as long as the picks (the tab's session; ✓ is followed up
 * today, item 11); only the rail's sort and the lens switch are view state.
 * Faces (`utils/widget-face.reviewFaceFor`): large — the rail, the deck's
 * card (`components/review/ReviewCard`) and its footer; medium — the card's
 * essentials, the update line and the footer (the phone's face too); small
 * — `Review · <picks>` and `N left · M followed up`, a click opens the whole
 * widget over the cell. Every write is the deck's (`useReviewFollowUp`, the
 * card's fields), each its own undo step.
 */
export function ReviewWidget({ tab }: { tab: ReviewTab }) {
  const [faceRef, face] = useWidgetFace(reviewFaceFor)
  const storedSort = tab.viewState?.sort
  const session = useMemo(() => reviewWidgetSession(tab.id, () => ({ sort: storedSort ?? 'queue' })), [tab.id, storedSort])
  // A card opening takes the focus only while the user is working in the widget: the focus is (or was, until the
  // card it was in went) inside it — not when it went elsewhere on the page, and never from the prompt row (a
  // pick there opens the first card; the next pick is typed where the focus is).
  const focusWithin = useRef(false)
  const focusOnOpen = useCallback(() => {
    const active = document.activeElement
    if (active?.closest('[data-prompt-row]') != null) return false
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
        data-review-by={reviewBy(tab.config)}
        onFocus={() => { focusWithin.current = true }}
        onBlur={onBlur}
      >
        <ReviewWidgetBody tab={tab} face={face} session={session} focusOnOpen={focusOnOpen} />
      </div>
    </ReviewSessionContext.Provider>
  )
}

const NO_PICKS: readonly number[] = []

/** Names in words, any of them: `Aisha`, `Aisha or Ben`, `Aisha, Ben or Cy`. */
function anyOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`
}

function ReviewWidgetBody({ tab, face, session, focusOnOpen }: {
  tab: ReviewTab
  face: 'small' | 'medium' | 'large'
  session: ReturnType<typeof reviewWidgetSession>
  focusOnOpen: ReviewFocusOnOpen
}) {
  const by = reviewBy(tab.config)
  const choices = useReviewChoices(by)
  // The picks: temporary, as a list's prompt picks (never saved). One that names nothing any more — a deleted
  // person, a list that went — just drops out.
  const stored = useListWidgetStore((s) => s.picks[tab.id]) ?? NO_PICKS
  const picks = useMemo(() => {
    const live = stored.filter((id) => choices.words.has(id))
    return live.length === stored.length ? stored : live
  }, [stored, choices.words])
  const picked = picks.length > 0
  const names = anyOf(picks.map((id) => choices.words.get(id) ?? ''))
  const queue = useReviewWidgetQueue(by, picks)
  const todos = useTodoStore((s) => s.todos)
  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const today = useToday()
  const order = useReviewSession((s) => s.order)
  const index = useReviewSession((s) => s.index)
  const marks = useReviewSession((s) => s.marks)
  const fieldRef = useRef<HTMLInputElement>(null)
  // Alone in its cell (no tab strip): the widget has a top line of its own.
  const alone = useContext(CellControlsContext) != null

  // The checklist and the status updates load on demand.
  useEffect(() => {
    void useSubtaskStore.getState().ensureLoaded()
    void useStatusUpdateStore.getState().ensureLoaded()
  }, [])

  // The picks are of the kind they were made for: when the kind changes under them some other way than its
  // menu (an undo of the kind's change), they go too — an id means another thing by another kind.
  const picksBy = useRef(by)
  useEffect(() => {
    if (picksBy.current === by) return
    picksBy.current = by
    useListWidgetStore.getState().setPicks(tab.id, [])
  }, [by, tab.id])

  // The live queue into the session: the place kept — the current task staying after it leaves the
  // picks until the review moves on, except when the picks change. With no picks left, the – marks go
  // with them (the place does with the queue).
  const synced = useRef<{ key: string; ids: readonly number[] } | null>(null)
  const pickKey = `${by}:${picks.join(',')}`
  useEffect(() => {
    const last = synced.current
    if (last && last.key === pickKey && sameIds(last.ids, queue.ids)) return
    const first = last == null || last.key !== pickKey
    synced.current = { key: pickKey, ids: queue.ids }
    if (!picked && Object.keys(session.getState().marks).length > 0) session.setState({ marks: {} })
    setReviewQueue(session, queue, { keepCurrent: !first })
  }, [session, pickKey, picked, queue])

  // The rail's sort is view state, saved at once.
  const viewSort = tab.viewState?.sort ?? 'queue'
  useEffect(() => session.subscribe((s) => {
    if (s.sort !== viewSort) void useWorkspaceStore.getState().patchTabViewState(tab.id, 'review', { sort: s.sort })
  }), [session, tab.id, viewSort])

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
  const kind = REVIEW_KIND_WORDS[by].a

  if (face === 'small') {
    return (
      <div className={styles.small} data-testid="review-small-face">
        <span className={styles.smallGlyph} aria-hidden="true"><ReviewIcon size={16} /></span>
        <span className={styles.smallText}>
          <span className={styles.smallTitle}>{`Review · ${picked ? names : `Pick ${kind}`}`}</span>
          {picked && <span className={styles.smallCaption} data-testid="review-small-caption">{`${left} left · ${done} followed up`}</span>}
        </span>
      </div>
    )
  }

  // The kind is the widget's setting (layout config: saved at once, one undo step); its picks were of the old kind.
  const setBy = (next: ReviewBy) => {
    if (next === by) return
    useListWidgetStore.getState().setPicks(tab.id, [])
    useWorkspaceStore.getState().patchTabConfig(tab.id, 'review', { by: next }, `Review by ${REVIEW_BY_LABEL[next]}`)
  }

  const progress = picked && n > 0 && (
    <span className={styles.progress} data-testid="review-widget-progress" aria-live="polite">
      {/* Medium: the place alone; large: with how many are followed up — `All N reviewed` once every task has a mark. */}
      <strong>{face === 'large' && finished ? `All ${n} reviewed` : `${index + 1} of ${n}`}</strong>
      {face === 'large' && ` · ${done} followed up`}
    </span>
  )
  const lensSwitch = picked && <TabLensSwitch tab={tab} hides={queue.hides} />

  let body: ReactNode
  if (!picked) {
    body = (
      <div className={styles.emptyPrompt} data-testid="review-empty">
        <EmptyState
          illustration={by === 'person' ? 'person' : 'list'}
          title={`Pick ${kind} to review`}
          text={`Type in the ${REVIEW_BY_LABEL[by]} field above. The pick is temporary and isn’t saved.`}
          action={{ label: `Pick ${kind}`, onClick: () => fieldRef.current?.focus() }}
        />
      </div>
    )
  } else if (!todo) {
    const { waiting } = queue
    body = waiting.length > 0 && waiting.length === picks.length
      ? <EmptyWords>{anyOf(waiting)} {waiting.length === 1 ? 'asks' : 'ask'} for a pick first: answer it in a list widget showing it.</EmptyWords>
      : <EmptyWords>Nothing to review: no open tasks for {names} here.</EmptyWords>
  } else if (face === 'medium') {
    body = (
      <div className={styles.medium}>
        <ReviewCompactCard key={todo.id} todo={todo} focusOnOpen={focusOnOpen} />
      </div>
    )
  } else {
    body = (
      <div className={styles.large}>
        <ReviewRail todoById={todoById} followedUpToday={followedUpToday} className={styles.rail} label={`Review queue: ${names}`} />
        <ReviewCard key={todo.id} todo={todo} focusOnOpen={focusOnOpen} />
      </div>
    )
  }

  return (
    <>
      <WidgetTopLine alone className={styles.topLine} lead={<TopLineName>Review</TopLineName>}>
        {progress}
        {lensSwitch}
      </WidgetTopLine>
      <ReviewField
        by={by}
        options={choices.options}
        picks={picks}
        onPicks={(ids) => useListWidgetStore.getState().setPicks(tab.id, ids)}
        onBy={setBy}
        inputRef={fieldRef}
        trailing={alone ? undefined : <>{progress}{lensSwitch}</>}
      />
      {body}
    </>
  )
}

function EmptyWords({ children }: { children: ReactNode }) {
  return <div className={styles.empty} data-testid="review-empty"><p className={styles.emptyWords}>{children}</p></div>
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}
