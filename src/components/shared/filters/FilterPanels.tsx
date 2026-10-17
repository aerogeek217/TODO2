import { useState, type ReactNode, type RefObject } from 'react'
import { DATE_FIELD_VALUES, MARKER_KEYS, type DateAnchor, type DateFilters, type MarkersFilter } from '../../../models'
import type { DateField } from '../../../models/app-view'
import {
  activeDateFields,
  datePresenceOf,
  dateRangeOf,
  hasDateFilters,
  isDateMatchOn,
  isOptionalDateField,
  withDateMatch,
} from '../../../utils/date-filters'
import { DATE_FIELD_LABELS } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { StatusIcon } from '../StatusIcon'
import picker from './FilterPicker.module.css'
import { cycleTri, triIcon, triLabel } from './FilterChipBar.shared'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { HOT_LABEL, MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL, activeMarkers, isHotFilter, toggleHot, toggleMarker } from '../../../utils/markers'
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
  /** The date filters edited: one clause per date type. */
  dates: DateFilters
  /** The date type selected when the panel opens; default the first that filters, else Due. */
  initialField?: DateField
  onChange: (dates: DateFilters) => void
  /** After Clear resets every date type. */
  onCleared?: () => void
}

/** "Include tasks with no …" per date type that offers it. */
const NO_DATE_LABEL: Partial<Record<DateField, string>> = {
  deadline: 'Include tasks with no due date',
  followup: 'Include tasks with no follow-up',
}

/**
 * The date filters, one clause per date type (a task must pass every one):
 * the type buttons pick which type From / To and "include tasks with no …"
 * edit — picking one writes nothing; a type that filters is lit — then the
 * has-due-date / has-follow-up tri-states and Clear (every type).
 */
export function DateRangePanelBody({ dates, initialField, onChange, onCleared }: DateRangePanelBodyProps) {
  const [field, setField] = useState<DateField>(() => initialField ?? activeDateFields(dates)[0] ?? 'deadline')
  const { start, end, includeNoDate } = dateRangeOf(dates[field])
  const hasEnd = start !== null || end !== null
  const setRange = (s: DateAnchor | null, e: DateAnchor | null, include = includeNoDate) => {
    onChange(withDateMatch(dates, field, { match: 'range', start: s, end: e, includeNoDate: include }))
  }
  const setPresence = (f: DateField, v: boolean | null) => {
    onChange(withDateMatch(dates, f, v === null ? null : { match: v ? 'set' : 'unset' }))
  }
  const noDateLabel = isOptionalDateField(field) ? NO_DATE_LABEL[field] : undefined
  return (
    <>
      <div className={picker.dateFieldSelector}>
        {DATE_FIELD_VALUES.map((f) => {
          const lit = isDateMatchOn(dates[f])
          return (
            <button
              type="button"
              key={f}
              aria-pressed={f === field}
              data-filtering={lit ? '' : undefined}
              className={`${picker.dateFieldOption} ${f === field ? picker.dateFieldOptionActive : ''} ${lit ? picker.dateFieldOptionLit : ''}`}
              onClick={() => setField(f)}
            >
              {DATE_FIELD_LABELS[f]}
            </button>
          )
        })}
      </div>
      <div className={picker.dropdownDivider} />
      <div className={picker.dateRangeRow}>
        <label className={picker.dateLabel}>From</label>
        <DateAnchorInput
          value={start}
          onChange={(v) => setRange(v, end)}
          aria-label="Date range start"
        />
      </div>
      <div className={picker.dateRangeRow}>
        <label className={picker.dateLabel}>To</label>
        <DateAnchorInput
          value={end}
          onChange={(v) => setRange(start, v)}
          aria-label="Date range end"
        />
      </div>
      {noDateLabel && (
        <>
          <div className={picker.dropdownDivider} />
          <label
            className={`${picker.dropdownItem} ${hasEnd ? '' : picker.dropdownItemDisabled}`}
            aria-disabled={!hasEnd}
            onClick={() => { if (hasEnd) setRange(start, end, !includeNoDate) }}
          >
            <span className={`${picker.check} ${includeNoDate ? picker.checked : ''}`} />
            {noDateLabel}
          </label>
        </>
      )}
      <div className={picker.dropdownDivider} />
      <TriStateRow label="Has due date" value={datePresenceOf(dates.deadline)} onChange={(v) => setPresence('deadline', v)} />
      <TriStateRow label="Has follow-up" value={datePresenceOf(dates.followup)} onChange={(v) => setPresence('followup', v)} />
      <div className={picker.dropdownDivider} />
      <div className={picker.dropdownActions}>
        <button
          type="button"
          className={`${picker.dropdownAction} ${!hasDateFilters(dates) ? picker.dropdownActionDisabled : ''}`}
          onClick={() => {
            onChange({})
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
 * The Priority filter: Hot, then Focus / Urgent / Important checkboxes. A task
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
          ? 'Hot already combines these. Clear Hot to pick them one by one.'
          : 'Tasks must have everything ticked (strict AND). Urgent includes urgent by due date.'}
      </p>
    </div>
  )
}
