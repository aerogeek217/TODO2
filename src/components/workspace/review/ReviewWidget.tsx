import { useCallback, useContext, useEffect, useMemo, useRef, type FocusEvent, type ReactNode } from 'react'
import { DEFAULT_REVIEW_WIDGET_SORT } from '../../../models/review'
import type { ReviewTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useReviewWidgetQueue } from '../../../hooks/use-review-widget-queue'
import { useToday } from '../../../hooks/use-today'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { setReviewQueue } from '../../../services/review-queue'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import {
  allReviewed,
  followedUpCount,
  reviewWidgetSession,
  shownMark,
} from '../../../stores/review-session'
import { useStatusStore } from '../../../stores/status-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { expressionNamesOf } from '../../../utils/filter-chips'
import { printExpression } from '../../../utils/filter-expression'
import { isFollowedUpToday } from '../../../utils/followup'
import { reviewFaceFor, reviewQueueFolds } from '../../../utils/widget-face'
import { EmptyState } from '../../shared/EmptyState'
import { ReviewIcon } from '../../shared/icons'
import { ReviewCard, ReviewCompactCard, type ReviewFocusOnOpen } from '../../review/ReviewCard'
import { ReviewQueueButton } from '../../review/ReviewQueueButton'
import { ReviewRail } from '../../review/ReviewRail'
import { ReviewSessionContext, useReviewSession } from '../../review/review-session-context'
import { CellControlsContext } from '../cell-controls'
import { TabLensSwitch } from '../LensSwitch'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { ReviewFilterField } from './ReviewFilterField'
import styles from './ReviewWidget.module.css'

/**
 * The Review widget (item 12; widget feedback 2A, board Review-field): the
 * review deck in a cell. Alone in its cell its top line reads `Review`, the
 * progress (`2 followed up`, with a filter; under 820px wide a Queue button
 * before it), its lens switch and the cell's ⋯; under it the prompt row
 * (`ReviewFilterField`): one field that takes a filter expression — no kind
 * to choose. In a cell of several widgets there is no top line: the prompt
 * row is its first row and ends with the progress and the lens switch.
 * **The filter is temporary**, kept by tab id in memory
 * (`list-widget-store.reviewFilters`: never saved, gone with a reload). The
 * queue is **live** (`useReviewWidgetQueue`): the open tasks the filter
 * keeps under the screen filter and the widget's lens switch — a task
 * leaving the filter leaves the rail; the current one stays until the
 * review moves on. Its place and – marks last as long as the filter (the
 * tab's session; ✓ is followed up today, item 11); only the rail's sort
 * (Priority unless one is stored) and the lens switch are view state. A
 * double-click on a rail row opens the task in its editor. Faces
 * (`utils/widget-face.reviewFaceFor`): large — the rail, the deck's card
 * (`components/review/ReviewCard`) and its footer; medium — the card's
 * essentials, the update line and the footer (the phone's face too); small
 * — `Review · <filter>` and `N left · M followed up`, a click opens the
 * whole widget over the cell. Every write is the deck's
 * (`useReviewFollowUp`, the card's fields), each its own undo step.
 */
export function ReviewWidget({ tab }: { tab: ReviewTab }) {
  const [faceRef, face] = useWidgetFace(reviewFaceFor)
  // The body's width too: under 820px the large face folds its queue away.
  const [sizeRef, size] = useElementSize()
  const hostRef = useCallback((el: HTMLElement | null) => { faceRef(el); sizeRef(el) }, [faceRef, sizeRef])
  const storedSort = tab.viewState?.sort
  const session = useMemo(() => reviewWidgetSession(tab.id, () => ({ sort: storedSort ?? DEFAULT_REVIEW_WIDGET_SORT })), [tab.id, storedSort])
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
        ref={hostRef}
        className={styles.faceHost}
        data-review-widget={tab.id}
        data-review-face={face}
        onFocus={() => { focusWithin.current = true }}
        onBlur={onBlur}
      >
        <ReviewWidgetBody tab={tab} face={face} width={size.width} session={session} focusOnOpen={focusOnOpen} />
      </div>
    </ReviewSessionContext.Provider>
  )
}

function ReviewWidgetBody({ tab, face, width, session, focusOnOpen }: {
  tab: ReviewTab
  face: 'small' | 'medium' | 'large'
  /** The widget's measured width (0 unmeasured). */
  width: number
  session: ReturnType<typeof reviewWidgetSession>
  focusOnOpen: ReviewFocusOnOpen
}) {
  // The filter: temporary (never saved), the last text the field read.
  const filter = useListWidgetStore((s) => s.reviewFilters[tab.id]) ?? null
  const picked = filter != null
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const filterText = useMemo(
    () => (filter ? printExpression(filter.expression, filter.showCompleted, expressionNamesOf({ people, tags, statuses })) : ''),
    [filter, people, tags, statuses],
  )
  const queue = useReviewWidgetQueue(filter)
  const todos = useTodoStore((s) => s.todos)
  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const today = useToday()
  const order = useReviewSession((s) => s.order)
  const index = useReviewSession((s) => s.index)
  const marks = useReviewSession((s) => s.marks)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  // Alone in its cell (no tab strip): the widget has a top line of its own.
  const alone = useContext(CellControlsContext) != null

  // The checklist and the status updates load on demand.
  useEffect(() => {
    void useSubtaskStore.getState().ensureLoaded()
    void useStatusUpdateStore.getState().ensureLoaded()
  }, [])

  // The live queue into the session: the place kept — the current task staying after it leaves the
  // filter until the review moves on, except when the filter changes. With no filter left, the – marks go
  // with it (the place does with the queue).
  const synced = useRef<{ filter: typeof filter; ids: readonly number[] } | null>(null)
  useEffect(() => {
    const last = synced.current
    if (last && last.filter === filter && sameIds(last.ids, queue.ids)) return
    const first = last == null || last.filter !== filter
    synced.current = { filter, ids: queue.ids }
    if (!picked && Object.keys(session.getState().marks).length > 0) session.setState({ marks: {} })
    setReviewQueue(session, queue, { keepCurrent: !first })
  }, [session, filter, picked, queue])

  // The rail's sort is view state, saved at once.
  const viewSort = tab.viewState?.sort ?? DEFAULT_REVIEW_WIDGET_SORT
  useEffect(() => session.subscribe((s) => {
    if (s.sort !== viewSort) void useWorkspaceStore.getState().patchTabViewState(tab.id, 'review', { sort: s.sort })
  }), [session, tab.id, viewSort])

  const followedUpToday = useCallback((id: number) => {
    const t = todoById.get(id)
    return t != null && isFollowedUpToday(t, today)
  }, [todoById, today])
  const openTask = useCallback((id: number) => useUIStore.getState().openEditPopup(id), [])
  const n = order.length
  const done = followedUpCount(marks, order, followedUpToday)
  const left = order.filter((id) => shownMark(marks, id, followedUpToday) == null).length
  const finished = allReviewed(marks, order, followedUpToday)
  const currentId = order[index]
  const todo = currentId != null ? todoById.get(currentId) : undefined

  if (face === 'small') {
    return (
      <div className={styles.small} data-testid="review-small-face">
        <span className={styles.smallGlyph} aria-hidden="true"><ReviewIcon size={16} /></span>
        <span className={styles.smallText}>
          <span className={styles.smallTitle}>{`Review · ${picked ? filterText : 'Pick who or what'}`}</span>
          {picked && <span className={styles.smallCaption} data-testid="review-small-caption">{`${left} left · ${done} followed up`}</span>}
        </span>
      </div>
    )
  }

  // How many are followed up; on the large face `All N reviewed` before it once every task has a mark. No
  // place in the queue: the card is the current task.
  const queueLabel = `Review queue: ${filterText}`
  // The large face under 820px wide: no queue column; a Queue button opens it.
  const queueFolded = face === 'large' && !!todo && reviewQueueFolds(width)
  const status = face === 'large' && finished ? `All ${n} reviewed` : null
  const progress = picked && n > 0 && (
    <span className={styles.progress} data-testid="review-widget-progress" aria-live="polite">
      {queueFolded && (
        <>
          <strong><ReviewQueueButton todoById={todoById} followedUpToday={followedUpToday} label={queueLabel} /></strong>
          {' · '}
        </>
      )}
      {status != null && <><strong>{status}</strong>{' · '}</>}
      {`${done} followed up`}
    </span>
  )
  const lensSwitch = picked && <TabLensSwitch tab={tab} hides={queue.hides} />

  let body: ReactNode
  if (!picked) {
    body = (
      <div className={styles.emptyPrompt} data-testid="review-empty">
        <EmptyState
          illustration="person"
          title="Pick who or what to review"
          text="Click the field, or type @person, #tag, !status or any filter. It is temporary and isn’t saved."
          action={{ label: 'Pick', onClick: () => fieldRef.current?.focus() }}
        />
      </div>
    )
  } else if (!todo) {
    body = <EmptyWords>Nothing to review: no open tasks match this filter here.</EmptyWords>
  } else if (face === 'medium') {
    body = (
      <div className={styles.medium}>
        <ReviewCompactCard key={todo.id} todo={todo} focusOnOpen={focusOnOpen} />
      </div>
    )
  } else {
    body = (
      <div className={styles.large} data-queue-folded={queueFolded || undefined}>
        {!queueFolded && <ReviewRail todoById={todoById} followedUpToday={followedUpToday} className={styles.rail} label={queueLabel} onOpenTask={openTask} />}
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
      <ReviewFilterField
        tabId={tab.id}
        filter={filter}
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
