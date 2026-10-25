import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { SEARCH_DEBOUNCE_MS } from '../constants'
import { useFilterStore } from '../stores/filter-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { startOfToday } from '../utils/date'
import { personItems, statusItems, tagItems } from '../services/nlp-autocomplete'
import type { TintSpan } from '../services/nlp-token-tints'
import {
  parseSearch,
  searchAutocomplete,
  searchTints,
  searchWords,
  takeTokens,
  type SearchName,
  type SearchParse,
  type SearchSources,
} from '../services/search-tokens'
import { useNlpAutocomplete } from './use-nlp-autocomplete'

interface SearchBoxOptions {
  inputRef: RefObject<HTMLInputElement | null>
  /** Writes the text search after a pause (the top bar), else at once (the phone sheet). A clear writes at once. */
  debounce?: boolean
}

/**
 * A search box over the screen filter (D16): typed tokens become the tray's
 * chips as each completes — a space after it, ⏎, a pick in the `@ # /`
 * popup (`filter-store.applySearchTokens`) — and the words left are the text
 * search, written to the store (`searchText`). Backspace in the empty box
 * takes the last chip the box made back as its token; Esc on the popup
 * keeps its `@` / `#` token as words. The store's text changing elsewhere
 * (Clear all, another field) shows here.
 *
 * Hosts render the input over `tints` (`shared/TintedText`), `NlpPopup`
 * with `ac.state` (no Create rows: a search never creates), and a note per
 * `unmatched` name; they call `onChange` / `onCaretMove` (mouse up, key up) from the input and
 * route its keys through `onKeyDown` (true = consumed).
 */
export function useSearchBox({ inputRef, debounce = true }: SearchBoxOptions) {
  const storeText = useFilterStore((s) => s.filters.searchText)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const [text, setText] = useState(storeText)
  /** The text search this box last wrote (or is about to, after the pause). */
  const [written, setWritten] = useState(storeText)
  const [shownStoreText, setShownStoreText] = useState(storeText)
  /** `@` / `#` tokens Esc kept as words, as typed. */
  const [kept, setKept] = useState<readonly string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Where the caret goes once the box's text has changed under it (a new object each time: the box may read the same as before while the field does not). */
  const [caretAt, setCaretAt] = useState<{ at: number } | null>(null)
  /** While a change is read: the text the popup completed it to (typing on past an `@` / `#` token). */
  const changingRef = useRef<{ value: string; caret: number } | null>(null)
  /** The text and caret the popup last followed (`onCaretMove` skips an event that moved nothing). */
  const lastCaretRef = useRef<{ value: string; caret: number } | null>(null)

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
  const parse: SearchParse = useMemo(() => parseSearch(text, sourcesNow(), kept), [text, sourcesNow, kept])
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
    const keptNow = kept.filter((raw) => value.includes(raw))
    if (keptNow.length !== kept.length) setKept(keptNow)
    const read = parseSearch(value, sources, keptNow)
    const box = takeTokens(read, caret, all)
    if (box.taken.length > 0) useFilterStore.getState().applySearchTokens(box.taken)
    setText(box.text)
    lastCaretRef.current = { value: box.text, caret: box.caret }
    if (box.text !== value) setCaretAt({ at: box.caret })
    writeWords(searchWords(box.taken.length > 0 ? parseSearch(box.text, sources, keptNow) : read))
    return box
  }, [sourcesNow, writeWords, kept])

  const acPeople = useMemo(() => personItems(people), [people])
  const acTags = useMemo(() => tagItems(tags), [tags])
  const acStatuses = useMemo(() => statusItems(statuses), [statuses])
  const ac = useNlpAutocomplete({
    people: acPeople,
    tags: acTags,
    statuses: acStatuses,
    commands: true,
    compute: searchAutocomplete,
    onApply: (value, cursor) => {
      // Typed on past a token: read with the rest of the change. A pick: now
      // (it ends with a space, so its token becomes a chip).
      if (changingRef.current) changingRef.current = { value, caret: cursor }
      else commit(value, cursor)
    },
  })
  const { handleInputChange, dismiss } = ac

  const onChange = useCallback((value: string, caret: number, input: HTMLInputElement | null) => {
    changingRef.current = { value, caret }
    handleInputChange(value, caret, input)
    const next = changingRef.current
    changingRef.current = null
    const box = commit(next.value, next.caret)
    if (box.taken.length > 0) dismiss()
  }, [handleInputChange, commit, dismiss])

  /** The caret may have moved (a click, ←/→, Home / End): the popup follows it into / out of a token. */
  const onCaretMove = useCallback((input: HTMLInputElement) => {
    const caret = input.selectionStart ?? input.value.length
    const last = lastCaretRef.current
    lastCaretRef.current = { value: input.value, caret }
    if (last?.value === input.value && last.caret === caret) return
    handleInputChange(input.value, caret, input)
  }, [handleInputChange])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    const input = e.currentTarget
    const view = ac.state.visible ? ac.state.view : null
    if (e.key === 'Escape' && view?.mode === 'entity') {
      // Esc keeps the `@` / `#` token as words.
      const raw = input.value.slice(view.anchor, view.to)
      if (raw.length > 1) setKept((k) => (k.includes(raw) ? k : [...k, raw]))
    }
    if (ac.handleKeyDown(e, input)) return true
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const box = commit(input.value, input.selectionStart ?? input.value.length, true)
      return box.taken.length > 0
    }
    if (e.key === 'Backspace' && input.value === '' && !e.repeat) {
      const token = useFilterStore.getState().unwindSearchToken()
      if (token == null) return false
      setText(token)
      setCaretAt({ at: token.length })
      lastCaretRef.current = { value: token, caret: token.length }
      writeWords(searchWords(parseSearch(token, sourcesNow(), kept)))
      // Back on an `@` / `#` token: its popup again.
      handleInputChange(token, token.length, input)
      return true
    }
    return false
  }, [ac, commit, writeWords, sourcesNow, kept, handleInputChange])

  const clear = useCallback(() => {
    setText('')
    setKept([])
    writeWords('')
    dismiss()
  }, [writeWords, dismiss])

  // The box's text changed under the caret (tokens taken, one put back): place it.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!caretAt || !input) return
    if (input.value.length >= caretAt.at) input.setSelectionRange(caretAt.at, caretAt.at)
  }, [caretAt, inputRef])

  // The token the popup is open on is tinted as being typed.
  const view = ac.state.visible ? ac.state.view : null
  const tints: TintSpan[] = useMemo(
    () => searchTints(parse, view ? { start: view.anchor, end: view.to } : undefined),
    [parse, view],
  )
  /** `@` / `#` names matching nobody, once typing has moved past them (or no popup lists anything for them). */
  const unmatched: SearchName[] = useMemo(
    () => parse.names.filter((n) => n.unmatched && (n.complete || view?.anchor !== n.start)),
    [parse, view],
  )

  return { text, parse, words, tints, unmatched, ac, onChange, onCaretMove, onKeyDown, clear }
}

export type SearchBox = ReturnType<typeof useSearchBox>

/** The one-line note under the box for an `@` / `#` name that matches nobody. */
export function unmatchedNote(name: SearchName): { lead: string; name: string; rest: string; hint: string } {
  return name.kind === 'person'
    ? { lead: 'No person named ', name: name.name, rest: ' — searching the words instead', hint: 'Tab to the People chip to pick someone' }
    : { lead: 'No tag named ', name: name.name, rest: ' — searching the words instead', hint: 'Tab to the Tags chip to pick one' }
}
