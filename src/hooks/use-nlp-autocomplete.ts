import { useState, useCallback, useRef, useEffect } from 'react'

export interface AutocompleteItem {
  id: number
  name: string
  color?: string
  kind: 'person' | 'org' | 'tag' | 'project'
}

export interface AutocompleteState {
  visible: boolean
  trigger: '@' | '#' | '/' | null
  query: string
  items: AutocompleteItem[]
  selectedIndex: number
  /** Position relative to the input element */
  caretLeft: number
}

const initialState: AutocompleteState = {
  visible: false,
  trigger: null,
  query: '',
  items: [],
  selectedIndex: 0,
  caretLeft: 0,
}

interface UseNlpAutocompleteOptions {
  people: AutocompleteItem[]
  tags: AutocompleteItem[]
  projects?: AutocompleteItem[]
  orgs?: AutocompleteItem[]
}

/**
 * Hook for @person and #tag autocomplete in input fields.
 * Returns state and handlers to wire into an input element.
 */
// Shared canvas for text measurement — avoids creating one per keystroke
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

export function useNlpAutocomplete({ people, tags, projects = [], orgs = [] }: UseNlpAutocompleteOptions) {
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
    // Look backwards for @ or # that isn't preceded by a word character
    let triggerIdx = -1
    let triggerChar: '@' | '#' | '/' | null = null
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      const ch = beforeCursor[i]
      if (ch === ' ' || ch === '\t' || ch === '\n') break // whitespace before finding trigger = no trigger
      if ((ch === '@' || ch === '#' || ch === '/') && (i === 0 || /\s/.test(beforeCursor[i - 1]))) {
        triggerIdx = i
        triggerChar = ch as '@' | '#' | '/'
        break
      }
    }

    if (triggerChar === null || triggerIdx === -1) {
      if (state.visible) dismiss()
      return
    }

    const query = beforeCursor.slice(triggerIdx + 1).toLowerCase()
    triggerPosRef.current = triggerIdx

    const sourceItems = triggerChar === '@' ? [...people, ...orgs] : triggerChar === '#' ? tags : projects
    const filtered = query
      ? sourceItems.filter((item) => item.name.toLowerCase().includes(query))
      : sourceItems

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

    setState({
      visible: filtered.length > 0,
      trigger: triggerChar,
      query,
      items: filtered.slice(0, 8),
      selectedIndex: 0,
      caretLeft,
    })
  }, [people, tags, projects, orgs, state.visible, dismiss])

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
    }
    if (e.key === 'Escape') {
      dismiss()
      return true
    }
    return false
  }, [state.visible, state.items.length, dismiss])

  /**
   * Apply the selected autocomplete item into the input value.
   * Returns the new input value and cursor position.
   */
  const applySelection = useCallback((
    currentValue: string,
    cursorPos: number,
    item?: AutocompleteItem,
  ): { value: string; cursor: number } | null => {
    const selected = item ?? state.items[state.selectedIndex]
    if (!selected || triggerPosRef.current === -1) return null

    const triggerIdx = triggerPosRef.current
    // Replace from trigger char through current cursor position with the selected name + space
    const before = currentValue.slice(0, triggerIdx)
    const after = currentValue.slice(cursorPos)
    const trigger = state.trigger
    const name = selected.name.includes(' ') ? `"${selected.name}"` : selected.name
    const newValue = `${before}${trigger}${name} ${after}`
    const newCursor = before.length + 1 + name.length + 1 // trigger + name + space

    dismiss()
    return { value: newValue, cursor: newCursor }
  }, [state.items, state.selectedIndex, state.trigger, dismiss])

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
