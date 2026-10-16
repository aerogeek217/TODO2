import type { ReactNode, RefObject } from 'react'
import { MARKER_KEYS, type DateAnchor, type MarkersFilter } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { fixedAnchor } from '../../../utils/filter-criteria'
import { startOfToday } from '../../../utils/date'
import { DATE_FIELD_LABELS } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { StatusIcon } from '../StatusIcon'
import picker from './FilterPicker.module.css'
import { cycleTri, triIcon, triLabel } from './FilterChipBar.shared'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { HOT_LABEL, MARKER_COLOR, MARKER_LABELS, activeMarkers, isHotFilter, toggleHot, toggleMarker } from '../../../utils/markers'
import markerStyles from './MarkersPanel.module.css'
import { byName } from '../../../utils/sort-order'

/**
 * Bodies of the filter pickers, shared by the top bar's filter buttons
 * (`FilterChipBar`) and the list widgets' filter chips. Each renders inside
 * a caller-owned popover panel (`picker.dropdownPanel`).
 */

interface SelectionPanelBodyProps {
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

/** Select all / Deselect all, an optional search box, then the items. */
export function SelectionPanelBody({ allSelected, noneSelected, onSelectAll, onDeselectAll, search, searchInputRef, children }: SelectionPanelBodyProps) {
  return (
    <>
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
          <input
            ref={searchInputRef}
            className={picker.dropdownSearchInput}
            type="text"
            placeholder="Search..."
            value={search.text}
            onChange={(e) => search.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (search.text) search.setText('')
                else search.onEscape()
              }
            }}
          />
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
}: EntityDropdownItemsProps) {
  const q = searchText.toLowerCase()
  const showNone = withNone && (!q || 'none'.includes(q))
  const filtered = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .toSorted(byName)
  return (
    <>
      {showNone && (
        <label className={picker.dropdownItem} onClick={() => onToggle(0)}>
          <span className={`${picker.check} ${isChecked(0) ? picker.checked : ''}`} />
          <span className={picker.noneLabel}>None</span>
        </label>
      )}
      {filtered.map((entity) => (
        <label key={entity.id} className={picker.dropdownItem} onClick={() => onToggle(entity.id!)}>
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
    </>
  )
}

function TriStateRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  const next = cycleTri(value)
  const icon = triIcon(value)
  return (
    <label
      className={picker.dropdownItem}
      onClick={() => onChange(next)}
      title={triLabel(value)}
    >
      <span className={`${picker.triState} ${value !== null ? picker.triStateActive : ''}`}>
        {icon}
      </span>
      {label}
    </label>
  )
}

export interface DateRangePanelBodyProps {
  active: boolean
  dateField: DateField
  startAnchor: DateAnchor | null
  endAnchor: DateAnchor | null
  includeNoDate: boolean
  hasDeadline: boolean | null
  hasFollowup: boolean | null
  onChangeDateField: (field: DateField) => void
  onChangeAnchors: (start: DateAnchor | null, end: DateAnchor | null) => void
  onChangeIncludeNoDate: (include: boolean) => void
  onChangeHasDeadline: (v: boolean | null) => void
  onChangeHasFollowup: (v: boolean | null) => void
  /** After Clear resets the range and the presence filters. */
  onCleared?: () => void
}

/**
 * The date filter: which date field, a From / To range, "include tasks with
 * no due date", the has-due-date / has-follow-up tri-states, and Clear.
 */
export function DateRangePanelBody({
  active,
  dateField,
  startAnchor,
  endAnchor,
  includeNoDate,
  hasDeadline,
  hasFollowup,
  onChangeDateField,
  onChangeAnchors,
  onChangeIncludeNoDate,
  onChangeHasDeadline,
  onChangeHasFollowup,
  onCleared,
}: DateRangePanelBodyProps) {
  return (
    <>
      <div className={picker.dateFieldSelector}>
        {(['deadline', 'followup', 'created', 'modified'] as const).map((field) => (
          <button
            type="button"
            key={field}
            className={`${picker.dateFieldOption} ${dateField === field ? picker.dateFieldOptionActive : ''}`}
            onClick={() => {
              if (field === dateField) return
              onChangeDateField(field)
              const todayAnchor = fixedAnchor(startOfToday())
              if (field === 'deadline' || field === 'followup') {
                onChangeAnchors(todayAnchor, null)
              } else {
                onChangeAnchors(null, todayAnchor)
              }
            }}
          >
            {DATE_FIELD_LABELS[field]}
          </button>
        ))}
      </div>
      <div className={picker.dropdownDivider} />
      <div className={picker.dateRangeRow}>
        <label className={picker.dateLabel}>From</label>
        <DateAnchorInput
          value={startAnchor}
          onChange={(v) => onChangeAnchors(v, endAnchor)}
          aria-label="Date range start"
        />
      </div>
      <div className={picker.dateRangeRow}>
        <label className={picker.dateLabel}>To</label>
        <DateAnchorInput
          value={endAnchor}
          onChange={(v) => onChangeAnchors(startAnchor, v)}
          aria-label="Date range end"
        />
      </div>
      {dateField === 'deadline' && (
        <>
          <div className={picker.dropdownDivider} />
          <label
            className={picker.dropdownItem}
            onClick={() => onChangeIncludeNoDate(!includeNoDate)}
          >
            <span className={`${picker.check} ${includeNoDate ? picker.checked : ''}`} />
            Include tasks with no due date
          </label>
        </>
      )}
      <div className={picker.dropdownDivider} />
      <TriStateRow label="Has due date" value={hasDeadline} onChange={onChangeHasDeadline} />
      <TriStateRow label="Has follow-up" value={hasFollowup} onChange={onChangeHasFollowup} />
      <div className={picker.dropdownDivider} />
      <div className={picker.dropdownActions}>
        <button
          type="button"
          className={`${picker.dropdownAction} ${!active ? picker.dropdownActionDisabled : ''}`}
          onClick={() => {
            onChangeAnchors(null, null)
            onChangeHasDeadline(null)
            onChangeHasFollowup(null)
            onCleared?.()
          }}
        >
          Clear
        </button>
      </div>
    </>
  )
}

const TICK = (
  <svg className={markerStyles.tick} width="12" height="12" viewBox="0 0 16 16" aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * The Markers filter: Hot, then Urgent / Important / Focus checkboxes. A task
 * must be hot, or have every ticked marker (strict AND). Ticking Hot clears
 * and disables the single markers. Ticking keeps the picker open.
 */
export function MarkersPanelBody({ value, onChange }: {
  value: MarkersFilter | null
  onChange: (v: MarkersFilter | null) => void
}) {
  const hot = isHotFilter(value)
  const ticked = activeMarkers(value)
  return (
    <div className={markerStyles.panel} role="group" aria-label="Markers">
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
      {MARKER_KEYS.map((key) => {
        const on = ticked.includes(key)
        return (
          <button
            key={key}
            type="button"
            className={`${picker.dropdownItem} ${markerStyles.row} ${on ? markerStyles.rowOn : ''} ${hot ? markerStyles.rowDisabled : ''}`}
            role="checkbox"
            aria-checked={on}
            aria-disabled={hot || undefined}
            onClick={() => { if (!hot) onChange(toggleMarker(value, key)) }}
          >
            <span className={markerStyles.glyph} style={{ color: MARKER_COLOR[key] }}><MarkerIcon marker={key} /></span>
            <span className={markerStyles.label}>{MARKER_LABELS[key]}</span>
            {on && TICK}
          </button>
        )
      })}
      <p className={markerStyles.note}>
        {hot
          ? 'Hot already combines these markers. Clear Hot to pick them one by one.'
          : 'Tasks must have every ticked marker (strict AND). Urgent includes urgent by due date.'}
      </p>
    </div>
  )
}
