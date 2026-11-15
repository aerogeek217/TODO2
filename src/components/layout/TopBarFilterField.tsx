import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { emptyPredicate, type FilterExpr, type PersistedTodoItem, type TodoPredicate } from '../../models'
import { useExpressionField } from '../../hooks/use-expression-field'
import { useFilterSettings } from '../../hooks/use-filter-settings'
import { useNlpPopupAnchor } from '../../hooks/use-nlp-popup-anchor'
import { useTodoNameLookups } from '../../hooks/use-todo-name-lookups'
import { fieldFilter, useFilterStore } from '../../stores/filter-store'
import { useScreenFilter } from '../../stores/screen-filter'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday } from '../../utils/date'
import { SEARCH_INPUT_ATTR } from '../../utils/dom-contract'
import { groupTodosByTextMatch, textMatchContextFor } from '../../utils/filter'
import { expressionAtoms, printExpression, printPieces, topLevelTerms, withoutAtom, type ExpressionPiece } from '../../utils/filter-expression'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { ExpressionPills } from '../shared/filters/ExpressionPills'
import { NlpPopup } from '../shared/NlpPopup'
import { PopoverRoot } from '../shared/PopoverRoot'
import { TintedText } from '../shared/TintedText'
import { useTooltip } from '../shared/use-tooltip'
import { SearchResultContextMenu, SearchResultsGroups, type SearchResultPillContext } from './TopBarSearchResults'
import styles from './TopBar.module.css'

/** What the empty field shows: what may be typed. */
export const TOP_BAR_FILTER_PLACEHOLDER = '@person #tag due fri'

/** The fade at the pills' end: a term whose pill starts inside it counts as not shown. */
const FADE_PX = 28

const NO_TODOS: PersistedTodoItem[] = []

/**
 * Each pill's top-level term, in pill order (`printPieces` puts the pills in
 * `expressionAtoms` order, `done` last): what `+N more` counts.
 */
function pillTerms(expression: FilterExpr | null, showCompleted: boolean): number[] {
  const out: number[] = []
  const terms = expression ? topLevelTerms(expression) : []
  terms.forEach((term, i) => { for (let n = expressionAtoms(term).length; n > 0; n--) out.push(i) })
  if (showCompleted) out.push(terms.length)
  return out
}

/** The text the search results look for: the typed filter's first top-level text term (the text search's chip). */
function searchWordsOf(expression: FilterExpr | null): string {
  if (!expression) return ''
  const text = topLevelTerms(expression).find((t) => t.kind === 'text')
  return text?.kind === 'text' ? text.text : ''
}

/**
 * The top bar's filter field (feedback P2, board Filter-B): it takes a typed
 * filter — the list Expression grammar (`@person`, `#tag`, `!status`,
 * `/urgent`, date words, `and` / `or` / `not`, brackets, quoted text) and
 * the search box's forms (`overdue`, `done`, terms side by side —
 * `parseExpression`'s `searchForms`) —, tinted as typed, with the `@ # ! /`
 * popup (`useExpressionField`). A text that reads becomes the screen filter
 * once typing rests, on ⏎ and on blur (`filter-store.applyExpression`: the
 * chips it can say, the rest as the screen filter's expression); one that
 * doesn't is never applied — its error under the field, the tasks keeping
 * the last filter that read; Esc puts that text back, and with nothing to
 * put back leaves the field (over the filtered-tasks panel, the panel then
 * takes Esc).
 *
 * **At rest** (not focused, its text the filter's) each term is a pill with
 * its own × (`ExpressionPills`): an × takes that term out (`withoutAtom`;
 * the `done` pill turns Show completed off), and a press anywhere else in
 * the field shows the whole filter as text — the chips printed as their
 * terms, in the order typed while the filter is still as typed
 * (`fieldFilter`). Too long, the pills fade at the field's end with `+N
 * more` (the top-level terms not shown) and the tooltip holds the whole
 * filter.
 *
 * The words of the text search list their matches under the field
 * (`TopBarSearchResults`) while it has the focus and the `@ # ! /` popup is
 * closed — one at a time. `width` is the field's (the top bar narrows it
 * when short of room).
 */
export function TopBarFilterField({ width, panelOpen, foldAttr }: {
  width: number
  panelOpen: boolean
  /** The top bar's measure mark (`FOLD_SEARCH_ATTR`) on the field's box. */
  foldAttr: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
  const miniListRef = useRef<HTMLDivElement>(null)
  const errorId = useId()
  const filters = useFilterStore((s) => s.filters)
  const typed = useFilterStore((s) => s.typed)
  const shownFilter = useMemo(() => fieldFilter(filters, typed), [filters, typed])
  const predicate = useMemo<TodoPredicate>(() => {
    const base = { ...emptyPredicate(), showCompleted: shownFilter.showCompleted }
    return shownFilter.expression ? { ...base, expression: shownFilter.expression } : base
  }, [shownFilter])
  const onChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().applyExpression(next.expression ?? null, next.showCompleted)
  }, [])
  const field = useExpressionField({ predicate, onChange, inputRef, searchForms: true })
  const { text, parse, tints, ac } = field

  const [focused, setFocused] = useState(false)
  const hasFilter = shownFilter.expression != null || shownFilter.showCompleted
  const resting = !focused && hasFilter && text === field.stored
  const pieces = useMemo<ExpressionPiece[]>(
    () => (resting ? printPieces(shownFilter.expression, shownFilter.showCompleted, field.names) : []),
    [resting, shownFilter, field.names],
  )
  const removePiece = (piece: ExpressionPiece) => {
    const { expression, showCompleted } = shownFilter
    if (piece.done) useFilterStore.getState().applyExpression(expression, false)
    else if (piece.atom != null && expression) useFilterStore.getState().applyExpression(withoutAtom(expression, piece.atom), showCompleted)
  }

  // Too long at rest: how many top-level terms start past the fade.
  const [hidden, setHidden] = useState(0)
  const terms = useMemo(() => pillTerms(shownFilter.expression, shownFilter.showCompleted), [shownFilter])
  useLayoutEffect(() => {
    const box = pillsRef.current
    if (!resting || !box) {
      setHidden(0)
      return
    }
    const measure = () => {
      let n = 0
      if (box.scrollWidth > box.clientWidth + 1) {
        const edge = box.getBoundingClientRect().right - FADE_PX
        const seen = new Set<number>()
        box.querySelectorAll<HTMLElement>('[data-top-bar-pill]').forEach((pill, i) => {
          const term = terms[i] ?? i
          if (seen.has(term)) return
          seen.add(term)
          if (pill.getBoundingClientRect().left >= edge) n++
        })
      }
      setHidden((h) => (h === n ? h : n))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [resting, pieces, terms])
  const wholeText = printExpression(shownFilter.expression, shownFilter.showCompleted, field.names)
  const tip = useTooltip(resting && hidden > 0 ? wholeText : null)

  // A typed text that doesn't read (the filter's own text always shows, though a name in it is gone) —
  // not while the `@ # ! /` popup shows (a name still being picked), one at a time.
  const popupOpen = ac.state.visible && ac.state.view !== null
  const error = !parse.ok && field.unreadable && !popupOpen ? parse.error : null
  const errorTip = useTooltip(error?.hint ?? null)

  // Keep the tint mirror scrolled with the input's text.
  const syncMirror = useCallback(() => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }, [])
  useLayoutEffect(() => { syncMirror() }, [text, syncMirror])

  // The `@ # ! /` popup; the search results wait while it shows.
  const popup = useNlpPopupAnchor(inputRef, ac.state)

  // The text search's matches: the words typed, among the tasks the rest of the screen filter keeps.
  const searchWords = focused && parse.ok ? searchWordsOf(parse.expression) : ''
  // Right-click menu state is kept here (not on the result row) so the menu
  // outlives the results closing when it opens.
  const [contextMenu, setContextMenu] = useState<{ todoId: number; x: number; y: number } | null>(null)
  const searching = !panelOpen && (searchWords.length > 0 || contextMenu !== null)
  const todos = useTodoStore((s) => (searching ? s.todos : NO_TODOS))
  const lookups = useTodoNameLookups({ active: searching })
  const { assignedPeopleMap, statusesById, statusUpdatesByTodo, subtasksByTodo } = lookups
  const pillCtx = useMemo<SearchResultPillContext>(() => ({
    peopleByTodoId: assignedPeopleMap,
    statusesById,
    statusUpdatesByTodo,
    subtasksByTodo,
  }), [assignedPeopleMap, statusesById, statusUpdatesByTodo, subtasksByTodo])
  const screen = useScreenFilter()
  const filterSettings = useFilterSettings()
  const groups = useMemo(() => {
    if (!searchWords) return null
    const narrowing = { ...screen.filters, searchText: '', showCompleted: true }
    const today = startOfToday()
    const kept = screen.active
      ? todos.filter((t) => matchesFilterWithLookups(narrowing, t, lookups, today, filterSettings))
      : todos
    return groupTodosByTextMatch(kept, searchWords, (t) => textMatchContextFor(t, lookups))
  }, [searchWords, todos, lookups, screen.filters, screen.active, filterSettings])
  const matchCount = groups ? (Object.values(groups) as PersistedTodoItem[][]).reduce((n, arr) => n + arr.length, 0) : 0
  const showResults = !panelOpen && !popupOpen && focused && searchWords.length > 0 && matchCount > 0

  const openTodo = useCallback((todoId: number) => {
    useUIStore.getState().openEditPopup(todoId)
    setFocused(false)
    inputRef.current?.blur()
  }, [])
  const menuTodo = useMemo(() => (contextMenu ? todos.find((t) => t.id === contextMenu.todoId) ?? null : null), [contextMenu, todos])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (field.onKeyDown(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.key === 'Escape') {
      // Nothing to put back: leave the field — over the panel, the panel takes it.
      if (panelOpen) return
      e.preventDefault()
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown' && showResults) {
      e.preventDefault()
      miniListRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()
    }
  }

  return (
    <div
      className={`${styles.searchWrapper} ${error ? styles.searchWrapperError : ''}`}
      style={{ width }}
      {...{ [foldAttr]: '' }}
      {...tip.triggerProps}
    >
      {resting ? (
        // The pills over the field; the field lies under them, unseen, taking every press but an ×'s.
        // Its own element (a key of its own): the mirror's scroll never carries over.
        <div key="pills" ref={pillsRef} className={`${styles.pills} ${hidden > 0 ? styles.pillsFaded : ''}`} data-testid="top-bar-pills">
          <ExpressionPills pieces={pieces} onRemove={removePiece} pillAttr="data-top-bar-pill" />
        </div>
      ) : (
        // The field's text with its tints, over the input's transparent text.
        <div key="mirror" ref={mirrorRef} className={styles.searchMirror} aria-hidden="true" data-testid="search-mirror">
          <TintedText text={text} spans={tints} />
        </div>
      )}
      {resting && hidden > 0 && <span className={styles.pillsMore} aria-hidden="true" data-testid="top-bar-pills-more">+{hidden} more</span>}
      {tip.tooltip}
      <input
        ref={inputRef}
        className={`${styles.searchInput} ${resting ? styles.searchInputRest : ''}`}
        type="text"
        placeholder={TOP_BAR_FILTER_PLACEHOLDER}
        aria-label="Filter tasks"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-autocomplete="list"
        // A text box: no aria-expanded (not one of its states); the results it controls while shown.
        aria-controls={showResults ? 'search-results' : undefined}
        value={text}
        spellCheck={false}
        {...{ [SEARCH_INPUT_ATTR]: '' }}
        onChange={(e) => field.onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)}
        onSelect={(e) => {
          syncMirror()
          field.onSelect(e.currentTarget)
        }}
        onScroll={syncMirror}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          field.onBlur()
          if (miniListRef.current?.contains(e.relatedTarget as Node)) return
          // A result's right-click menu takes the focus; the results stay for its actions.
          if (contextMenu) return
          setFocused(false)
        }}
        onKeyDown={onKeyDown}
      />
      {showResults && groups ? (
        <SearchResultsGroups
          ref={miniListRef}
          groups={groups}
          query={searchWords}
          note={null}
          pillCtx={pillCtx}
          searchInputRef={inputRef}
          onOpen={openTodo}
          onOpenContextMenu={(todo, x, y) => setContextMenu({ todoId: todo.id, x, y })}
          onBlur={(e) => {
            if (!miniListRef.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== inputRef.current) {
              if (contextMenu) return
              setFocused(false)
            }
          }}
        />
      ) : error && (
        <PopoverRoot className={styles.searchNotePopover}>
          <div id={errorId} className={`${styles.searchNote} ${styles.searchError}`} role="status" data-testid="top-bar-filter-error" {...errorTip.triggerProps}>
            {error.message}
            {errorTip.tooltip}
          </div>
        </PopoverRoot>
      )}
      {contextMenu && menuTodo && (
        <SearchResultContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          todo={menuTodo}
          onOpen={openTodo}
          onClose={() => {
            setContextMenu(null)
            // Any way the menu closes also drops the results: back to the unfocused state.
            setFocused(false)
          }}
        />
      )}
      {popupOpen && ac.state.view && createPortal(
        <NlpPopup
          view={ac.state.view}
          selectedIndex={ac.state.selectedIndex}
          onPick={(row) => ac.select(row, inputRef.current)}
          onHighlight={ac.highlight}
          popupRef={popup.setPopupEl}
          className={styles.nlpPopup}
          style={popup.style}
          entityMenu={{ keyTarget: () => inputRef.current }}
        />,
        document.body,
      )}
    </div>
  )
}
