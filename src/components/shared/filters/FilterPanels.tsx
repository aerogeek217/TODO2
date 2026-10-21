import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
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
              {...{ [ESCAPE_CLEARS_ATTR]: '' }}
              onKeyDown={(e) => {
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
  /**
   * The rows are people / tags: a right-click on one opens its Show tasks ·
   * Edit… · Delete… menu over the picker (without ticking it); Show tasks
   * runs `onShowTasks` first (the host closes the picker).
   */
  entityMenu?: 'person' | 'tag'
  onShowTasks?: () => void
}

/** A right-click's press keeps the focus where it is (the picker's search box). */
function keepFocusOnRightPress(e: MouseEvent) {
  if (e.button === 2) e.preventDefault()
}

/** Checkable entity rows (plus a leading "None" row, id 0), filtered by `searchText`. */
export function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  namePrefix,
  showDot = true,
  withNone = true,
  entityMenu,
  onShowTasks,
}: EntityDropdownItemsProps) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const q = searchText.toLowerCase()
  const showNone = withNone && (!q || 'none'.includes(q))
  const filtered = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .toSorted(byName)
  const onRowContextMenu = (id: number | undefined) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (id != null && id !== 0) setMenu({ id, x: e.clientX, y: e.clientY })
  }
  return (
    <>
      {showNone && (
        <label className={picker.dropdownItem} onClick={() => onToggle(0)} onContextMenu={entityMenu ? onRowContextMenu(0) : undefined}>
          <span className={`${picker.check} ${isChecked(0) ? picker.checked : ''}`} />
          <span className={picker.noneLabel}>None</span>
        </label>
      )}
      {filtered.map((entity) => (
        <label
          key={entity.id}
          className={picker.dropdownItem}
          onClick={() => onToggle(entity.id!)}
          onMouseDown={entityMenu ? keepFocusOnRightPress : undefined}
          onContextMenu={entityMenu ? onRowContextMenu(entity.id) : undefined}
        >
          <span className={`${picker.check} ${isChecked(entity.id!) ? picker.checked : ''}`} />
          {entity.icon ? (
            <span className={picker.dotIcon} style={{ color: entity.color }}>
              <StatusIcon icon={entity.icon} filled />
            </span>
          ) : showDot && entity.color ? (
            <span className={picker.dot} style={{ background: entity.color }} />
          ) : null}
          {namePrefix}
          {entity.name}
        </label>
      ))}
      {q && !showNone && filtered.length === 0 && (
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
