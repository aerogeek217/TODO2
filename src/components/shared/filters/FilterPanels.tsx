import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { MARKER_KEYS, type MarkerKey, type MarkersFilter } from '../../../models'
import { StatusIcon } from '../StatusIcon'
import { ClearableField } from '../ClearableField'
import { ESCAPE_CLEARS_ATTR } from '../../../hooks/use-popover-anchor'
import { PickerEntityMenu } from '../EntityMenu'
import picker from './FilterPicker.module.css'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { HOT_LABEL, MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL, isHotFilter, markerCondition, toggleHot, withMarkerCondition } from '../../../utils/markers'
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
  /** Inline in a row (the Priority picker's markers): sized to its labels. */
  inline?: boolean
  /** Shown but not pickable (a marker while Hot is on). */
  disabled?: boolean
}

/**
 * A segmented radio group: one segment per choice, arrow keys move between
 * them (wrapping). The filter pickers' Is / Is not toggle and each marker's
 * Any / Yes / No.
 */
export function SegmentedToggle<T>({ label, choices, value, onChange, touch = false, inline = false, disabled = false }: SegmentedToggleProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const at = Math.max(0, choices.findIndex((c) => c.value === value))
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    if (step === 0) return
    e.preventDefault()
    if (disabled) return
    const i = (at + step + choices.length) % choices.length
    const next = choices[i]
    if (!next) return
    onChange(next.value)
    refs.current[i]?.focus()
  }
  return (
    <div
      className={`${picker.modeToggle} ${touch ? picker.modeToggleTouch : ''} ${inline ? picker.modeToggleInline : ''} ${disabled ? picker.modeToggleDisabled : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
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
            onClick={() => { if (!on && !disabled) onChange(c.value) }}
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

/** A marker's condition in a Priority filter: Any (no condition), Yes (`true`), No (`false`). */
type MarkerChoice = 'any' | 'yes' | 'no'

const MARKER_CHOICES: readonly SegmentChoice<MarkerChoice>[] = [
  { value: 'any', label: 'Any' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No', accent: true },
]

function choiceOf(condition: boolean | undefined): MarkerChoice {
  return condition === undefined ? 'any' : condition ? 'yes' : 'no'
}

function conditionOf(choice: MarkerChoice): boolean | undefined {
  return choice === 'any' ? undefined : choice === 'yes'
}

/**
 * One marker's Any · Yes · No in a Priority filter — the one three-way
 * control every Priority picker uses (`MarkersPanelBody`, the phone sheet).
 * Named after the marker (`Urgent`).
 */
export function MarkerConditionToggle({ marker, value, onChange, touch = false, disabled = false }: {
  marker: MarkerKey
  value: MarkersFilter | null | undefined
  onChange: (v: MarkersFilter | null) => void
  touch?: boolean
  disabled?: boolean
}) {
  return (
    <SegmentedToggle
      label={MARKER_LABELS[marker]}
      choices={MARKER_CHOICES}
      value={choiceOf(markerCondition(value, marker))}
      onChange={(choice) => onChange(withMarkerCondition(value, marker, conditionOf(choice)))}
      touch={touch}
      inline
      disabled={disabled}
    />
  )
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

/** The first row's tab stop of the listbox after `search` in its picker. */
function focusRowsBelow(search: HTMLElement): boolean {
  for (let el: HTMLElement | null = search.parentElement; el; el = el.parentElement) {
    const row = el.querySelector<HTMLElement>('[role="listbox"] [role="option"][tabindex="0"]')
    if (row) { row.focus(); return true }
  }
  return false
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

/** An optional Is / Is not toggle, Select all / Deselect all, an optional search box (× clears it), then the items. */
export function SelectionPanelBody({ mode, allSelected, noneSelected, onSelectAll, onDeselectAll, search, searchInputRef, children }: SelectionPanelBodyProps) {
  const ownSearchRef = useRef<HTMLInputElement>(null)
  const searchRef = searchInputRef ?? ownSearchRef
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
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  if (focusRowsBelow(e.currentTarget)) e.preventDefault()
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
      <div className={search ? picker.dropdownItemsScrollable : undefined}>{children}</div>
    </>
  )
}

interface EntityDropdownItemsProps {
  searchText: string
  entities: readonly { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
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
  namePrefix,
  showDot = true,
  withNone = true,
  noneLabel = 'None',
  entityMenu,
  onShowTasks,
  label,
  onSearchClear,
}: EntityDropdownItemsProps) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  // The row that takes the tab stop, by id (0 = None), so it survives the search narrowing.
  const [activeId, setActiveId] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** A row picked from the keyboard while the search cleared: it keeps the focus at its new place. */
  const refocusRef = useRef<number | null>(null)
  const allIds = [...(withNone ? [0] : []), ...entities.flatMap((e) => (e.id == null ? [] : [e.id]))]
  const order = usePickerOrder(searchText, allIds, isChecked)
  const q = searchText.trim().toLowerCase()
  const showNone = withNone && (!q || 'none'.includes(q) || noneLabel.toLowerCase().includes(q))
  const matching = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .flatMap((e) => (e.id == null ? [] : [{ ...e, id: e.id }]))
    .toSorted(byName)
  const { top, rest } = splitOnTop(matching, (e) => order.onTop(e.id))
  const noneOnTop = showNone && order.onTop(0)
  const topIds = [...(noneOnTop ? [0] : []), ...top.map((e) => e.id)]
  const restIds = [...(showNone && !noneOnTop ? [0] : []), ...rest.map((e) => e.id)]
  const rowIds = [...topIds, ...restIds]
  const firstRest = topIds.length > 0 ? restIds[0] : undefined
  const tabStop = activeId != null && rowIds.includes(activeId) ? activeId : rowIds[0]
  const byId = new Map(matching.map((e) => [e.id, e]))

  useLayoutEffect(() => {
    const id = refocusRef.current
    if (id == null) return
    refocusRef.current = null
    const row = listRef.current?.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)
    if (row && document.activeElement !== row) row.focus()
  })

  /** Ticks / unticks row `id`; with search text the search clears and the order is fixed again. */
  const pick = (id: number) => {
    const was = isChecked(id)
    setActiveId(id)
    onToggle(id)
    if (!searchText || !onSearchClear) return
    order.notePick(id, !was)
    if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.entityId === String(id)) {
      refocusRef.current = id
    }
    onSearchClear()
  }

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
      className={`${picker.dropdownItem} ${id === firstRest ? picker.dropdownItemSeparated : ''}`}
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
        <div ref={listRef} role="listbox" aria-multiselectable="true" aria-label={label} onKeyDown={onListKeyDown} {...shortcutScope('none')}>
          {rowIds.map((id) => {
            if (id === 0) return row(0, <span className={picker.noneLabel}>{noneLabel}</span>, !!entityMenu)
            const entity = byId.get(id)
            return entity && row(id, (
              <>
                {entity.icon ? (
                  <span className={picker.dotIcon} style={{ color: entity.color }} aria-hidden="true">
                    <StatusIcon icon={entity.icon} filled />
                  </span>
                ) : showDot && entity.color ? (
                  <span className={picker.dot} style={{ background: entity.color }} aria-hidden="true" />
                ) : null}
                {namePrefix}
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

const TICK = (
  <svg className={markerStyles.tick} width="12" height="12" viewBox="0 0 16 16" aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * The Priority filter: Hot, then Any · Yes · No for Focus / Urgent /
 * Important. A task must be hot, or meet every marker's Yes / No (strict
 * AND). Ticking Hot clears and disables the single markers. Picking keeps
 * the picker open.
 */
export function MarkersPanelBody({ value, onChange }: {
  value: MarkersFilter | null
  onChange: (v: MarkersFilter | null) => void
}) {
  const hot = isHotFilter(value)
  return (
    <div className={markerStyles.panel} role="group" aria-label={MARKERS_LABEL}>
      <button
        type="button"
        className={`${picker.dropdownItem} ${markerStyles.row} ${hot ? markerStyles.rowOn : ''}`}
        role="checkbox"
        aria-checked={hot}
        onClick={() => onChange(toggleHot(value))}
      >
        <span className={markerStyles.glyph} style={{ color: 'var(--color-danger)' }}><HotIcon /></span>
        <span className={markerStyles.label}>{HOT_LABEL}</span>
        {hot && TICK}
      </button>
      <div className={markerStyles.separator} role="separator" />
      {MARKER_KEYS.map((key) => (
        <div key={key} className={`${markerStyles.markerRow} ${hot ? markerStyles.rowDisabled : ''}`}>
          <span className={markerStyles.glyph} style={{ color: MARKER_COLOR[key] }}><MarkerIcon marker={key} /></span>
          <span className={markerStyles.label} aria-hidden>{MARKER_LABELS[key]}</span>
          <MarkerConditionToggle marker={key} value={value} onChange={onChange} disabled={hot} />
        </div>
      ))}
      <p className={markerStyles.note}>
        {hot
          ? 'Hot already combines these. Clear Hot to pick them one by one.'
          : 'Yes: tasks must have it. No: tasks must not. Urgent includes urgent by due date.'}
      </p>
    </div>
  )
}
