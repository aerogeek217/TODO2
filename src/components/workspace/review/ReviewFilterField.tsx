import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useExpressionField } from '../../../hooks/use-expression-field'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { mirrorCharX, useNlpPopupAnchor } from '../../../hooks/use-nlp-popup-anchor'
import { ESCAPE_OWN_ATTR } from '../../../hooks/use-popover-anchor'
import { reviewFilterPredicate } from '../../../hooks/use-review-widget-queue'
import { sendPersonCheckin } from '../../../services/checkin-email/person-checkin'
import { expressionResolver } from '../../../services/filter-expression-field'
import type { AutocompleteRow, computeAutocomplete } from '../../../services/nlp-autocomplete'
import { peopleOnly, reviewFieldAutocomplete, reviewFieldPick, type ReviewFieldCounts } from '../../../services/review-field'
import { useListWidgetStore, type ReviewFilter } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'
import { startOfToday } from '../../../utils/date'
import { parseExpression } from '../../../utils/filter-expression'
import { EnvelopeIcon, ReplyIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { NlpPopup } from '../../shared/NlpPopup'
import { TintedText } from '../../shared/TintedText'
import { useTooltip } from '../../shared/use-tooltip'
import styles from './ReviewWidget.module.css'

/** Line height of the field (px) and how many lines it grows to before it scrolls. */
const LINE_PX = 20
const MAX_LINES = 3

/** What the field says while empty. */
export const REVIEW_FIELD_PLACEHOLDER = 'Who or what to review…'

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
 * `not`, parentheses), tinted as it is typed (`useExpressionField`). **The
 * filter is temporary**: kept per tab in memory (`list-widget-store
 * .reviewFilters`), never written to the layout, gone with a reload.
 *
 * A click on the field (or a focus while it is empty) lists people, tags and
 * statuses with their open tasks; bare letters match all three; `@ # ! /`
 * open the expression field's popup (`services/review-field`). A pick writes
 * the name's token, joined to a whole term before it by `or` (the same sort)
 * or `and`. ⏎ in a list of matches takes the first; ⏎ elsewhere settles the
 * text. A text that doesn't read shows its error under the field and is
 * never written — the queue keeps the last filter that read; Esc puts that
 * text back (and, with nothing to put back, leaves the field). × clears it.
 *
 * At its end, while the filter names only people (`@A`, `@A or @B`) and only
 * on desktop: Email check-in (one person: theirs at once; several: a menu of
 * them) and Paste reply (the reply import, which reads the person from the
 * reply). `trailing` follows (the progress and the lens switch, in a cell of
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
  const predicate = useMemo<TodoPredicate>(() => (filter ? reviewFilterPredicate(filter) : emptyPredicate()), [filter])
  const onChange = useCallback((next: TodoPredicate) => {
    useListWidgetStore.getState().setReviewFilter(tabId, next.expression ? { expression: next.expression, showCompleted: next.showCompleted } : null)
  }, [tabId])

  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const reads = useMemo(() => {
    const names = expressionResolver(people, tags, statuses)
    return (text: string) => parseExpression(text, { today: startOfToday(), names }).ok
  }, [people, tags, statuses])
  const counts = useReviewFieldCounts()
  /** The field was clicked (or focused while empty): an empty place for a term lists everything. Typing disarms it. */
  const browse = useRef(false)
  const autocomplete = useCallback<typeof computeAutocomplete>(
    (value, cursor, sources) => reviewFieldAutocomplete(value, cursor, sources, { counts, browse: browse.current, reads }),
    [counts, reads],
  )
  const field = useExpressionField({ predicate, onChange, inputRef, autocomplete })
  const { text, parse, tints, ac } = field
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
  useLayoutEffect(() => { fitHeight() }, [text, fitHeight])
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
    const next = reviewFieldPick(input.value, view.from, view.to, row.item, reads)
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
    inputRef.current?.focus()
  }

  const isMobile = useIsMobile()
  const checkinIds = isMobile ? null : peopleOnly(filter?.expression)

  return (
    <div className={styles.fieldRow} data-prompt-row="" data-testid="review-field-row">
      <div className={styles.fieldLine}>
        <div className={`${styles.field} ${error ? styles.fieldError : ''}`}>
          <div className={styles.fieldText}>
            <div ref={mirrorRef} className={styles.mirror} aria-hidden="true">
              <TintedText text={text} spans={tints} />
            </div>
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={text}
              placeholder={REVIEW_FIELD_PLACEHOLDER}
              aria-label="Review filter"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
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
              onFocus={(e) => { if (e.currentTarget.value === '') openList(e.currentTarget) }}
              onScroll={syncMirror}
              onBlur={() => {
                browse.current = false
                field.onBlur()
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {text !== '' && (
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
 * Email check-in and Paste reply at the field's end (J9): one person — Email
 * sends theirs at once (`sendPersonCheckin`: the dialog instead when it
 * can't) and Paste reply opens the reply import for them; several — Email
 * opens a menu of them, and Paste reply the import (the reply names its
 * person).
 */
function CheckinButtons({ personIds }: { personIds: readonly number[] }) {
  const people = usePersonStore((s) => s.people)
  const named = personIds.flatMap((id) => {
    const p = people.find((x) => x.id === id)
    return p ? [{ id, name: p.name }] : []
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const emailRef = useRef<HTMLButtonElement>(null)
  const [only] = named
  const one = named.length === 1 ? only : undefined
  const emailTip = useTooltip(one ? `Email check-in to ${one.name}` : 'Email check-in')
  const replyTip = useTooltip(one ? `Paste reply from ${one.name}…` : 'Paste reply…')
  if (!only) return null
  const entries: MenuEntry[] = named.map((p) => ({
    kind: 'item',
    label: `Email check-in to ${p.name}`,
    icon: <EnvelopeIcon />,
    onSelect: () => { void sendPersonCheckin(p.id) },
  }))
  return (
    <>
      <button
        ref={emailRef}
        type="button"
        className={styles.checkinButton}
        aria-label="Email check-in"
        aria-haspopup={one ? undefined : 'menu'}
        aria-expanded={one ? undefined : menuOpen}
        data-testid="review-email-checkin"
        {...emailTip.triggerProps}
        // Inside the click: the clipboard write needs the gesture.
        onClick={() => { if (one) void sendPersonCheckin(one.id); else setMenuOpen((o) => !o) }}
      >
        <EnvelopeIcon size={15} />
      </button>
      {emailTip.tooltip}
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
      {menuOpen && (
        <MenuPopover anchorRef={emailRef} entries={entries} label="Email check-in" width={220} onClose={() => setMenuOpen(false)} />
      )}
    </>
  )
}
