import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TodoPredicate } from '../models'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { startOfToday } from '../utils/date'
import { expressionNamesOf } from '../utils/filter-chips'
import { parseExpression, printExpression, type ExpressionParse } from '../utils/filter-expression'
import { expressionsEqual } from '../utils/filter-expression'
import { withExpression } from '../utils/predicate-expression'
import { expressionAutocomplete, expressionResolver, expressionTints, namedIds } from '../services/filter-expression-field'
import { personItems, statusItems, tagItems, type computeAutocomplete } from '../services/nlp-autocomplete'
import type { TintSpan } from '../services/nlp-token-tints'
import { useNlpAutocomplete } from './use-nlp-autocomplete'
import { useLatestRef } from './use-latest-ref'

/** How long typing rests before a reading expression is written (one undo step where each write is one). */
export const EXPRESSION_WRITE_MS = 400

interface ExpressionFieldOptions {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  /** `false`: `@`, `no person` and `any person` are refused and `@` opens no popup (the check-in filter). */
  allowPeople?: boolean
  /** `false`: Completed dates are refused (the check-in filter). */
  allowCompleted?: boolean
  /** `false`: `done` is refused (filters that never show completed tasks by it: a lens, a pane, the check-in). */
  allowDone?: boolean
}

/**
 * The filter expression field's state: the text as typed, what it reads as
 * (`parseExpression`, names through Quick Add's resolver), its tints and
 * Quick Add's `@ # ! /` popup. A text that reads is written to the filter
 * once typing rests (`EXPRESSION_WRITE_MS`) and at once on blur / ⏎; one
 * that doesn't is never written — the filter keeps its last version that
 * read; the first press outside it (one that would close its editor) is
 * held then, saying so, and the next goes through (`holdClose`). On blur
 * the text that reads is shown in its canonical form (bare
 * words quoted, names in full). The filter changing elsewhere (undo, the
 * mode switch) shows here.
 *
 * Hosts render a textarea over `tints` (`shared/TintedText`), the popup with
 * `ac.state`, and route the textarea's change / select / keydown / blur here.
 */
export function useExpressionField({ predicate, onChange, inputRef, allowPeople = true, allowCompleted = true, allowDone = true }: ExpressionFieldOptions) {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const names = useMemo(() => expressionNamesOf({ people, tags, statuses }), [people, tags, statuses])
  // The ids the filter names win over a namesake (two people called Alex).
  const named = useMemo(() => namedIds(predicate.expression), [predicate.expression])
  const resolver = useMemo(() => expressionResolver(people, tags, statuses, named), [people, tags, statuses, named])

  const stored = printExpression(predicate.expression, predicate.showCompleted, names)
  const [text, setText] = useState(stored)
  const [syncedFrom, setSyncedFrom] = useState(stored)
  /** The canonical text of the filter this field last wrote (or is about to). */
  const [written, setWritten] = useState(stored)
  /** Counts the changes from elsewhere the field took up (a write still waiting is dropped after each). */
  const [adopted, setAdopted] = useState(0)
  // The filter changed: this field's own write arriving (the text stays as
  // typed), or a change from elsewhere, which the field then shows.
  if (stored !== syncedFrom) {
    setSyncedFrom(stored)
    if (stored !== written) {
      setWritten(stored)
      setText(stored)
      setAdopted((n) => n + 1)
    }
  }

  const parse: ExpressionParse = useMemo(
    () => parseExpression(text, { today: startOfToday(), names: resolver, allowPeople, allowCompleted, allowDone }),
    [text, resolver, allowPeople, allowCompleted, allowDone],
  )

  const predicateRef = useLatestRef(predicate)
  const onChangeRef = useLatestRef(onChange)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingWrite = useRef<(() => void) | null>(null)

  const flush = useCallback(() => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    const write = pendingWrite.current
    pendingWrite.current = null
    write?.()
  }, [])

  /** Queues `p`'s reading as the filter's (nothing when it reads as the filter already). */
  const queue = useCallback((p: ExpressionParse, now: boolean) => {
    if (!p.ok) {
      if (pending.current) clearTimeout(pending.current)
      pending.current = null
      pendingWrite.current = null
      return
    }
    const current = predicateRef.current
    // The same filter, or one that prints the same (`today` for a 0-day
    // offset, cr33 F4): nothing to write, so a focus and a blur change nothing.
    const same = p.showCompleted === current.showCompleted && (expressionsEqual(p.expression, current.expression)
      || printExpression(p.expression, false, names) === printExpression(current.expression, false, names))
    if (same) {
      pendingWrite.current = null
      return
    }
    setWritten(printExpression(p.expression, p.showCompleted, names))
    pendingWrite.current = () => onChangeRef.current(withExpression(predicateRef.current, p.expression, p.showCompleted))
    if (pending.current) clearTimeout(pending.current)
    pending.current = now ? null : setTimeout(flush, EXPRESSION_WRITE_MS)
    if (now) flush()
  }, [names, flush, predicateRef, onChangeRef])

  // A write still waiting when the field goes is made then.
  useEffect(() => flush, [flush])

  // A change from elsewhere (an undo, a Revert) landed while a write waited
  // out its pause: the field shows the change, so the write it would undo
  // goes (cr33 U13).
  useLayoutEffect(() => {
    if (adopted === 0) return
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    pendingWrite.current = null
  }, [adopted])

  /** Where the caret goes once the text has changed under it (a pick). */
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const caret = pendingCaret.current
    const input = inputRef.current
    if (caret == null || !input) return
    pendingCaret.current = null
    input.setSelectionRange(caret, caret)
  }, [text, inputRef])

  const setAndRead = useCallback((value: string) => {
    setText(value)
    queue(parseExpression(value, { today: startOfToday(), names: resolver, allowPeople, allowCompleted, allowDone }), false)
  }, [queue, resolver, allowPeople, allowCompleted, allowDone])

  const acPeople = useMemo(() => personItems(people), [people])
  const acTags = useMemo(() => tagItems(tags), [tags])
  const acStatuses = useMemo(() => statusItems(statuses), [statuses])
  // Stable, as the sources are: the popup re-reads its text whenever
  // `compute` changes (its candidates changed), so a new one each render
  // would re-render it forever while it is open.
  const compute = useCallback<typeof computeAutocomplete>(
    (value, cursor, sources) => expressionAutocomplete(value, cursor, sources, allowPeople),
    [allowPeople],
  )
  const ac = useNlpAutocomplete({
    people: acPeople,
    tags: acTags,
    statuses: acStatuses,
    commands: true,
    compute,
    onApply: (value, cursor) => {
      pendingCaret.current = cursor
      setAndRead(value)
    },
  })
  const { handleInputChange, dismiss } = ac

  const onTextChange = useCallback((raw: string, caret: number, input: HTMLTextAreaElement | null) => {
    // A pasted line break is a space (one character for one: the caret stays).
    const value = raw.replace(/[\r\n]/g, ' ')
    if (value !== raw) pendingCaret.current = caret
    setAndRead(value)
    handleInputChange(value, caret, input)
  }, [setAndRead, handleInputChange])

  const onSelect = useCallback((input: HTMLTextAreaElement) => {
    handleInputChange(input.value, input.selectionStart ?? input.value.length, input)
  }, [handleInputChange])

  /** Shows the text that reads in its canonical form, the filter written now. */
  const settle = useCallback(() => {
    const now = parseExpression(text, { today: startOfToday(), names: resolver, allowPeople, allowCompleted, allowDone })
    queue(now, true)
    if (now.ok) setText(printExpression(now.expression, now.showCompleted, names))
  }, [text, resolver, allowPeople, allowCompleted, allowDone, queue, names])

  const onBlur = useCallback(() => {
    dismiss()
    settle()
  }, [dismiss, settle])

  /** True when the key was the field's (its default prevented, so a dialog around it doesn't take Esc). */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (ac.handleKeyDown(e, e.currentTarget)) return true
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      settle()
      return true
    }
    if (e.key === 'Escape' && text !== stored) {
      // Esc puts back the filter's text (what doesn't read is dropped); with nothing to put back it reaches the host.
      e.preventDefault()
      if (pending.current) clearTimeout(pending.current)
      pending.current = null
      pendingWrite.current = null
      setWritten(stored)
      setText(stored)
      return true
    }
    return false
  }, [ac, settle, text, stored])

  // A text that doesn't read is dropped when the field goes. The first press
  // that would close its editor is held, saying so; the next one goes
  // through (the popover rule, ARCHITECTURE › Dismissing a popover; cr33 U5).
  const [heldFor, setHeldFor] = useState<string | null>(null)
  const unreadable = !parse.ok && text !== stored
  const closeHeld = unreadable && heldFor === text
  /** Holds a close once for the text that doesn't read: true when it held this one. */
  const holdClose = useCallback((): boolean => {
    if (!unreadable || heldFor === text) return false
    setHeldFor(text)
    return true
  }, [unreadable, heldFor, text])

  const view = ac.state.visible ? ac.state.view : null
  const tints: TintSpan[] = useMemo(
    () => expressionTints(parse.spans, parse.ok ? null : parse.error, view ? { start: view.anchor, end: view.to } : undefined),
    [parse, view],
  )

  return { text, parse, tints, names, ac, onTextChange, onSelect, onKeyDown, onBlur, closeHeld, holdClose }
}
