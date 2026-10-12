import { useState, useCallback, useRef, useEffect } from 'react'

/** Trigger characters that open the NLP autocomplete dropdown. */
export const NLP_TRIGGERS = ['@', '#', ':'] as const
export type NlpTrigger = (typeof NLP_TRIGGERS)[number]

const NLP_TRIGGER_SET = new Set<string>(NLP_TRIGGERS)

export interface AutocompleteItem {
  id: number
  name: string
  color?: string
  /** People: an exact initials match counts too (as the resolver does). */
  initials?: string
  kind: 'person' | 'tag' | 'status'
}

export interface AutocompleteState {
  visible: boolean
  trigger: NlpTrigger | null
  /** Lowercased text after the trigger. */
  query: string
  /** The text after the trigger as typed (the create row shows it). */
  rawQuery: string
  /** Nothing matches the query: the popup offers to create the `#tag` /
   * `@person` (inserted as a token; created when the task is). */
  createNew: boolean
  items: AutocompleteItem[]
  selectedIndex: number
  /** Position relative to the input element */
  caretLeft: number
}

const initialState: AutocompleteState = {
  visible: false,
  trigger: null,
  query: '',
  rawQuery: '',
  createNew: false,
  items: [],
  selectedIndex: 0,
  caretLeft: 0,
}

interface UseNlpAutocompleteOptions {
  people: AutocompleteItem[]
  tags?: AutocompleteItem[]
  statuses?: AutocompleteItem[]
}

/**
 * Hook for @person autocomplete in input fields.
 * Returns state and handlers to wire into an input element.
 */
// Shared canvas for text measurement — avoids creating one per keystroke
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

export function useNlpAutocomplete({ people, tags = [], statuses = [] }: UseNlpAutocompleteOptions) {
  const [state, setState] = useState<AutocompleteState>(initialState)
  const triggerPosRef = useRef<number>(-1)

  const dismiss = useCallback(() => {
    setState(initialState)
    triggerPosRef.current = -1
  }, [])

  const handleInputChange = useCallback((
    value: string,
    cursorPos: number,
    inputEl: HTMLInputElement | HTMLTextAreaElement | null,
  ) => {
    // Find the trigger character before cursor
    const beforeCursor = value.slice(0, cursorPos)
    // Look backwards for @, #, or : that isn't preceded by a word character
    let triggerIdx = -1
    let triggerChar: NlpTrigger | null = null
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const ch = beforeCursor[i]
      if (ch === ' ' || ch === '\t' || ch === '\n') break // whitespace before finding trigger = no trigger
      if (ch !== undefined && NLP_TRIGGER_SET.has(ch) && (i === 0 || /\s/.test(beforeCursor[i - 1] ?? ''))) {
        triggerIdx = i
        triggerChar = ch as NlpTrigger
        break
      }
    }

    if (triggerChar === null || triggerIdx === -1) {
      if (state.visible) dismiss()
      return
    }

    const rawQuery = beforeCursor.slice(triggerIdx + 1)
    const query = rawQuery.toLowerCase()
    triggerPosRef.current = triggerIdx

    // `#tag` and `:status` use case-insensitive prefix match;
    // `@person` stays on substring match, plus an exact initials match; a
    // leading quote (`@"First Last"` being typed) is ignored for matching.
    let filtered: AutocompleteItem[]
    if (triggerChar === '#') {
      filtered = query
        ? tags.filter((item) => item.name.toLowerCase().startsWith(query))
        : tags
    } else if (triggerChar === ':') {
      filtered = query
        ? statuses.filter((item) => item.name.toLowerCase().startsWith(query))
        : statuses
    } else {
      const q = query.replace(/^"/, '')
      filtered = q
        ? people.filter((item) =>
          item.name.toLowerCase().includes(q) || item.initials?.toLowerCase() === q)
        : people
    }

    // Estimate caret position for dropdown positioning
    let caretLeft = 0
    if (inputEl) {
      // Approximate: use a cached canvas to measure text width up to trigger
      const style = getComputedStyle(inputEl)
      const ctx = measureCanvas?.getContext('2d')
      if (ctx) {
        ctx.font = `${style.fontSize} ${style.fontFamily}`
        caretLeft = ctx.measureText(value.slice(0, triggerIdx)).width
        // Clamp to input width
        const maxLeft = inputEl.offsetWidth - 200
        if (caretLeft > maxLeft) caretLeft = maxLeft
        if (caretLeft < 0) caretLeft = 0
      }
    }

    // With no matches, `#` and `@` stay visible to offer the create row
    // (`:` hides). Not while a quoted `@"First Last"` is being typed: it can't
    // be completed before the closing quote, so ⏎ mustn't insert it.
    const createNew = filtered.length === 0
      && query.length > 0
      && (triggerChar === '#' || (triggerChar === '@' && !query.startsWith('"')))
    const visible = filtered.length > 0 || createNew

    setState({
      visible,
      trigger: triggerChar,
      query,
      rawQuery,
      createNew,
      items: filtered.slice(0, 8),
      selectedIndex: 0,
      caretLeft,
    })
  }, [people, tags, statuses, state.visible, dismiss])

  /**
   * Handle keyboard events for autocomplete navigation.
   * Returns true if the event was consumed (caller should preventDefault/stopPropagation).
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!state.visible) return false

    if (e.key === 'ArrowDown') {
      setState((s) => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, s.items.length - 1) }))
      return true
    }
    if (e.key === 'ArrowUp') {
      setState((s) => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
      return true
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (state.items.length > 0) {
        return true // consumed — caller should call selectItem
      }
      // With no matches, Tab/Enter accepts the typed query as a create-new
      // completion (caller calls applySelection → create path).
      if (state.createNew) {
        return true
      }
    }
    if (e.key === 'Escape') {
      dismiss()
      return true
    }
    return false
  }, [state.visible, state.items.length, state.createNew, dismiss])

  /**
   * Apply the selected autocomplete item into the input value.
   * Returns the new input value and cursor position.
   */
  const applySelection = useCallback((
    currentValue: string,
    cursorPos: number,
    item?: AutocompleteItem,
  ): { value: string; cursor: number } | null => {
    if (triggerPosRef.current === -1) return null
    const triggerIdx = triggerPosRef.current

    const selected = item ?? state.items[state.selectedIndex]
    let name: string
    if (selected) {
      name = selected.name
    } else if (state.createNew) {
      // Create-new path: preserve the user's typed casing from the raw slice.
      name = currentValue.slice(triggerIdx + 1, cursorPos)
    } else {
      return null
    }

    // Tags / statuses stay bare — `#` and `:` patterns are single-word only;
    // people quote when the name contains spaces.
    const before = currentValue.slice(0, triggerIdx)
    const after = currentValue.slice(cursorPos)
    const trigger = state.trigger
    const isBareTrigger = state.trigger === '#' || state.trigger === ':'
    const token = isBareTrigger ? name : (name.includes(' ') ? `"${name}"` : name)
    const newValue = `${before}${trigger}${token} ${after}`
    const newCursor = before.length + 1 + token.length + 1 // trigger + name + space

    dismiss()
    return { value: newValue, cursor: newCursor }
  }, [state.items, state.selectedIndex, state.trigger, state.createNew, dismiss])

  // Clean up on unmount
  useEffect(() => {
    return () => { triggerPosRef.current = -1 }
  }, [])

  return {
    state,
    handleInputChange,
    handleKeyDown,
    applySelection,
    dismiss,
  }
}
