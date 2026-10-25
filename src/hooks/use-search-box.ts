import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { SEARCH_DEBOUNCE_MS } from '../constants'
import { useFilterStore } from '../stores/filter-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { startOfToday } from '../utils/date'
import { parseSearch, searchWords, takeTokens, type SearchParse, type SearchSources } from '../services/search-tokens'

interface SearchBoxOptions {
  inputRef: RefObject<HTMLInputElement | null>
  /** Writes the text search after a pause (the top bar), else at once (the phone sheet). A clear writes at once. */
  debounce?: boolean
}

export interface SearchBox {
  /** What the box shows. */
  text: string
  /** The box read through the search grammar (`services/search-tokens`). */
  parse: SearchParse
  /** The text search the box's words make (as typed, before the pause). */
  words: string
  /** The field changed: complete tokens become chips, the box keeps the other words. */
  onChange: (value: string, caret: number) => void
  /** ⏎ (every token becomes a chip) and Backspace in the empty box (the last chip the box made back as its token). True = consumed. */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => boolean
  /** Empties the box (Esc, ×); the chips stay. */
  clear: () => void
}

/**
 * A search box over the screen filter (D16): typed tokens become the tray's
 * chips as each completes (`filter-store.applySearchTokens`); the words left
 * are the text search, written to the store (`searchText`). The store's text
 * changing elsewhere (Clear all, another field) shows here.
 */
export function useSearchBox({ inputRef, debounce = true }: SearchBoxOptions): SearchBox {
  const storeText = useFilterStore((s) => s.filters.searchText)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const [text, setText] = useState(storeText)
  /** The text search this box last wrote (or is about to, after the pause). */
  const [written, setWritten] = useState(storeText)
  const [shownStoreText, setShownStoreText] = useState(storeText)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Where the caret goes once the box's text has changed under it. */
  const pendingCaretRef = useRef<number | null>(null)

  // The store's text changed: this box's own write arriving, or a change
  // from elsewhere, which the box then shows. Adjusted during render.
  if (storeText !== shownStoreText) {
    setShownStoreText(storeText)
    if (storeText !== written) {
      setText(storeText)
      setWritten(storeText)
    }
  }

  const sourcesNow = useCallback((): SearchSources => ({ people, tags, statuses, today: startOfToday() }), [people, tags, statuses])
  const parse = useMemo(() => parseSearch(text, sourcesNow()), [text, sourcesNow])
  const words = useMemo(() => searchWords(parse), [parse])

  const writeWords = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    setWritten(value)
    // A clear writes at once: the field may unmount straight after, and a
    // dropped clear would leave every widget filtered by text no field shows.
    if (value === '' || !debounce) {
      useFilterStore.getState().setSearchText(value)
      return
    }
    debounceRef.current = setTimeout(() => useFilterStore.getState().setSearchText(value), SEARCH_DEBOUNCE_MS)
  }, [debounce])

  // A pending write must not outlive the field (it would put a stale query in the store).
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  /** The box shows `value`, its complete tokens (with `all`, every token) made chips. */
  const commit = useCallback((value: string, caret: number, all = false) => {
    const sources = sourcesNow()
    const read = parseSearch(value, sources)
    const box = takeTokens(read, caret, all)
    if (box.taken.length > 0) useFilterStore.getState().applySearchTokens(box.taken)
    setText(box.text)
    if (box.text !== value) pendingCaretRef.current = box.caret
    writeWords(searchWords(box.taken.length > 0 ? parseSearch(box.text, sources) : read))
    return box
  }, [sourcesNow, writeWords])

  const onChange = useCallback((value: string, caret: number) => { commit(value, caret) }, [commit])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    const input = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const box = commit(input.value, input.selectionStart ?? input.value.length, true)
      return box.taken.length > 0
    }
    if (e.key === 'Backspace' && input.value === '' && !e.repeat) {
      const token = useFilterStore.getState().unwindSearchToken()
      if (token == null) return false
      setText(token)
      pendingCaretRef.current = token.length
      writeWords(searchWords(parseSearch(token, sourcesNow())))
      return true
    }
    return false
  }, [commit, writeWords, sourcesNow])

  const clear = useCallback(() => {
    setText('')
    writeWords('')
  }, [writeWords])

  // The box's text changed under the caret (tokens taken, one put back): place it.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    const input = inputRef.current
    if (caret == null || !input) return
    pendingCaretRef.current = null
    if (input.value.length >= caret) input.setSelectionRange(caret, caret)
  }, [text, inputRef])

  return { text, parse, words, onChange, onKeyDown, clear }
}
