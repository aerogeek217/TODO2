import { useState, useCallback, useEffect, useRef } from 'react'
import { useLatestRef } from './use-latest-ref'
import { registerModuleReset } from '../utils/module-reset'
import { autoFollowupInterval, useSettingsStore } from '../stores/settings-store'
import { useUndoStore } from '../stores/undo-store'
import { createNlpEntity } from '../services/nlp-create'
import {
  applyAutocompletePick,
  bestMatchCompletion,
  carrySelection,
  computeAutocomplete,
  implicitAccept,
  isSelectable,
  isVisible,
  type AutocompleteItem,
  type AutocompleteRow,
  type AutocompleteView,
} from '../services/nlp-autocomplete'

export { NLP_TRIGGERS, type NlpTrigger, type AutocompleteItem, type AutocompleteRow } from '../services/nlp-autocomplete'

export interface AutocompleteState {
  visible: boolean
  view: AutocompleteView | null
  /** The highlighted row (↑/↓ and the pointer move it, no wrap). */
  selectedIndex: number
  /** ↑/↓ moved the highlighted row in this list (with `enterSubmits`, ⏎ then picks it). */
  navigated: boolean
  /** Left offset of the trigger character within the input, for anchoring. */
  caretLeft: number
}

const initialState: AutocompleteState = { visible: false, view: null, selectedIndex: 0, navigated: false, caretLeft: 0 }
const NO_ITEMS: AutocompleteItem[] = []

type TextInput = HTMLInputElement | HTMLTextAreaElement

interface UseNlpAutocompleteOptions {
  people: AutocompleteItem[]
  tags?: AutocompleteItem[]
  /** Statuses in Settings order (the `/status` argument). */
  statuses?: AutocompleteItem[]
  /** `/` opens the slash-command menu (task text that is parsed on create). */
  commands?: boolean
  /**
   * ⏎ belongs to the host unless ↑/↓ moved the active row: `handleKeyDown`
   * leaves it unconsumed, and the host submits `completeForSubmit(value)`.
   * Off: ⏎ always picks while the popup is open.
   */
  enterSubmits?: boolean
  /** Writes a pick into the input: set the value, then put the caret at `cursor`. */
  onApply: (value: string, cursor: number) => void
  /** A picked create row: makes the person / tag (default: the stores, `services/nlp-create`). */
  onCreate?: (trigger: '@' | '#', name: string) => Promise<void>
}

/** The text-measuring context, made once (`null` where there is no canvas); `undefined` = not made yet. */
let measureContext: CanvasRenderingContext2D | null | undefined
registerModuleReset(() => { measureContext = undefined })

function caretMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return measureContext
}

/** Pixel offset of `value[0, index)` in `input`'s font, clamped to the input. */
function measureCaretLeft(input: TextInput | null, value: string, index: number): number {
  if (!input) return 0
  const ctx = caretMeasureContext()
  if (!ctx) return 0
  const style = getComputedStyle(input)
  ctx.font = `${style.fontSize} ${style.fontFamily}`
  const left = ctx.measureText(value.slice(0, index)).width - input.scrollLeft
  return Math.max(0, Math.min(left, input.offsetWidth - 200))
}

/**
 * The `@ # /` autocomplete popup for a React text input: wraps the pure
 * `services/nlp-autocomplete` with popup state, caret anchoring and keys.
 * Hosts call `handleInputChange` on every change, route keydown through
 * `handleKeyDown` (true = consumed: prevent default, stop propagation), and
 * render `NlpPopup` with `state` (its `onHighlight` → `highlight`). While
 * the popup is open Tab picks the highlighted row; ⏎ picks it too — or, with
 * `enterSubmits`, only after ↑/↓ moved it, and otherwise goes to the host,
 * which submits `completeForSubmit(value)` (the half-typed token completed to
 * the highlighted row) once `whenCreated()` resolves. A picked Create row
 * makes the person / tag at once (`onCreate`); typing on never creates. Typing on past an `@` / `#` token without picking (a
 * space, punctuation, the caret moved off it) completes it to the
 * highlighted person / tag when that is an exact, initials or prefix match (`implicitAccept`).
 */
export function useNlpAutocomplete({
  people, tags = NO_ITEMS, statuses = NO_ITEMS, commands = false, enterSubmits = false, onApply, onCreate = createNlpEntity,
}: UseNlpAutocompleteOptions) {
  const [state, setState] = useState<AutocompleteState>(initialState)
  /** The text the popup was last computed for (re-read when the candidates change). */
  const lastInputRef = useRef<{ value: string; cursor: number; input: TextInput | null } | null>(null)
  const followupDefault = useSettingsStore(autoFollowupInterval)
  const onApplyRef = useLatestRef(onApply)
  const onCreateRef = useLatestRef(onCreate)
  const stateRef = useLatestRef(state)
  /** The creates picked and still being saved (a submit waits for them: `whenCreated`). */
  const creatingRef = useRef<Promise<void>>(Promise.resolve())
  const pendingCreatesRef = useRef(0)

  const dismiss = useCallback(() => setState(initialState), [])

  const handleInputChange = useCallback((typedValue: string, typedCursor: number, input: TextInput | null) => {
    const sources = { people, tags, statuses, commands, followupDefault, today: new Date() }
    const prev = lastInputRef.current
    const open = stateRef.current
    let value = typedValue
    let cursor = typedCursor
    let view = computeAutocomplete(value, cursor, sources)
    // Typed on past an `@` / `#` token without picking: the highlighted person / tag.
    if (prev && open.visible && open.view) {
      const done = implicitAccept({ value: prev.value, view: open.view, index: open.selectedIndex }, value, cursor, view)
      if (done) {
        value = done.value
        cursor = done.cursor
        onApplyRef.current(value, cursor)
        view = computeAutocomplete(value, cursor, sources)
      }
    }
    lastInputRef.current = { value, cursor, input }
    if (!isVisible(view)) {
      setState((s) => (s.visible ? initialState : s))
      return
    }
    setState((s) => {
      // The same list narrowing keeps the active row and how it got there.
      const sameList = s.view?.mode === view.mode && s.view.anchor === view.anchor
      return {
        visible: true,
        view,
        selectedIndex: carrySelection(s.view, s.selectedIndex, view),
        navigated: sameList && s.navigated,
        caretLeft: measureCaretLeft(input, value, view.anchor),
      }
    })
  }, [people, tags, statuses, commands, followupDefault, stateRef, onApplyRef])

  // The candidates changed (a person renamed or deleted from a row's menu):
  // an open popup shows the new rows at once.
  const visibleRef = useLatestRef(state.visible)
  useEffect(() => {
    const last = lastInputRef.current
    if (last && visibleRef.current) handleInputChange(last.value, last.cursor, last.input)
  }, [handleInputChange, visibleRef])

  const select = useCallback((row: AutocompleteRow, input: TextInput | null) => {
    const view = state.view
    if (!view || !input) return
    const pick = applyAutocompletePick(input.value, view, row)
    if (!pick) return
    onApplyRef.current(pick.value, pick.cursor)
    if (pick.reopen) handleInputChange(pick.value, pick.cursor, input)
    else dismiss()
    // A picked Create row makes the person / tag now, so the token resolves to it.
    if (row.kind === 'create') {
      pendingCreatesRef.current++
      const made = onCreateRef.current(row.trigger, row.name).catch((err: unknown) => {
        useUndoStore.getState().notify(err instanceof Error ? err.message : String(err))
      }).finally(() => { pendingCreatesRef.current-- })
      creatingRef.current = Promise.all([creatingRef.current, made]).then(() => undefined)
    }
  }, [state.view, handleInputChange, dismiss, onApplyRef, onCreateRef])

  /** Resolves once every Create row picked so far is saved (or failed). */
  const whenCreated = useCallback(() => creatingRef.current, [])
  /** Whether a picked Create row is still being saved. */
  const creating = useCallback(() => pendingCreatesRef.current > 0, [])

  /** Keys while the popup is open. Returns true when the key was consumed. */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<TextInput>, input: TextInput | null): boolean => {
    if (!state.visible || !state.view) return false
    const rows = state.view.rows
    if (e.key === 'ArrowDown') {
      setState((s) => ({ ...s, navigated: true, selectedIndex: Math.min(s.selectedIndex + 1, Math.max(0, rows.length - 1)) }))
      return true
    }
    if (e.key === 'ArrowUp') {
      setState((s) => ({ ...s, navigated: true, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
      return true
    }
    if (e.key === 'Enter' && enterSubmits && !state.navigated) return false
    if (e.key === 'Enter' || e.key === 'Tab') {
      const row = rows[state.selectedIndex]
      if (isSelectable(row) && row) select(row, input)
      return true
    }
    if (e.key === 'Escape') {
      dismiss()
      return true
    }
    return false
  }, [state.visible, state.view, state.selectedIndex, state.navigated, enterSubmits, select, dismiss])

  /** `value` with the token the popup is open on completed to the highlighted row (unchanged when it's closed). */
  const completeForSubmit = useCallback((value: string): string => (
    state.visible && state.view ? bestMatchCompletion(value, state.view, state.selectedIndex) : value
  ), [state.visible, state.view, state.selectedIndex])

  /** The pointer moved over row `index`: it becomes the highlighted row. */
  const highlight = useCallback((index: number) => {
    setState((s) => (s.view && isSelectable(s.view.rows[index]) ? { ...s, selectedIndex: index } : s))
  }, [])

  return { state, handleInputChange, handleKeyDown, select, dismiss, completeForSubmit, highlight, whenCreated, creating }
}
