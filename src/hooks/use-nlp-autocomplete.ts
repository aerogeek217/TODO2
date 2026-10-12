import { useState, useCallback } from 'react'
import { useLatestRef } from './use-latest-ref'
import { useSettingsStore } from '../stores/settings-store'
import {
  applyAutocompletePick,
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
  /** Left offset of the trigger character within the input, for anchoring. */
  caretLeft: number
}

const initialState: AutocompleteState = { visible: false, view: null, selectedIndex: 0, caretLeft: 0 }

type TextInput = HTMLInputElement | HTMLTextAreaElement

interface UseNlpAutocompleteOptions {
  people: AutocompleteItem[]
  tags?: AutocompleteItem[]
  /** Statuses in Settings order (the `/status` argument). */
  statuses?: AutocompleteItem[]
  /** `/` opens the slash-command menu (task text that is parsed on create). */
  commands?: boolean
  /** Writes a pick into the input: set the value, then put the caret at `cursor`. */
  onApply: (value: string, cursor: number) => void
}

// Shared canvas for text measurement — avoids creating one per keystroke
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

/** Pixel offset of `value[0, index)` in `input`'s font, clamped to the input. */
function measureCaretLeft(input: TextInput | null, value: string, index: number): number {
  if (!input) return 0
  const style = getComputedStyle(input)
  const ctx = measureCanvas?.getContext('2d')
  if (!ctx) return 0
  ctx.font = `${style.fontSize} ${style.fontFamily}`
  const left = ctx.measureText(value.slice(0, index)).width - input.scrollLeft
  return Math.max(0, Math.min(left, input.offsetWidth - 200))
}

/**
 * The `@ # /` autocomplete popup for a React text input: wraps the pure
 * `services/nlp-autocomplete` with popup state, caret anchoring and keys.
 * Hosts call `handleInputChange` on every change, route keydown through
 * `handleKeyDown` (true = consumed: prevent default, stop propagation — while
 * the popup is open ⏎ never submits), and render `NlpPopup` with `state`.
 */
export function useNlpAutocomplete({ people, tags = [], statuses = [], commands = false, onApply }: UseNlpAutocompleteOptions) {
  const [state, setState] = useState<AutocompleteState>(initialState)
  const followupDefault = useSettingsStore((s) => s.followupDefaultInterval)
  const onApplyRef = useLatestRef(onApply)

  const dismiss = useCallback(() => setState(initialState), [])

  const handleInputChange = useCallback((value: string, cursor: number, input: TextInput | null) => {
    const view = computeAutocomplete(value, cursor, {
      people, tags, statuses, commands, followupDefault, today: new Date(),
    })
    if (!isVisible(view)) {
      setState((s) => (s.visible ? initialState : s))
      return
    }
    setState((s) => ({
      visible: true,
      view,
      selectedIndex: carrySelection(s.view, s.selectedIndex, view),
      caretLeft: measureCaretLeft(input, value, view.anchor),
    }))
  }, [people, tags, statuses, commands, followupDefault])

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
      setState((s) => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, Math.max(0, rows.length - 1)) }))
      return true
    }
    if (e.key === 'ArrowUp') {
      setState((s) => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const row = rows[state.selectedIndex]
      if (isSelectable(row) && row) select(row, input)
      return true // never submits while open
    }
    if (e.key === 'Escape') {
      dismiss()
      return true
    }
    return false
  }, [state.visible, state.view, state.selectedIndex, select, dismiss])

  return { state, handleInputChange, handleKeyDown, select, dismiss }
}
