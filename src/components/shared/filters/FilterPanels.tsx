import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { MarkerClause, StatusIconKey } from '../../../models'
import { StatusMark } from '../StatusMark'
import { ClearableField } from '../ClearableField'
import { ESCAPE_CLEARS_ATTR } from '../../../hooks/use-popover-anchor'
import { PickerEntityMenu } from '../EntityMenu'
import picker from './FilterPicker.module.css'
import { MARKER_PICKER_ROWS, markerClauseOfIds, markerPickerIds, MARKERS_LABEL, NO_PRIORITY_LABEL } from '../../../utils/markers'
import markerStyles from './MarkersPanel.module.css'
import { byName } from '../../../utils/sort-order'
import { shortcutScope } from '../../../utils/dom-contract'
import { splitOnTop, usePickerOrder } from '../../../hooks/use-picker-order'

/**
 * Bodies of the filter pickers, shared by the top bar's filter buttons
 * (`FilterChipBar`) and the list widgets' filter chips. Each renders inside
 * a caller-owned popover panel (`picker.dropdownPanel`). The date filters
 * have their own component, `DateFilterPanel`.
 */

export interface FilterModeProps {
  /** The picker's field name (`People`, `Status`, `Tags`): the toggle's name. */
  field: string
  /** "Is not": the ticked values hide tasks instead of picking them. */
  negated: boolean
  onChange: (negated: boolean) => void
  /** The phone sheet's touch height. */
  touch?: boolean
}

/** One segment of a `SegmentedToggle`. */
export interface SegmentChoice<T> {
  value: T
  label: string
  /** Picked, it reads in the accent (a choice that hides tasks: Is not, No). */
  accent?: boolean
}

interface SegmentedToggleProps<T> {
  /** The group's name. */
  label: string
  choices: readonly SegmentChoice<T>[]
  value: T
  onChange: (value: T) => void
  /** The phone sheet's touch height. */
  touch?: boolean
}

/**
 * A segmented radio group: one segment per choice, arrow keys move between
 * them (wrapping). The filter pickers' Is / Is not toggle.
 */
export function SegmentedToggle<T>({ label, choices, value, onChange, touch = false }: SegmentedToggleProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const at = Math.max(0, choices.findIndex((c) => c.value === value))
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    if (step === 0) return
    e.preventDefault()
    const i = (at + step + choices.length) % choices.length
    const next = choices[i]
    if (!next) return
    onChange(next.value)
    refs.current[i]?.focus()
  }
  return (
    <div
      className={`${picker.modeToggle} ${touch ? picker.modeToggleTouch : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {choices.map((c, i) => {
        const on = i === at
        return (
          <button
            key={c.label}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`${picker.modeSegment} ${on ? picker.modeSegmentOn : ''} ${on && c.accent ? picker.modeSegmentNot : ''}`}
            onClick={() => { if (!on) onChange(c.value) }}
            onKeyDown={onKeyDown}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

const MODE_CHOICES: readonly SegmentChoice<boolean>[] = [
  { value: false, label: 'Is' },
  { value: true, label: 'Is not', accent: true },
]

/**
 * The Is / Is not toggle at the top of a People / Status / Tags picker: a
 * two-segment radio group (arrow keys switch). Switching keeps the ticks.
 */
export function FilterModeToggle({ field, negated, onChange, touch = false }: FilterModeProps) {
  return <SegmentedToggle label={`${field}: is or is not`} choices={MODE_CHOICES} value={negated} onChange={onChange} touch={touch} />
}

/** Marks a picker's search box: ↓ in it moves into the rows below, ↑ on the first row comes back. */
const PICKER_SEARCH_ATTR = 'data-picker-search'

/** The search box of the picker `list` sits in: the nearest one above it in its popover. */
function focusSearchAbove(list: HTMLElement) {
  for (let el: HTMLElement | null = list.parentElement; el; el = el.parentElement) {
    const search = el.querySelector<HTMLInputElement>(`input[${PICKER_SEARCH_ATTR}]`)
    if (search) { search.focus(); return }
  }
}

/**
 * Into the listbox after `search` in its picker: the row the search
 * highlights (`data-search-pick`) when there is one, else the rows' tab stop.
 */
function focusRowsBelow(search: HTMLElement): boolean {
  for (let el: HTMLElement | null = search.parentElement; el; el = el.parentElement) {
    const row = el.querySelector<HTMLElement>('[role="listbox"] [role="option"][data-search-pick]')
      ?? el.querySelector<HTMLElement>('[role="listbox"] [role="option"][tabindex="0"]')
    if (row) { row.focus(); return true }
  }
  return false
}

/**
 * The search box's pick: the row the rows below highlight for the search
 * (`searchPickId`), through their own pick — ticked (`tickOnly`, never
 * unticked) or toggled; the search clears. False when no row is highlighted.
 */
type SearchPick = (tickOnly: boolean) => boolean

/** How `SelectionPanelBody`'s search reaches the `EntityDropdownItems` below it. */
interface SearchPickLink {
  /** The rows register their `SearchPick` (`null` on unmount). */
  registerPick: (pick: SearchPick | null) => void
  /** The highlighted row's element id, for the search's `aria-activedescendant`. */
  setActiveDescendant: (id: string | undefined) => void
  /** The rows' listbox id: the search (a combobox) controls it. */
  listboxId: string
  /** Whether the listbox is shown (no rows: it isn't — the search is collapsed). */
  setListboxShown: (shown: boolean) => void
}

const SearchPickContext = createContext<SearchPickLink | null>(null)

/**
 * The row Tab / Enter in the search picks (and the rows highlight), with text
 * `q` typed (trimmed, lower case): a named row (a person / tag / status)
 * always wins — the first one shown; the None row only when no named row is
 * shown (`none` typed, say). `rowIds` in their order on screen, None as 0.
 */
function searchPickId(q: string, rowIds: readonly number[]): number | undefined {
  if (!q) return undefined
  return rowIds.find((id) => id !== 0) ?? (rowIds.includes(0) ? 0 : undefined)
}

interface SelectionPanelBodyProps {
  /** The Is / Is not toggle above the actions (People / Status / Tags). */
  mode?: FilterModeProps
  allSelected: boolean
  noneSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  /** A search box above the items (controlled). */
  search?: {
    text: string
    setText: (text: string) => void
    /** Escape on an empty search box. */
    onEscape: () => void
  }
  searchInputRef?: RefObject<HTMLInputElement | null>
  children: ReactNode
}

/**
 * An optional Is / Is not toggle, Select all / Deselect all, an optional search
 * box (× clears it), then the items. With text typed in the search, the rows
 * highlight the one Tab / Enter pick (`searchPickId`; the search's
 * `aria-activedescendant`): Tab ticks it (never unticks it), Enter toggles it;
 * the search clears and the focus stays in it (as the people / tag pickers' Tab).
 * ↓ goes into the rows — to that row while there is one. The search is a
 * combobox controlling the rows' listbox.
 */
export function SelectionPanelBody({ mode, allSelected, noneSelected, onSelectAll, onDeselectAll, search, searchInputRef, children }: SelectionPanelBodyProps) {
  const ownSearchRef = useRef<HTMLInputElement>(null)
  const searchRef = searchInputRef ?? ownSearchRef
  const pickRef = useRef<SearchPick | null>(null)
  const [activeDescendant, setActiveDescendant] = useState<string | undefined>(undefined)
  const [listboxShown, setListboxShown] = useState(false)
  const listboxId = useId()
  const link = useMemo<SearchPickLink>(() => ({
    registerPick: (pick) => { pickRef.current = pick },
    setActiveDescendant,
    listboxId,
    setListboxShown,
  }), [listboxId])
  return (
    <>
      {mode && <FilterModeToggle {...mode} />}
      <div className={picker.dropdownActions}>
        <button
          type="button"
          className={`${picker.dropdownAction} ${allSelected ? picker.dropdownActionDisabled : ''}`}
          onClick={allSelected ? undefined : onSelectAll}
        >
          Select all
        </button>
        <span className={picker.dropdownActionSep}>/</span>
        <button
          type="button"
          className={`${picker.dropdownAction} ${noneSelected ? picker.dropdownActionDisabled : ''}`}
          onClick={noneSelected ? undefined : onDeselectAll}
        >
          Deselect all
        </button>
      </div>
      <div className={picker.dropdownDivider} />
      {search && (
        <div className={picker.dropdownSearchWrapper}>
          <ClearableField
            value={search.text}
            onClear={() => search.setText('')}
            inputRef={searchRef}
            label="Clear search"
          >
            <input
              ref={searchRef}
              className={picker.dropdownSearchInput}
              type="text"
              placeholder="Search..."
              value={search.text}
              onChange={(e) => search.setText(e.target.value)}
              {...{ [ESCAPE_CLEARS_ATTR]: '', [PICKER_SEARCH_ATTR]: '' }}
              role="combobox"
              aria-expanded={listboxShown}
              aria-controls={listboxShown ? listboxId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={search.text.trim() ? activeDescendant : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  if (focusRowsBelow(e.currentTarget)) e.preventDefault()
                  return
                }
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  // An IME's Enter / Tab ends the composition; it picks nothing.
                  if (e.nativeEvent.isComposing) return
                  // With no text typed, Tab moves on as usual (never a Tab trap).
                  if (search.text.trim() && pickRef.current?.(e.key === 'Tab')) {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                  return
                }
                if (e.key !== 'Escape') return
                // Esc empties the search first (the popover leaves it to the
                // field while it has text); the next one closes the picker.
                if (search.text) {
                  e.preventDefault()
                  e.stopPropagation()
                  search.setText('')
                } else {
                  search.onEscape()
                }
              }}
            />
          </ClearableField>
        </div>
      )}
      <div className={search ? picker.dropdownItemsScrollable : undefined}>
        <SearchPickContext value={link}>{children}</SearchPickContext>
      </div>
    </>
  )
}

interface EntityDropdownItemsProps {
  searchText: string
  /** `icon` / `emoji`: a status's look (its mark is drawn); neither: a dot in its color. */
  entities: readonly { id?: number; name: string; color?: string; icon?: StatusIconKey; emoji?: string; emojiShow?: 'color' }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  showDot?: boolean
  /** Show the leading "None" row (id 0). Default true. */
  withNone?: boolean
  /** The None row's name (default `None`; tags: `No tags`). */
  noneLabel?: string
  /**
   * The rows are people / tags: a right-click on one opens its Show tasks ·
   * Edit… · Delete… menu over the picker (without ticking it); Show tasks
   * runs `onShowTasks` first (the host closes the picker).
   */
  entityMenu?: 'person' | 'tag'
  onShowTasks?: () => void
  /** The list's name (`People`, `Tags`, `Status`). */
  label?: string
  /** Empties the search box above (a pick while it has text clears it). */
  onSearchClear?: () => void
  /** The rows stay in the order given, not by name (Priority's fixed order). */
  keepOrder?: boolean
}

/** A press on a row keeps the focus where it is (the picker's search box), as the people / tag pickers do. */
function keepFocus(e: MouseEvent) {
  e.preventDefault()
}

/** The picker's rows: a listbox of checkable options (Is / Is not and Select all sit above it). */
const ROW_SELECTOR = '[role="option"]'

/**
 * Checkable entity rows (plus a "None" row, id 0), filtered by `searchText`:
 * the ticked rows first, then the rest (a separator between) — each block
 * alphabetical, None first in its block. The order is fixed when the picker
 * opens and whenever the search text changes (`usePickerOrder`), so a tick
 * with the text unchanged never moves a row. A pick while the search has
 * text clears it (`onSearchClear`): the whole list shows again, re-sorted,
 * the focus staying where it was (the search box, or the picked row at its
 * new place). A multi-select listbox with one tab stop — ↑ / ↓ / Home / End
 * move between the rows (↑ on the first goes back to a search box above),
 * Space or Enter ticks the focused one, Shift+F10 / the context-menu key
 * opens a person's / tag's menu under it.
 */
export function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  showDot = true,
  withNone = true,
  noneLabel = 'None',
  entityMenu,
  onShowTasks,
  label,
  onSearchClear,
  keepOrder = false,
}: EntityDropdownItemsProps) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  // The row that takes the tab stop, by id (0 = None), so it survives the search narrowing.
  const [activeId, setActiveId] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** A row picked from the keyboard while the search cleared: it keeps the focus at its new place. */
  const refocusRef = useRef<number | null>(null)
  const searchLink = useContext(SearchPickContext)
  const rowDomId = useId()
  const allIds = [...(withNone ? [0] : []), ...entities.flatMap((e) => (e.id == null ? [] : [e.id]))]
  const order = usePickerOrder(searchText, allIds, isChecked)
  const q = searchText.trim().toLowerCase()
  const showNone = withNone && (!q || 'none'.includes(q) || noneLabel.toLowerCase().includes(q))
  const matching = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .flatMap((e) => (e.id == null ? [] : [{ ...e, id: e.id }]))
    .toSorted(keepOrder ? () => 0 : byName)
  const { top, rest } = splitOnTop(matching, (e) => order.onTop(e.id))
  const noneOnTop = showNone && order.onTop(0)
  const topIds = [...(noneOnTop ? [0] : []), ...top.map((e) => e.id)]
  const restIds = [...(showNone && !noneOnTop ? [0] : []), ...rest.map((e) => e.id)]
  const rowIds = [...topIds, ...restIds]
  const firstRest = topIds.length > 0 ? restIds[0] : undefined
  const tabStop = activeId != null && rowIds.includes(activeId) ? activeId : rowIds[0]
  /** The row Tab / Enter in the search pick, highlighted while text is typed. */
  const searchPick = searchPickId(q, rowIds)
  const rowElementId = (id: number) => `${rowDomId}-row-${id}`
  const searchPickElementId = searchPick == null ? undefined : rowElementId(searchPick)
  const byId = new Map(matching.map((e) => [e.id, e]))

  useLayoutEffect(() => {
    const id = refocusRef.current
    if (id == null) return
    refocusRef.current = null
    const row = listRef.current?.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)
    if (row && document.activeElement !== row) row.focus()
  })

  /**
   * Ticks / unticks row `id` (`tickOnly`: ticks it, never unticks); with
   * search text the search clears and the order is fixed again.
   */
  const pick = (id: number, tickOnly = false) => {
    const was = isChecked(id)
    setActiveId(id)
    if (!(tickOnly && was)) onToggle(id)
    if (!searchText || !onSearchClear) return
    order.notePick(id, tickOnly || !was)
    if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.entityId === String(id)) {
      refocusRef.current = id
    }
    onSearchClear()
  }

  // The search box above picks the highlighted row through `pick` (Tab / Enter there).
  const registerPick = searchLink?.registerPick
  useLayoutEffect(() => {
    if (!registerPick) return
    registerPick((tickOnly) => {
      if (searchPick == null) return false
      pick(searchPick, tickOnly)
      return true
    })
    return () => registerPick(null)
  })
  const setActiveDescendant = searchLink?.setActiveDescendant
  useLayoutEffect(() => {
    if (!setActiveDescendant) return
    setActiveDescendant(searchPickElementId)
    return () => setActiveDescendant(undefined)
  }, [setActiveDescendant, searchPickElementId])
  const setListboxShown = searchLink?.setListboxShown
  const listboxShown = rowIds.length > 0
  useLayoutEffect(() => {
    if (!setListboxShown) return
    setListboxShown(listboxShown)
    return () => setListboxShown(false)
  }, [setListboxShown, listboxShown])

  const onRowContextMenu = (id: number | undefined) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (id == null || id === 0) return
    // From the keyboard (no right button): under the row, as the people / tag pickers do.
    const rect = e.button === 2 ? null : e.currentTarget.getBoundingClientRect()
    setMenu({ id, x: rect ? rect.left + 16 : e.clientX, y: rect ? rect.bottom : e.clientY })
  }
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    const at = rows.findIndex((r) => r === document.activeElement)
    if (at < 0) return
    const focusRow = (i: number) => {
      const row = rows[i]
      if (!row) return
      setActiveId(Number(row.dataset.entityId))
      row.focus()
    }
    const id = Number(rows[at]?.dataset.entityId)
    if (e.key === 'ArrowDown') focusRow(Math.min(at + 1, rows.length - 1))
    else if (e.key === 'ArrowUp') { if (at === 0) focusSearchAbove(e.currentTarget); else focusRow(at - 1) }
    else if (e.key === 'Home') focusRow(0)
    else if (e.key === 'End') focusRow(rows.length - 1)
    else if (e.key === ' ' || e.key === 'Enter') pick(id)
    else return
    // The list's keys go no further (Space and Enter are task shortcuts too).
    e.preventDefault()
    e.stopPropagation()
  }
  const row = (id: number, content: ReactNode, menuable: boolean) => (
    <div
      key={id}
      role="option"
      aria-selected={isChecked(id)}
      tabIndex={id === tabStop ? 0 : -1}
      data-entity-id={id}
      id={rowElementId(id)}
      data-search-pick={id === searchPick ? '' : undefined}
      className={`${picker.dropdownItem} ${id === firstRest ? picker.dropdownItemSeparated : ''} ${id === searchPick ? picker.dropdownItemSearchPick : ''}`}
      onClick={() => pick(id)}
      onMouseDown={keepFocus}
      onFocus={() => setActiveId(id)}
      onContextMenu={menuable ? onRowContextMenu(id) : undefined}
    >
      <span className={`${picker.check} ${isChecked(id) ? picker.checked : ''}`} aria-hidden="true" />
      {content}
    </div>
  )
  return (
    <>
      {rowIds.length > 0 && (
        <div ref={listRef} id={searchLink?.listboxId} role="listbox" aria-multiselectable="true" aria-label={label} onKeyDown={onListKeyDown} {...shortcutScope('none')}>
          {rowIds.map((id) => {
            if (id === 0) return row(0, <span className={picker.noneLabel}>{noneLabel}</span>, !!entityMenu)
            const entity = byId.get(id)
            return entity && row(id, (
              <>
                {entity.icon || entity.emoji ? (
                  <span className={picker.dotIcon} style={{ color: entity.color }} aria-hidden="true">
                    <StatusMark status={entity} filled />
                  </span>
                ) : showDot && entity.color ? (
                  <span className={picker.dot} style={{ background: entity.color }} aria-hidden="true" />
                ) : null}
                {entity.name}
              </>
            ), !!entityMenu)
          })}
        </div>
      )}
      {q && !showNone && matching.length === 0 && (
        <div className={picker.dropdownEmpty}>No matches</div>
      )}
      {menu && entityMenu && (
        <PickerEntityMenu
          kind={entityMenu}
          id={menu.id}
          point={{ x: menu.x, y: menu.y }}
          onShowTasks={onShowTasks}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

/**
 * One Priority condition's picker: the Status picker over the markers — Is /
 * Is not, Select all / Deselect all, a row per marker and `No priority`.
 * Nothing ticked is no condition (`null`); "Is not" with nothing ticked is
 * held here until the first tick. Picking keeps the picker open. Opening it
 * focuses its rows (it has no search box).
 */
export function MarkerClausePicker({ clause, onChange }: {
  clause: MarkerClause | null
  onChange: (next: MarkerClause | null) => void
}) {
  const [pendingNot, setPendingNot] = useState(false)
  const negated = clause ? clause.not === true : pendingNot
  const ids = markerPickerIds(clause)
  const write = (next: Iterable<number>, not = negated) => {
    if (not) setPendingNot(true)
    onChange(markerClauseOfIds(next, not))
  }
  const allIds = [0, ...MARKER_PICKER_ROWS.map((r) => r.id)]
  // It has no search box: the focus goes to its rows' tab stop, so the keyboard reaches them.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div ref={panelRef} className={markerStyles.panel} role="group" aria-label={MARKERS_LABEL}>
      <SelectionPanelBody
        mode={{
          field: MARKERS_LABEL,
          negated,
          onChange: (not) => {
            setPendingNot(not)
            if (clause) write(ids, not)
          },
        }}
        allSelected={ids.size === allIds.length}
        noneSelected={ids.size === 0}
        onSelectAll={() => write(allIds)}
        onDeselectAll={() => write([])}
      >
        <EntityDropdownItems
          searchText=""
          entities={MARKER_PICKER_ROWS}
          label={MARKERS_LABEL}
          noneLabel={NO_PRIORITY_LABEL}
          isChecked={(id) => ids.has(id)}
          onToggle={(id) => write(ids.has(id) ? [...ids].filter((x) => x !== id) : [...ids, id])}
          keepOrder
        />
      </SelectionPanelBody>
      <p className={markerStyles.note}>Urgent includes urgent by due date.</p>
    </div>
  )
}
