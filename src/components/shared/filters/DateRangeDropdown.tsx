import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DateAnchor } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { fixedAnchor } from '../../../stores/filter-store'
import { startOfToday } from '../../../utils/date'
import { DATE_FIELD_LABELS } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import topBar from '../../layout/TopBar.module.css'
import { cycleTri, triIcon, triLabel } from './FilterChipBar.shared'

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

interface DateRangeDropdownProps {
  active: boolean
  dateField: DateField
  startAnchor: DateAnchor | null
  endAnchor: DateAnchor | null
  includeNoDate: boolean
  hasScheduled: boolean | null
  hasDeadline: boolean | null
  onChangeDateField: (field: DateField) => void
  onChangeAnchors: (start: DateAnchor | null, end: DateAnchor | null) => void
  onChangeIncludeNoDate: (include: boolean) => void
  onChangeHasScheduled: (v: boolean | null) => void
  onChangeHasDeadline: (v: boolean | null) => void
}

/**
 * Desktop date-range dropdown chip. Owns its own open/close state, anchored
 * via `usePopoverAnchor`. Opening is non-committal — switching dateField
 * stamps a `today` anchor (per-field), but plain open/close leaves the
 * predicate untouched. The Clear button atomically resets anchors and the
 * has-scheduled / has-deadline tri-states.
 */
export function DateRangeDropdown({
  active,
  dateField,
  startAnchor,
  endAnchor,
  includeNoDate,
  hasScheduled,
  hasDeadline,
  onChangeDateField,
  onChangeAnchors,
  onChangeIncludeNoDate,
  onChangeHasScheduled,
  onChangeHasDeadline,
}: DateRangeDropdownProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleClose = useCallback(() => setOpen(false), [])

  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: handleClose,
  })

  // Open is non-committal: the dropdown shows blank inputs when no filter is
  // active, so closing without typing leaves the predicate untouched. Earlier
  // we auto-stamped a `today` anchor on open as a starting point — that
  // surprised users by activating a filter from a no-op interaction.
  const handleOpen = () => setOpen(!open)

  return (
    <div className={topBar.dropdownWrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={`${topBar.filterChip} ${active ? topBar.filterChipActive : ''}`}
        onClick={handleOpen}
        aria-expanded={open}
      >
        <svg
          className={topBar.filterIconSvg}
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {' '}Date
        <span className={`${topBar.chevron} ${open ? topBar.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={topBar.dropdownPanel}
          style={{ position: style.position, left: style.left, top: style.top }}
        >
          <div className={topBar.dateFieldSelector}>
            {(['date', 'scheduled', 'deadline', 'created', 'modified'] as const).map((field) => (
              <button
                type="button"
                key={field}
                className={`${topBar.dateFieldOption} ${dateField === field ? topBar.dateFieldOptionActive : ''}`}
                onClick={() => {
                  if (field === dateField) return
                  onChangeDateField(field)
                  const todayAnchor = fixedAnchor(startOfToday())
                  if (field === 'date' || field === 'scheduled' || field === 'deadline') {
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
          {dateField === 'date' && (
            <>
              <div className={topBar.dropdownDivider} />
              <label
                className={topBar.dropdownItem}
                onClick={() => onChangeIncludeNoDate(!includeNoDate)}
              >
                <span className={`${topBar.check} ${includeNoDate ? topBar.checked : ''}`} />
                Include tasks with no scheduled or deadline date
              </label>
            </>
          )}
          <div className={topBar.dropdownDivider} />
          <TriStateRow label="Has scheduled" value={hasScheduled} onChange={onChangeHasScheduled} />
          <TriStateRow label="Has deadline" value={hasDeadline} onChange={onChangeHasDeadline} />
          <div className={topBar.dropdownDivider} />
          <div className={topBar.dropdownActions}>
            <button
              type="button"
              className={`${topBar.dropdownAction} ${!active ? topBar.dropdownActionDisabled : ''}`}
              onClick={() => {
                onChangeAnchors(null, null)
                onChangeHasScheduled(null)
                onChangeHasDeadline(null)
                setOpen(false)
              }}
            >
              Clear
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
