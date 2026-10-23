import { useCallback, useEffect, useRef, useState } from 'react'
import { SEARCH_DEBOUNCE_MS } from '../constants'
import { useFilterStore } from '../stores/filter-store'

/**
 * A search field over the screen filter's search text: what it shows (the
 * typed text at once) and the setter, which writes the store after a
 * debounce (a clear at once). The store's text changing elsewhere (cleared, typed in another
 * field) shows here.
 */
export function useScreenSearch(): [text: string, setText: (value: string) => void] {
  const storeText = useFilterStore((s) => s.filters.searchText)
  const [text, setLocalText] = useState(storeText)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setText = useCallback((value: string) => {
    setLocalText(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    // A clear (Esc, ×, emptied field) writes at once: the field may unmount
    // straight after (Esc again closes the task dialog), and a dropped clear
    // would leave every widget filtered by text no field shows.
    if (value === '') { useFilterStore.getState().setSearchText(''); return }
    debounceRef.current = setTimeout(() => useFilterStore.getState().setSearchText(value), SEARCH_DEBOUNCE_MS)
  }, [])

  // A pending debounce must not outlive the field: it would write a stale
  // query into the store after unmount (and a remounted field would pick it
  // up, replacing what the user typed since).
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // The store's text changed (typed here and debounced in, or changed
  // elsewhere): show it. Adjusted during render, not in an effect.
  const [shownStoreText, setShownStoreText] = useState(storeText)
  if (storeText !== shownStoreText) {
    setShownStoreText(storeText)
    setLocalText(storeText)
  }

  return [text, setText]
}
