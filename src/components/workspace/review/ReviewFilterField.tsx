import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import type { FilterAtom } from '../../../models/filter-expression'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useExpressionField } from '../../../hooks/use-expression-field'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { mirrorCharX, useNlpPopupAnchor } from '../../../hooks/use-nlp-popup-anchor'
import { ESCAPE_OWN_ATTR } from '../../../hooks/use-popover-anchor'
import { reviewFilterPredicate } from '../../../hooks/use-review-widget-queue'
import { expressionResolver } from '../../../services/filter-expression-field'
import type { AutocompleteRow, computeAutocomplete } from '../../../services/nlp-autocomplete'
import type { TokenTint } from '../../../services/nlp-token-tints'
import { peopleOnly, reviewFieldAutocomplete, reviewFieldPick, type ReviewFieldCounts } from '../../../services/review-field'
import { useListWidgetStore, type ReviewFilter } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'
import { startOfToday } from '../../../utils/date'
import { parseExpression, printExpression, printPieces, withoutAtom, type ExpressionPiece } from '../../../utils/filter-expression'
import { withExpression } from '../../../utils/predicate-expression'
import { EnvelopeIcon, ReplyIcon } from '../../shared/icons'
import { NlpPopup } from '../../shared/NlpPopup'
import { TintedText } from '../../shared/TintedText'
import tintStyles from '../../shared/TintedText.module.css'
import { useTooltip } from '../../shared/use-tooltip'
import styles from './ReviewWidget.module.css'

/** Line height of the field (px) and how many lines it grows to before it scrolls. */
const LINE_PX = 20
const MAX_LINES = 3

/** What the field says while empty. */
export const REVIEW_FIELD_PLACEHOLDER = 'Who or what to review…'

/** What the field says at rest on a filter that prints as nothing (a jump from a list that narrows by nothing). */
export const EVERY_OPEN_TASK = 'Every open task'

/** A review takes open tasks only: `done` and Completed dates would keep nothing, so the field refuses them and says why. */
const OPEN_TASKS_ONLY = { allowDone: false, allowCompleted: false } as const

/** A pill's tint: the one its term has as typed text (`expressionTints`); text and dates other than due / follow-up are plain pills. */
function pillTint(term: FilterAtom | undefined): TokenTint {
  if (term?.kind === 'priority') return term.value === 'urgent' ? 'urgent' : term.value === 'important' ? 'important' : term.value === 'focus' ? 'focus' : 'chip'
  if (term?.kind === 'date') return term.field === 'deadline' ? 'due' : term.field === 'followup' || term.field === 'lastFollowup' ? 'followup' : 'chip'
  return 'chip'
}

/**
 * Each person's, tag's and status's open tasks among those the widget's
 * screen filter shows (its lens switch through its context), from the
 * shared stats base — no database read on render or keystroke.
 */
function useReviewFieldCounts(): ReviewFieldCounts {
  const base = useStatsBase()
  return useMemo(() => {
    const person = new Map<number, number>()
    const tag = new Map<number, number>()
    const status = new Map<number, number>()
    const bump = (map: Map<number, number>, id: number | undefined) => { if (id != null) map.set(id, (map.get(id) ?? 0) + 1) }
    for (const t of base.shown) {
      if (t.isCompleted) continue
      for (const p of base.ctx.assignedPeopleMap.get(t.id) ?? []) bump(person, p.id)
      for (const g of base.ctx.assignedTagsMap.get(t.id) ?? []) bump(tag, g.id)
      bump(status, t.statusId)
    }
    return { person, tag, status }
  }, [base])
}

/**
 * The Review widget's prompt row (widget feedback 2A, board Review-field):
 * one field that takes a filter expression — what a list's Expression filter
 * takes (`@person`, `#tag`, `!status`, `/urgent`, date words, `and` / `or` /
 * `not`, parentheses) but `done` and Completed dates (a review takes open
 * tasks only), tinted as it is typed (`useExpressionField`). **The
 * filter is temporary**: kept per tab in memory (`list-widget-store
 * .reviewFilters`), never written to the layout, gone with a reload.
 *
 * A click on the field (or a focus while it is empty) lists people, tags and
 * statuses with their open tasks; bare letters match all three; `@ # ! /`
 * open the expression field's popup (`services/review-field`). A pick writes
 * the name's token; after a whole term it joins the filter as chips combine
 * (one sort's names `or` together, the sorts `and`). ⏎ in a list of matches
 * takes the first; ⏎ elsewhere settles the text. A text that doesn't read
 * shows its error under the field and is never written — the queue keeps
 * the last filter that read; Esc puts that text back (and, with nothing to
 * put back, leaves the field). × clears it — also a filter that prints as
 * nothing (a jump from a list that narrows by nothing), which the field
 * shows at rest as `Every open task`.
 *
 * **At rest** — the field not focused, its text the filter's — each term is
 * a pill with its own × (`printPieces`: the same words, the terms as pills):
 * a press on one takes that term out of the filter (`withoutAtom`: with a
 * `not` over it, and the parentheses of a group left with one term), the
 * `done` pill Show completed. A press anywhere else in the field goes to
 * the text under the pills, which then shows as typed text again.
 *
 * At its end, while the filter names only people (`@A`, `@A or @B`) and only
 * on desktop: Check-in (the check-in dialog for those people) and Paste reply
 * (the reply import, which reads the person from the reply). `trailing` follows (the progress and the lens switch, in a cell of
 * several widgets).
 */
export function ReviewFilterField({ tabId, filter, inputRef, trailing }: {
  tabId: string
  /** The filter as stored (the last that read), or null. */
  filter: ReviewFilter | null
  inputRef: RefObject<HTMLTextAreaElement | null>
  trailing?: ReactNode
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)
  const errorId = useId()
  const everyTaskId = useId()
  const predicate = useMemo<TodoPredicate>(() => (filter ? reviewFilterPredicate(filter) : emptyPredicate()), [filter])
  const onChange = useCallback((next: TodoPredicate) => {
    useListWidgetStore.getState().setReviewFilter(tabId, next.expression ? { expression: next.expression, showCompleted: next.showCompleted } : null)
  }, [tabId])

  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  // The field as it reads a text (a review takes open tasks only: no `done`, no Completed dates).
  const readText = useMemo(() => {
    const names = expressionResolver(people, tags, statuses)
    return (text: string) => parseExpression(text, { today: startOfToday(), names, ...OPEN_TASKS_ONLY })
  }, [people, tags, statuses])
  const reads = useCallback((text: string) => readText(text).ok, [readText])
  const counts = useReviewFieldCounts()
  /** The field was clicked (or focused while empty): an empty place for a term lists everything. Typing disarms it. */
  const browse = useRef(false)
  const autocomplete = useCallback<typeof computeAutocomplete>(
    (value, cursor, sources) => reviewFieldAutocomplete(value, cursor, sources, { counts, browse: browse.current, reads }),
    [counts, reads],
  )
  const field = useExpressionField({ predicate, onChange, inputRef, autocomplete, ...OPEN_TASKS_ONLY })
  const { text, parse, tints, ac } = field
  // At rest: not focused, and the text is the filter's (nothing typed and unread) — its terms are pills.
  const [focused, setFocused] = useState(false)
  // A filter that prints as nothing (a jump from a list that narrows by nothing): every open task.
  const everyTask = filter != null && field.stored === ''
  const resting = !focused && filter != null && text === field.stored
  const pieces = useMemo<ExpressionPiece[]>(
    () => (resting && filter ? printPieces(filter.expression, filter.showCompleted, field.names) : []),
    [resting, filter, field.names],
  )
  /** A pill's ×: its term out of the filter (the `done` pill: Show completed off), written at once. */
  const removePiece = (piece: ExpressionPiece) => {
    if (!filter) return
    if (piece.done) onChange(withExpression(predicate, filter.expression, false))
    else if (piece.atom != null) onChange(withExpression(predicate, withoutAtom(filter.expression, piece.atom), filter.showCompleted))
  }
  const error = parse.ok ? null : parse.error
  const errorTip = useTooltip(error?.hint ?? null)

  const syncMirror = useCallback(() => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollTop = inputRef.current.scrollTop
  }, [inputRef])
  const fitHeight = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, LINE_PX), MAX_LINES * LINE_PX)}px`
    syncMirror()
  }, [inputRef, syncMirror])
  // Also when the pills give way to the text (a focus): the text sizes the field again.
  useLayoutEffect(() => { fitHeight() }, [text, resting, fitHeight])
  useEffect(() => {
    const input = inputRef.current
    if (!input || typeof ResizeObserver === 'undefined') return
    let width = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return
      width = input.clientWidth
      fitHeight()
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [inputRef, fitHeight])

  const anchorIndex = ac.state.view?.anchor ?? null
  const caretX = useCallback(
    () => (mirrorRef.current && anchorIndex != null ? mirrorCharX(mirrorRef.current, anchorIndex) : null),
    [anchorIndex],
  )
  const { setPopupEl, style: popupStyle } = useNlpPopupAnchor(inputRef, ac.state, { x: caretX, key: text })

  /** Re-reads the popup where the caret is, the whole list allowed (a click, a focus while empty). */
  const openList = (input: HTMLTextAreaElement) => {
    browse.current = true
    field.onSelect(input)
  }

  /** A row picked (a click, or ⏎ / Tab on the highlighted one): a name with its joining word; anything else as the popup writes it. */
  const pick = (row: AutocompleteRow) => {
    const view = ac.state.view
    const input = inputRef.current
    if (!view || !input) return
    browse.current = false
    if (row.kind !== 'entity') {
      ac.select(row, input)
      return
    }
    const next = reviewFieldPick(input.value, view.from, view.to, row.item, {
      parse: readText,
      print: (expression, showCompleted) => printExpression(expression, showCompleted, field.names),
    })
    ac.dismiss()
    field.apply(next.value, next.cursor, true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const { visible, view, selectedIndex, navigated } = ac.state
    const composing = e.nativeEvent.isComposing
    if (visible && view && !composing && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      // The whole list with nothing typed: ⏎ settles the text and Tab moves on, unless ↑ / ↓ chose a row.
      if (view.query === '' && view.trigger === null && !navigated) {
        browse.current = false
        if (e.key === 'Enter') {
          e.preventDefault()
          field.onBlur()
        } else ac.dismiss()
        return
      }
      const row = view.rows[selectedIndex]
      if (row?.kind === 'entity') {
        e.preventDefault()
        e.stopPropagation()
        pick(row)
        return
      }
    }
    if (field.onKeyDown(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    // Esc with nothing to put back leaves the field (a popover it sits in — a small face's whole widget — stays).
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      browse.current = false
      e.currentTarget.blur()
    }
  }

  const clear = () => {
    browse.current = false
    ac.dismiss()
    field.apply('', 0, true)
    // "Every open task" prints as nothing, as no filter does: the field has no text to write, so it goes here.
    if (everyTask) useListWidgetStore.getState().setReviewFilter(tabId, null)
    inputRef.current?.focus()
  }

  const isMobile = useIsMobile()
  const checkinIds = isMobile ? null : peopleOnly(filter?.expression)

  return (
    <div className={styles.fieldRow} data-prompt-row="" data-testid="review-field-row">
      <div className={styles.fieldLine}>
        <div className={`${styles.field} ${error ? styles.fieldError : ''}`}>
          <div className={styles.fieldText}>
            {resting ? (
              // The pills size the field; the text field lies under them, unseen, taking every press but an ×'s.
              <div className={styles.pills} data-testid="review-field-pills">
                {everyTask && <span id={everyTaskId} data-review-every-task="">{EVERY_OPEN_TASK}</span>}
                {pieces.map((piece, i) => (piece.atom == null && !piece.done ? (
                  <span key={i} className={tintStyles.tint} data-tint="operator" aria-hidden="true">{piece.text}</span>
                ) : (
                  <span key={i} className={`${tintStyles.tint} ${styles.pill}`} data-tint={pillTint(piece.term)} data-review-pill={piece.text}>
                    <span aria-hidden="true">{piece.text}</span>
                    <button
                      type="button"
                      className={styles.pillRemove}
                      tabIndex={-1}
                      aria-label={`Remove ${piece.text}`}
                      title={`Remove ${piece.text}`}
                      // The press doesn't move the focus into the field.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => removePiece(piece)}
                    >
                      &times;
                    </button>
                  </span>
                )))}
              </div>
            ) : (
              <div ref={mirrorRef} className={styles.mirror} aria-hidden="true">
                <TintedText text={text} spans={tints} />
              </div>
            )}
            <textarea
              ref={inputRef}
              className={`${styles.input} ${resting ? styles.inputRest : ''}`}
              rows={1}
              value={text}
              // At rest on every open task the field says so (over the empty text): no placeholder under it.
              placeholder={resting && everyTask ? '' : REVIEW_FIELD_PLACEHOLDER}
              aria-label="Review filter"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : resting && everyTask ? everyTaskId : undefined}
              aria-autocomplete="list"
              spellCheck={false}
              data-testid="review-field"
              {...{ [ESCAPE_OWN_ATTR]: '' }}
              onChange={(e) => {
                browse.current = false
                field.onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)
              }}
              onSelect={(e) => {
                syncMirror()
                field.onSelect(e.currentTarget)
              }}
              onClick={(e) => openList(e.currentTarget)}
              onFocus={(e) => {
                setFocused(true)
                if (e.currentTarget.value === '') openList(e.currentTarget)
              }}
              onScroll={syncMirror}
              onBlur={() => {
                setFocused(false)
                browse.current = false
                field.onBlur()
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {(text !== '' || everyTask) && (
            <button
              type="button"
              className={styles.clear}
              tabIndex={-1}
              aria-label="Clear the filter"
              title="Clear the filter"
              // The press keeps the focus (and the caret) in the field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
            >
              &times;
            </button>
          )}
        </div>
        {checkinIds && <CheckinButtons personIds={checkinIds} />}
        {trailing}
      </div>
      {error && (
        <span id={errorId} className={styles.fieldErrorText} data-testid="review-field-error" {...errorTip.triggerProps}>
          {error.message}
          {errorTip.tooltip}
        </span>
      )}
      {ac.state.visible && ac.state.view && createPortal(
        <NlpPopup
          view={ac.state.view}
          selectedIndex={ac.state.selectedIndex}
          onPick={pick}
          onHighlight={ac.highlight}
          popupRef={setPopupEl}
          className={styles.popup}
          style={popupStyle}
        />,
        document.body,
      )}
    </div>
  )
}

/**
 * Check-in and Paste reply at the field's end (J9): Check-in opens the
 * check-in dialog for the filter's people (the first of them selected), where
 * the message is copied; nothing is sent from here. Paste reply opens the
 * reply import — for the one person, or for whoever the reply names.
 */
function CheckinButtons({ personIds }: { personIds: readonly number[] }) {
  const people = usePersonStore((s) => s.people)
  const named = personIds.flatMap((id) => {
    const p = people.find((x) => x.id === id)
    return p ? [{ id, name: p.name }] : []
  })
  const [only] = named
  const one = named.length === 1 ? only : undefined
  const checkinTip = useTooltip(one ? `Check-in for ${one.name}…` : 'Check-ins…')
  const replyTip = useTooltip(one ? `Paste reply from ${one.name}…` : 'Paste reply…')
  if (!only) return null
  return (
    <>
      <button
        type="button"
        className={styles.checkinButton}
        aria-label="Check-in"
        aria-haspopup="dialog"
        data-testid="review-checkin"
        {...checkinTip.triggerProps}
        onClick={() => useUIStore.getState().openCheckinDialog(named.map((p) => p.id))}
      >
        <EnvelopeIcon size={15} />
      </button>
      {checkinTip.tooltip}
      <button
        type="button"
        className={styles.checkinButton}
        aria-label="Paste reply"
        data-testid="review-paste-reply"
        {...replyTip.triggerProps}
        onClick={() => useUIStore.getState().openCheckinImport(one ? { personId: one.id } : undefined)}
      >
        <ReplyIcon size={15} />
      </button>
      {replyTip.tooltip}
    </>
  )
}
