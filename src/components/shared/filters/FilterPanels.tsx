import type { ReactNode, RefObject } from 'react'
import type { DateAnchor } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { fixedAnchor } from '../../../stores/filter-store'
import { startOfToday } from '../../../utils/date'
import { DATE_FIELD_LABELS } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { StatusIcon } from '../StatusIcon'
import topBar from '../../layout/TopBar.module.css'
import { cycleTri, triIcon, triLabel } from './FilterChipBar.shared'

/**
 * Bodies of the filter pickers, shared by the top bar's filter buttons
 * (`FilterChipBar`) and the list widgets' filter chips. Each renders inside
 * a caller-owned popover panel (`topBar.dropdownPanel`).
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
      <div className={topBar.dropdownActions}>
        <button
          type="button"
          className={`${topBar.dropdownAction} ${allSelected ? topBar.dropdownActionDisabled : ''}`}
          onClick={allSelected ? undefined : onSelectAll}
        >
          Select all
        </button>
        <span className={topBar.dropdownActionSep}>/</span>
        <button
          type="button"
          className={`${topBar.dropdownAction} ${noneSelected ? topBar.dropdownActionDisabled : ''}`}
          onClick={noneSelected ? undefined : onDeselectAll}
        >
          Deselect all
        </button>
      </div>
      <div className={topBar.dropdownDivider} />
      {search && (
        <div className={topBar.dropdownSearchWrapper}>
          <input
            ref={searchInputRef}
            className={topBar.dropdownSearchInput}
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
      <div className={search ? topBar.dropdownItemsScrollable : undefined}>{children}</div>
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
    .toSorted((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      {showNone && (
        <label className={topBar.dropdownItem} onClick={() => onToggle(0)}>
          <span className={`${topBar.check} ${isChecked(0) ? topBar.checked : ''}`} />
          <span className={topBar.noneLabel}>None</span>
        </label>
      )}
      {filtered.map((entity) => (
        <label key={entity.id} className={topBar.dropdownItem} onClick={() => onToggle(entity.id!)}>
          <span className={`${topBar.check} ${isChecked(entity.id!) ? topBar.checked : ''}`} />
          {entity.icon ? (
            <span className={topBar.dotIcon} style={{ color: entity.color }}>
              <StatusIcon icon={entity.icon} filled />
            </span>
          ) : showDot && entity.color ? (
            <span className={topBar.dot} style={{ background: entity.color }} />
          ) : null}
          {namePrefix}
          {entity.name}
        </label>
      ))}
      {q && !showNone && filtered.length === 0 && (
        <div className={topBar.dropdownEmpty}>No matches</div>
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
      className={topBar.dropdownItem}
      onClick={() => onChange(next)}
      title={triLabel(value)}
    >
      <span className={`${topBar.triState} ${value !== null ? topBar.triStateActive : ''}`}>
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
      <div className={topBar.dateFieldSelector}>
        {(['deadline', 'followup', 'created', 'modified'] as const).map((field) => (
          <button
            type="button"
            key={field}
            className={`${topBar.dateFieldOption} ${dateField === field ? topBar.dateFieldOptionActive : ''}`}
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
      <div className={topBar.dropdownDivider} />
      <div className={topBar.dateRangeRow}>
        <label className={topBar.dateLabel}>From</label>
        <DateAnchorInput
          value={startAnchor}
          onChange={(v) => onChangeAnchors(v, endAnchor)}
          aria-label="Date range start"
        />
      </div>
      <div className={topBar.dateRangeRow}>
        <label className={topBar.dateLabel}>To</label>
        <DateAnchorInput
          value={endAnchor}
          onChange={(v) => onChangeAnchors(startAnchor, v)}
          aria-label="Date range end"
        />
      </div>
      {dateField === 'deadline' && (
        <>
          <div className={topBar.dropdownDivider} />
          <label
            className={topBar.dropdownItem}
            onClick={() => onChangeIncludeNoDate(!includeNoDate)}
          >
            <span className={`${topBar.check} ${includeNoDate ? topBar.checked : ''}`} />
            Include tasks with no due date
          </label>
        </>
      )}
      <div className={topBar.dropdownDivider} />
      <TriStateRow label="Has due date" value={hasDeadline} onChange={onChangeHasDeadline} />
      <TriStateRow label="Has follow-up" value={hasFollowup} onChange={onChangeHasFollowup} />
      <div className={topBar.dropdownDivider} />
      <div className={topBar.dropdownActions}>
        <button
          type="button"
          className={`${topBar.dropdownAction} ${!active ? topBar.dropdownActionDisabled : ''}`}
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

const FOCUS_OPTIONS: ReadonlyArray<{ value: boolean | null; label: string }> = [
  { value: null, label: 'Any task' },
  { value: true, label: 'In focus' },
  { value: false, label: 'Not in focus' },
]

/** The focus filter: any task / only tasks in focus / only tasks not in focus. */
export function FocusPanelBody({ value, onChange }: {
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <div role="radiogroup" aria-label="Focus">
      {FOCUS_OPTIONS.map((opt) => (
        <label
          key={String(opt.value)}
          className={topBar.dropdownItem}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          <span className={`${topBar.check} ${value === opt.value ? topBar.checked : ''}`} />
          {opt.label}
        </label>
      ))}
    </div>
  )
}
