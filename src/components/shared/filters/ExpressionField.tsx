import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FilterAtom, FilterExpr, TodoPredicate } from '../../../models'
import { EXPRESSION_WRITE_MS, useExpressionField } from '../../../hooks/use-expression-field'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { mirrorCharX, useNlpPopupAnchor } from '../../../hooks/use-nlp-popup-anchor'
import { describeDateMatch } from '../../../utils/filter-chips'
import { topLevelTerms, type ExpressionNames } from '../../../utils/filter-expression'
import { completedOnlyInside } from '../../../utils/predicate-expression'
import { DATE_FIELD_LABELS_SHORT, NO_STATUS_LABEL, NO_TAGS_LABEL, UNASSIGNED_LABEL } from '../../../utils/filter-labels'
import { MARKER_LABELS } from '../../../utils/markers'
import { NlpPopup } from '../NlpPopup'
import { TintedText } from '../TintedText'
import { useTooltip } from '../use-tooltip'
import { ExpressionSyntaxModal } from './ExpressionSyntaxModal'
import { useReportExpressionField } from './expression-report'
import styles from './ExpressionField.module.css'

/** Line height of the field (px) and how many lines it grows to before it scrolls. */
const LINE_PX = 20
const MAX_LINES = 6

interface ExpressionFieldProps {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  /** `false`: no `@` terms (the check-in filter). */
  allowPeople?: boolean
  /** `false`: no Completed dates (the check-in filter). */
  allowCompleted?: boolean
  /** `false`: no `done` (a lens, a pane, the check-in: they never show completed tasks by it). */
  allowDone?: boolean
  /** Focus the field when it mounts (the switch to Expression). */
  autoFocus?: boolean
}

/**
 * A filter typed as an expression (`TodoPredicate.expression`): a textarea
 * over its tint mirror (Quick Add's), Quick Add's `@ # ! /` popup, the error
 * under it (its span ringed in the text, its hint as the message's tooltip),
 * a Reads as preview of the top-level terms (Keep, or Drop for a `not`
 * term), and Syntax… for the cheat sheet. Writes go through
 * `useExpressionField`: a text that doesn't read is never written.
 */
export function ExpressionField({ predicate, onChange, allowPeople = true, allowCompleted = true, allowDone = true, autoFocus = false }: ExpressionFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const errorId = useId()
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  const field = useExpressionField({ predicate, onChange, inputRef, allowPeople, allowCompleted, allowDone })
  const { text, parse, tints, ac, closeHeld } = field
  useReportExpressionField({ pending: field.unsettled, unreadable: field.unreadable })
  const error = parse.ok ? null : parse.error
  const errorTip = useTooltip(error?.hint ?? null)

  // The live region is always there, and takes its text once typing rests:
  // one inserted with its text, or changed on every keystroke, is announced
  // unreliably (cr33 U10). A held close is said at once.
  const message = closeHeld ? `${error?.message ?? ''}. ${CLOSE_HELD}` : error?.message ?? ''
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(message), EXPRESSION_WRITE_MS)
    return () => clearTimeout(t)
  }, [message])
  const live = closeHeld ? message : announced


  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const syncMirror = useCallback(() => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollTop = inputRef.current.scrollTop
  }, [])
  // The field wraps and grows with its text, up to `MAX_LINES` (then it scrolls).
  const fitHeight = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, LINE_PX), MAX_LINES * LINE_PX)}px`
    syncMirror()
  }, [syncMirror])
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
  }, [fitHeight])

  const anchorIndex = ac.state.view?.anchor ?? null
  const caretX = useCallback(
    () => (mirrorRef.current && anchorIndex != null ? mirrorCharX(mirrorRef.current, anchorIndex) : null),
    [anchorIndex],
  )
  const { popupRef, setPopupEl, style: popupStyle } = useNlpPopupAnchor(inputRef, ac.state, { x: caretX, key: text })

  // The first press outside while the text doesn't read is held (its click
  // swallowed, the focus kept here), saying so; the next goes through (U5).
  const rootRef = useRef<HTMLDivElement>(null)
  const holdRef = useLatestRef(field.holdClose)
  const syntaxOpenRef = useLatestRef(syntaxOpen)
  useEffect(() => {
    let held = false
    const outside = (t: EventTarget | null) => t instanceof Node && !rootRef.current?.contains(t) && !popupRef.current?.contains(t)
    const press = (e: Event) => {
      if (!held && (syntaxOpenRef.current || !outside(e.target) || !holdRef.current())) return
      held = true
      if (e.type === 'mousedown') e.preventDefault()
      e.stopPropagation()
    }
    const click = (e: MouseEvent) => {
      if (!held) return
      held = false
      if (!outside(e.target)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('mousedown', press, true)
    window.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('mousedown', press, true)
      window.removeEventListener('click', click, true)
    }
  }, [holdRef, syntaxOpenRef, popupRef])

  return (
    <div ref={rootRef} className={styles.root} data-testid="expression-field">
      <div className={`${styles.field} ${error ? styles.fieldError : ''}`}>
        <div ref={mirrorRef} className={styles.mirror} aria-hidden="true">
          <TintedText text={text} spans={tints} />
        </div>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={text}
          placeholder={'/focus or (@Aisha and "budget")'}
          aria-label="Filter expression"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          spellCheck={false}
          onChange={(e) => field.onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)}
          onSelect={(e) => {
            syncMirror()
            field.onSelect(e.currentTarget)
          }}
          onScroll={syncMirror}
          onBlur={field.onBlur}
          onKeyDown={(e) => {
            if (field.onKeyDown(e)) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        />
      </div>
      <div className={styles.under}>
        {error ? (
          <span id={errorId} className={styles.error} data-testid="expression-error" {...errorTip.triggerProps}>
            {error.message}
            {closeHeld && <span className={styles.held}> — {CLOSE_HELD}</span>}
            {errorTip.tooltip}
          </span>
        ) : <span />}
        <span className={styles.announce} aria-live="polite" data-testid="expression-announce">{live}</span>
        <button type="button" className={styles.syntax} onClick={() => setSyntaxOpen(true)}>Syntax…</button>
      </div>
      {parse.ok && parse.expression && <ReadsAs expression={parse.expression} names={field.names} />}
      {parse.ok && parse.showCompleted && <p className={styles.done}>Completed tasks too</p>}
      {parse.ok && parse.expression && completedOnlyInside(parse.expression, parse.showCompleted) && (
        <p className={styles.done} data-testid="expression-completed-hint">{allowDone ? COMPLETED_HINT_DONE : COMPLETED_HINT}</p>
      )}
      {ac.state.visible && ac.state.view && createPortal(
        <NlpPopup
          view={ac.state.view}
          selectedIndex={ac.state.selectedIndex}
          onPick={(row) => ac.select(row, inputRef.current)}
          onHighlight={ac.highlight}
          popupRef={setPopupEl}
          className={styles.popup}
          style={popupStyle}
        />,
        document.body,
      )}
      {syntaxOpen && <ExpressionSyntaxModal onClose={() => setSyntaxOpen(false)} />}
    </div>
  )
}

/** The close held once for a text that doesn't read (U5). */
export const CLOSE_HELD = 'This doesn’t read, so it isn’t saved — close again to drop it'

/** A Completed date inside an `or` / `not` keeps no open task, and completed tasks aren't let in (cr33 F10). */
export const COMPLETED_HINT_DONE = 'A Completed date inside or / not matches completed tasks only — add “and done” to show them'
export const COMPLETED_HINT = 'A Completed date inside or / not matches completed tasks only; one of its own (… and completed …) lets them in'

// ── Reads as ────────────────────────────────────────────────────────────────

/** One atom as a chip's label and value: `People Aisha`, `Due within the next 3 days`. */
function atomChip(a: FilterAtom, names: ExpressionNames): { label: string; value: string } {
  switch (a.kind) {
    case 'person': return { label: 'People', value: a.id === 0 ? UNASSIGNED_LABEL : names.person(a.id) ?? 'deleted person' }
    case 'tag': return { label: 'Tags', value: a.id === 0 ? NO_TAGS_LABEL : names.tag(a.id) ?? 'deleted tag' }
    case 'status': return { label: 'Status', value: a.id === 0 ? NO_STATUS_LABEL : names.status(a.id) ?? 'deleted status' }
    case 'priority': return { label: 'Priority', value: a.value === 'none' ? 'No priority' : MARKER_LABELS[a.value] }
    case 'text': return { label: 'Text', value: `“${a.text}”` }
    case 'date': return { label: DATE_FIELD_LABELS_SHORT[a.field], value: describeDateMatch(a.match, a.field) }
  }
}

/** A term as chips joined by its words: `Priority Focus or ( Priority Important and Priority Urgent )`. */
function termPieces(e: FilterExpr, names: ExpressionNames, nested: boolean): ReactNode {
  switch (e.kind) {
    case 'and':
    case 'or': {
      const inner = e.items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={styles.word}>{e.kind}</span>}
          {termPieces(item, names, true)}
        </Fragment>
      ))
      return nested ? <><span className={styles.word}>(</span>{inner}<span className={styles.word}>)</span></> : inner
    }
    case 'not':
      return <><span className={styles.word}>not</span>{termPieces(e.item, names, true)}</>
    default: {
      const chip = atomChip(e, names)
      return <span className={styles.chip}>{chip.label} <span className={styles.chipValue}>{chip.value}</span></span>
    }
  }
}

/** The expression's top-level terms, each a row: Keep (what a task must match) or Drop (a `not` term: what it mustn't). */
function ReadsAs({ expression, names }: { expression: FilterExpr; names: ExpressionNames }) {
  return (
    <div className={styles.readsAs} aria-label="Reads as" role="group" data-testid="expression-reads-as">
      {topLevelTerms(expression).map((term, i) => {
        const drop = term.kind === 'not'
        return (
          <div key={i} className={styles.readsRow}>
            <span className={drop ? styles.drop : styles.keep}>{drop ? 'Drop' : 'Keep'}</span>
            <span className={styles.pieces}>{termPieces(drop ? term.item : term, names, false)}</span>
          </div>
        )
      })}
    </div>
  )
}
