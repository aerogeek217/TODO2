import { useState, useCallback, useEffect, useRef } from 'react'
import { useLatestRef } from './use-latest-ref'
import { registerModuleReset } from '../utils/module-reset'
import { newTaskFollowupInterval, useSettingsStore } from '../stores/settings-store'
import {
  applyAutocompletePick,
  bestMatchCompletion,
  carrySelection,
  computeAutocomplete,
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
  /** The active row (↑/↓ move it, no wrap). */
  selectedIndex: number
  /** ↑/↓ moved the active row in this list (with `enterSubmits`, ⏎ then picks it). */
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
 * render `NlpPopup` with `state`. While the popup is open Tab picks the
 * active row; ⏎ picks it too — or, with `enterSubmits`, only after ↑/↓
 * moved it, and otherwise goes to the host, which submits
 * `completeForSubmit(value)` (the half-typed token completed to its best
 * match).
 */
export function useNlpAutocomplete({ people, tags = NO_ITEMS, statuses = NO_ITEMS, commands = false, enterSubmits = false, onApply }: UseNlpAutocompleteOptions) {
  const [state, setState] = useState<AutocompleteState>(initialState)
  /** The text the popup was last computed for (re-read when the candidates change). */
  const lastInputRef = useRef<{ value: string; cursor: number; input: TextInput | null } | null>(null)
  const followupDefault = useSettingsStore(newTaskFollowupInterval)
  const onApplyRef = useLatestRef(onApply)

  const dismiss = useCallback(() => setState(initialState), [])

  const handleInputChange = useCallback((value: string, cursor: number, input: TextInput | null) => {
    lastInputRef.current = { value, cursor, input }
    const view = computeAutocomplete(value, cursor, {
      people, tags, statuses, commands, followupDefault, today: new Date(),
    })
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
  }, [people, tags, statuses, commands, followupDefault])

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
  }, [state.view, handleInputChange, dismiss, onApplyRef])

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

  /** `value` with the token the popup is open on completed to its best match (unchanged when it's closed). */
  const completeForSubmit = useCallback((value: string): string => (
    state.visible && state.view ? bestMatchCompletion(value, state.view) : value
  ), [state.visible, state.view])

  return { state, handleInputChange, handleKeyDown, select, dismiss, completeForSubmit }
}
