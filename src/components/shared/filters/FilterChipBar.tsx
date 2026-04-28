import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  DateAnchor,
  OrgFilterMode,
  PersonFilterMode,
  TodoPredicate,
} from '../../../models'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { fixedAnchor } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { startOfToday } from '../../../utils/date'
import { toggleItem } from '../../../utils/filter'
import { DATE_FIELD_LABELS, DATE_FIELD_LABELS_SHORT } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { StatusIcon } from '../StatusIcon'
import topBar from '../../layout/TopBar.module.css'
import sheet from '../../overlays/FilterSheet.module.css'

export type FilterChipDensity = 'desktop' | 'mobile'

interface FilterChipBarProps {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  density?: FilterChipDensity
  /**
   * If `true` and an active filter is in effect, the Clear-all button is
   * rendered. Default `true`. Mobile callers may set `onClearExtra` to do
   * additional work after clearAll fires (e.g., close the sheet).
   */
  showClearAll?: boolean
  /** Optional follow-on after the user clicks Clear all (e.g., close the sheet). */
  onClearExtra?: () => void
  /**
   * Optional clear-all override. When provided, the Clear-all button calls
   * this instead of `onChange({...defaultPredicate})`. Used by callers that
   * route changes through a store carrying non-predicate state (e.g.
   * runtime-filter spec/value) — those callers prefer their dedicated clear
   * path so the extra slots get reset along with the predicate.
   */
  onClearAll?: () => void
}

const DEFAULT_PREDICATE: TodoPredicate = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  orgIds: null,
  orgFilterMode: 'include-people',
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasScheduled: null,
  hasDeadline: null,
  tags: null,
}

type EntityKey = 'project' | 'people' | 'org' | 'status' | 'tags'
type MobileSection = EntityKey | 'toggles' | 'date'

function hasAnyFilter(p: TodoPredicate): boolean {
  return (
    p.showCompleted ||
    p.showHiddenStatuses ||
    p.personIds !== null ||
    p.orgIds !== null ||
    p.projectIds !== null ||
    p.statusIds !== null ||
    p.searchText !== '' ||
    p.dateRangeStart !== null ||
    p.dateRangeEnd !== null ||
    p.hasScheduled !== null ||
    p.hasDeadline !== null ||
    (p.tags ?? null) !== null
  )
}

const cycleTri = (v: boolean | null): boolean | null =>
  v === null ? true : v === true ? false : null
const triIcon = (v: boolean | null) => (v === null ? '—' : v === true ? '✓' : '✕')
const triLabel = (v: boolean | null) =>
  v === null ? 'No filter' : v ? 'Only tasks with this field' : 'Only tasks without this field'

// ─── Desktop subcomponents ─────────────────────────────────────────────────

interface FilterDropdownProps {
  label: React.ReactNode
  active: boolean
  allSelected: boolean
  noneSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onOpen?: () => void
  onClose?: () => void
  searchable?: boolean
  children: React.ReactNode | ((searchText: string) => React.ReactNode)
}

function FilterDropdown({
  label,
  active,
  allSelected,
  noneSelected,
  onSelectAll,
  onDeselectAll,
  onOpen,
  onClose,
  searchable,
  children,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    setOpen(false)
    setSearchText('')
    onClose?.()
  }, [onClose])

  // Portal + flip + clamp: when this chip-row sits inside the list editor
  // modal (via ListFilterEditor), the dialog body's `overflow: auto` used to
  // clip the panel and force the user to scroll inside the modal. Routing
  // through usePopoverAnchor + createPortal mirrors the IconSelect fix
  // (triage-2026-04-27 batch2 P3 / item 3) for the rest of the editor's
  // dropdowns. usePopoverAnchor also subsumes the prior `useRightEdgeFlip`
  // X-axis flip and adds a Y-axis flip when there's no room below.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: handleClose,
  })

  const handleToggle = useCallback(() => {
    if (open) {
      handleClose()
    } else {
      setOpen(true)
      onOpen?.()
    }
  }, [open, onOpen, handleClose])

  useEffect(() => {
    if (open && searchable) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, searchable])

  const rendered = typeof children === 'function' ? children(searchText) : children

  return (
    <div className={topBar.dropdownWrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={`${topBar.filterChip} ${active ? topBar.filterChipActive : ''}`}
        onClick={handleToggle}
        aria-expanded={open}
      >
        {label}
        <span className={`${topBar.chevron} ${open ? topBar.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={topBar.dropdownPanel}
          style={{ position: style.position, left: style.left, top: style.top }}
        >
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
          {searchable && (
            <div className={topBar.dropdownSearchWrapper}>
              <input
                ref={searchRef}
                className={topBar.dropdownSearchInput}
                type="text"
                placeholder="Search..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchText) setSearchText('')
                    else handleClose()
                  }
                }}
              />
            </div>
          )}
          <div className={searchable ? topBar.dropdownItemsScrollable : undefined}>{rendered}</div>
        </div>,
        document.body,
      )}
    </div>
  )
}

interface EntityDropdownItemsProps {
  searchText: string
  entities: { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
  showDot?: boolean
}

function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  namePrefix,
  showDot = true,
}: EntityDropdownItemsProps) {
  const q = searchText.toLowerCase()
  const showNone = !q || 'none'.includes(q)
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

function DateRangeDropdown({
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

// ─── Mobile subcomponents ──────────────────────────────────────────────────

interface AccordionSectionProps {
  label: string
  badge?: number
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}

function AccordionSection({ label, badge, open, onToggle, children }: AccordionSectionProps) {
  return (
    <div className={sheet.entitySection}>
      <div className={sheet.entityHeader} onClick={onToggle}>
        <span className={sheet.filterLabel}>
          {label}
          {badge !== undefined && badge > 0 && <span className={sheet.activeCount}>{badge}</span>}
        </span>
        <span className={`${sheet.entityChevron} ${open ? sheet.entityChevronOpen : ''}`}>▸</span>
      </div>
      {open && children}
    </div>
  )
}

interface MobileEntityListProps {
  entities: { id?: number; name: string; color?: string }[]
  filterIds: Set<number> | null
  onToggle: (id: number) => void
  noneLabel: string
  searchPlaceholder: string
  searchText: string
  onSearchChange: (text: string) => void
  /** Display name prefix (e.g. "@" for people, "#" for tags). */
  namePrefix?: string
  /** When `false`, the "Unassigned" sentinel row is hidden (used for tags). */
  showNoneSentinel?: boolean
}

function MobileEntityList({
  entities,
  filterIds,
  onToggle,
  noneLabel,
  searchPlaceholder,
  searchText,
  onSearchChange,
  namePrefix,
  showNoneSentinel = true,
}: MobileEntityListProps) {
  return (
    <div className={sheet.entityList}>
      <input
        className={sheet.entitySearchInput}
        placeholder={searchPlaceholder}
        value={searchText}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {showNoneSentinel && (
        <div className={sheet.entityItem} onClick={() => onToggle(0)}>
          <span
            className={sheet.entityDot}
            style={{ background: 'var(--color-text-muted)' }}
          />
          <span className={`${sheet.entityName} ${sheet.entityNone}`}>{noneLabel}</span>
          <input
            type="checkbox"
            className={sheet.entityCheck}
            tabIndex={-1}
            aria-hidden="true"
            checked={filterIds === null || filterIds.has(0)}
            readOnly
          />
        </div>
      )}
      {entities
        .filter((e) => !searchText || e.name.toLowerCase().includes(searchText.toLowerCase()))
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((e) => (
          <div key={e.id} className={sheet.entityItem} onClick={() => onToggle(e.id!)}>
            <span
              className={sheet.entityDot}
              style={{ background: e.color || 'var(--color-accent)' }}
            />
            <span className={sheet.entityName}>
              {namePrefix}
              {e.name}
            </span>
            <input
              type="checkbox"
              className={sheet.entityCheck}
              tabIndex={-1}
              aria-hidden="true"
              checked={filterIds === null || filterIds.has(e.id!)}
              readOnly
            />
          </div>
        ))}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export function FilterChipBar({
  predicate: rawPredicate,
  onChange,
  density = 'desktop',
  showClearAll = true,
  onClearExtra,
  onClearAll,
}: FilterChipBarProps) {
  const p = useMemo<TodoPredicate>(
    () => ({ ...DEFAULT_PREDICATE, ...rawPredicate }),
    [rawPredicate],
  )

  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const [previewEmpty, setPreviewEmpty] = useState<EntityKey | null>(null)
  const [openSection, setOpenSection] = useState<MobileSection | null>(null)
  const [entitySearch, setEntitySearch] = useState('')

  // arrays → Sets for O(1) lookups in hot paths
  const personIdsSet = useMemo(() => (p.personIds ? new Set(p.personIds) : null), [p.personIds])
  const orgIdsSet = useMemo(() => (p.orgIds ? new Set(p.orgIds) : null), [p.orgIds])
  const projectIdsSet = useMemo(() => (p.projectIds ? new Set(p.projectIds) : null), [p.projectIds])
  const statusIdsSet = useMemo(() => (p.statusIds ? new Set(p.statusIds) : null), [p.statusIds])
  const tagIdsSet = useMemo(() => (p.tags ? new Set(p.tags) : null), [p.tags])

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name)), [tags])
  const allTagIds = useMemo(() => sortedTags.map((t) => t.id!), [sortedTags])

  const peopleActive = p.personIds !== null
  const orgsActive = p.orgIds !== null
  const projectsActive = p.projectIds !== null
  const statusActive = p.statusIds !== null
  const tagsActive = (p.tags ?? null) !== null
  const dateActive =
    p.dateRangeStart !== null ||
    p.dateRangeEnd !== null ||
    p.hasScheduled !== null ||
    p.hasDeadline !== null
  const active = hasAnyFilter(p)

  const update = useCallback(
    (patch: Partial<TodoPredicate>) => {
      onChange({ ...p, ...patch })
    },
    [p, onChange],
  )

  const setPersonIds = useCallback(
    (next: Set<number> | null) =>
      update({ personIds: next ? Array.from(next) : null }),
    [update],
  )
  const setOrgIds = useCallback(
    (next: Set<number> | null) => update({ orgIds: next ? Array.from(next) : null }),
    [update],
  )
  const setProjectIds = useCallback(
    (next: Set<number> | null) => update({ projectIds: next ? Array.from(next) : null }),
    [update],
  )
  const setStatusIds = useCallback(
    (next: Set<number> | null) => update({ statusIds: next ? Array.from(next) : null }),
    [update],
  )
  const setTags = useCallback(
    (next: Set<number> | null) => update({ tags: next ? Array.from(next) : null }),
    [update],
  )

  const handlePersonToggle = (personId: number) => {
    if (previewEmpty === 'people') {
      setPreviewEmpty(null)
      setPersonIds(new Set([personId]))
      return
    }
    const allIds = [0, ...people.map((x) => x.id!)]
    setPersonIds(toggleItem(personIdsSet, personId, allIds))
  }
  const handleOrgToggle = (orgId: number) => {
    if (previewEmpty === 'org') {
      setPreviewEmpty(null)
      setOrgIds(new Set([orgId]))
      return
    }
    const allIds = [0, ...orgs.map((o) => o.id!)]
    setOrgIds(toggleItem(orgIdsSet, orgId, allIds))
  }
  const handleProjectToggle = (projectId: number) => {
    if (previewEmpty === 'project') {
      setPreviewEmpty(null)
      setProjectIds(new Set([projectId]))
      return
    }
    const allIds = [0, ...projects.map((x) => x.id!)]
    setProjectIds(toggleItem(projectIdsSet, projectId, allIds))
  }
  const handleStatusToggle = (statusId: number) => {
    if (previewEmpty === 'status') {
      setPreviewEmpty(null)
      setStatusIds(new Set([statusId]))
      return
    }
    const allIds = [0, ...statuses.map((s) => s.id!)]
    setStatusIds(toggleItem(statusIdsSet, statusId, allIds))
  }
  const handleTagToggle = (tagId: number) => {
    if (previewEmpty === 'tags') {
      setPreviewEmpty(null)
      setTags(new Set([tagId]))
      return
    }
    setTags(toggleItem(tagIdsSet, tagId, allTagIds))
  }

  const isPersonChecked = (id: number) =>
    previewEmpty === 'people' ? false : personIdsSet === null || personIdsSet.has(id)
  const isOrgChecked = (id: number) =>
    previewEmpty === 'org' ? false : orgIdsSet === null || orgIdsSet.has(id)
  const isProjectChecked = (id: number) =>
    previewEmpty === 'project' ? false : projectIdsSet === null || projectIdsSet.has(id)
  const isStatusChecked = (id: number) =>
    previewEmpty === 'status' ? false : statusIdsSet === null || statusIdsSet.has(id)
  const isTagChecked = (id: number) =>
    previewEmpty === 'tags' ? false : tagIdsSet === null || tagIdsSet.has(id)

  const peopleNone = previewEmpty === 'people' || (personIdsSet !== null && personIdsSet.size === 0)
  const orgsNone = previewEmpty === 'org' || (orgIdsSet !== null && orgIdsSet.size === 0)
  const projectsNone = previewEmpty === 'project' || (projectIdsSet !== null && projectIdsSet.size === 0)
  const statusNone = previewEmpty === 'status' || (statusIdsSet !== null && statusIdsSet.size === 0)
  const tagsNone = previewEmpty === 'tags' || (tagIdsSet !== null && tagIdsSet.size === 0)

  const clearAll = () => {
    setPreviewEmpty(null)
    if (onClearAll) onClearAll()
    else onChange({ ...DEFAULT_PREDICATE })
    onClearExtra?.()
  }

  if (density === 'mobile') {
    const handleSection = (s: MobileSection) => {
      setOpenSection(openSection === s ? null : s)
      setEntitySearch('')
    }
    const togglesActiveCount = [p.showCompleted, p.showHiddenStatuses].filter(Boolean).length
    return (
      <>
        {/* Toggles section */}
        <AccordionSection
          label="Show / hide"
          badge={togglesActiveCount}
          open={openSection === 'toggles'}
          onToggle={() => handleSection('toggles')}
        >
          <div>
            <div className={sheet.filterRow}>
              <span className={sheet.filterLabel}>
                <span className={sheet.filterLabelIcon}>👁</span>
                Show hidden
              </span>
              <button
                className={`${sheet.toggle} ${p.showHiddenStatuses ? sheet.toggleActive : ''}`}
                onClick={() => update({ showHiddenStatuses: !p.showHiddenStatuses })}
                role="switch"
                aria-checked={p.showHiddenStatuses}
                aria-label="Show hidden statuses"
              />
            </div>
            <div className={sheet.filterRow}>
              <span className={sheet.filterLabel}>
                <span className={sheet.filterLabelIcon}>✓</span>
                Completed
              </span>
              <button
                className={`${sheet.toggle} ${p.showCompleted ? sheet.toggleActive : ''}`}
                onClick={() => update({ showCompleted: !p.showCompleted })}
                role="switch"
                aria-checked={p.showCompleted}
                aria-label="Show completed"
              />
            </div>
          </div>
        </AccordionSection>

        {/* Date range section */}
        <AccordionSection
          label="Date range"
          badge={dateActive ? 1 : 0}
          open={openSection === 'date'}
          onToggle={() => handleSection('date')}
        >
          <div className={sheet.dateSection}>
            <div className={sheet.dateFieldSelector}>
              {(['date', 'scheduled', 'deadline', 'created', 'modified'] as const).map((field) => (
                <button
                  key={field}
                  className={`${sheet.dateFieldOption} ${p.dateField === field ? sheet.dateFieldOptionActive : ''}`}
                  onClick={() => update({ dateField: field })}
                >
                  {DATE_FIELD_LABELS_SHORT[field]}
                </button>
              ))}
            </div>
            <div className={sheet.dateInputs}>
              <DateAnchorInput
                value={p.dateRangeStart}
                onChange={(v) => update({ dateRangeStart: v, dateRangeEnd: p.dateRangeEnd })}
                aria-label="Date range start"
              />
              <span style={{ color: 'var(--color-text-muted)' }}>to</span>
              <DateAnchorInput
                value={p.dateRangeEnd}
                onChange={(v) => update({ dateRangeStart: p.dateRangeStart, dateRangeEnd: v })}
                aria-label="Date range end"
              />
            </div>
            {p.dateField === 'date' && (
              <div className={sheet.filterRow}>
                <span className={sheet.filterLabel}>
                  <span className={sheet.filterLabelIcon}>∅</span>
                  Include tasks with no date
                </span>
                <button
                  className={`${sheet.toggle} ${p.dateRangeIncludeNoDate ? sheet.toggleActive : ''}`}
                  onClick={() => update({ dateRangeIncludeNoDate: !p.dateRangeIncludeNoDate })}
                  role="switch"
                  aria-checked={p.dateRangeIncludeNoDate}
                  aria-label="Include tasks with no date"
                />
              </div>
            )}
            <div className={sheet.filterRow}>
              <span className={sheet.filterLabel}>
                <span className={sheet.filterLabelIcon}>📅</span>
                Has scheduled
              </span>
              <button
                className={`${sheet.triToggle} ${p.hasScheduled !== null ? sheet.triToggleActive : ''}`}
                onClick={() => update({ hasScheduled: cycleTri(p.hasScheduled) })}
                aria-label={`Has scheduled: ${triLabel(p.hasScheduled)}`}
                title={triLabel(p.hasScheduled)}
              >
                {triIcon(p.hasScheduled)}
              </button>
            </div>
            <div className={sheet.filterRow}>
              <span className={sheet.filterLabel}>
                <span className={sheet.filterLabelIcon}>⚑</span>
                Has deadline
              </span>
              <button
                className={`${sheet.triToggle} ${p.hasDeadline !== null ? sheet.triToggleActive : ''}`}
                onClick={() => update({ hasDeadline: cycleTri(p.hasDeadline) })}
                aria-label={`Has deadline: ${triLabel(p.hasDeadline)}`}
                title={triLabel(p.hasDeadline)}
              >
                {triIcon(p.hasDeadline)}
              </button>
            </div>
          </div>
        </AccordionSection>

        {/* Projects */}
        {projects.length > 0 && (
          <AccordionSection
            label="Projects"
            badge={projectIdsSet?.size}
            open={openSection === 'project'}
            onToggle={() => handleSection('project')}
          >
            <MobileEntityList
              entities={projects}
              filterIds={projectIdsSet}
              onToggle={handleProjectToggle}
              noneLabel="No project"
              searchPlaceholder="Search projects..."
              searchText={entitySearch}
              onSearchChange={setEntitySearch}
            />
          </AccordionSection>
        )}

        {/* People */}
        {people.length > 0 && (
          <AccordionSection
            label="People"
            badge={personIdsSet?.size}
            open={openSection === 'people'}
            onToggle={() => handleSection('people')}
          >
            <div className={sheet.dateFieldSelector}>
              {(
                [
                  ['include-orgs', 'Orgs'],
                  ['direct-only', 'People only'],
                ] as [PersonFilterMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`${sheet.dateFieldOption} ${p.personFilterMode === mode ? sheet.dateFieldOptionActive : ''}`}
                  onClick={() => update({ personFilterMode: mode })}
                >
                  {label}
                </button>
              ))}
            </div>
            <MobileEntityList
              entities={people}
              filterIds={personIdsSet}
              onToggle={handlePersonToggle}
              noneLabel="Unassigned"
              searchPlaceholder="Search people..."
              searchText={entitySearch}
              onSearchChange={setEntitySearch}
            />
          </AccordionSection>
        )}

        {/* Orgs */}
        {orgs.length > 0 && (
          <AccordionSection
            label="Orgs"
            badge={orgIdsSet?.size}
            open={openSection === 'org'}
            onToggle={() => handleSection('org')}
          >
            <div className={sheet.dateFieldSelector}>
              {(
                [
                  ['include-people', 'People'],
                  ['direct-only', 'Org only'],
                ] as [OrgFilterMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`${sheet.dateFieldOption} ${p.orgFilterMode === mode ? sheet.dateFieldOptionActive : ''}`}
                  onClick={() => update({ orgFilterMode: mode })}
                >
                  {label}
                </button>
              ))}
            </div>
            <MobileEntityList
              entities={orgs}
              filterIds={orgIdsSet}
              onToggle={handleOrgToggle}
              noneLabel="No org"
              searchPlaceholder="Search orgs..."
              searchText={entitySearch}
              onSearchChange={setEntitySearch}
            />
          </AccordionSection>
        )}

        {/* Tags */}
        <AccordionSection
          label="Tags"
          badge={tagIdsSet?.size}
          open={openSection === 'tags'}
          onToggle={() => handleSection('tags')}
        >
          <div className={sheet.entityList}>
            {sortedTags.length === 0 ? (
              <div className={sheet.entityItem}>
                <span className={`${sheet.entityName} ${sheet.entityNone}`}>No tags yet.</span>
              </div>
            ) : (
              <>
                <input
                  className={sheet.entitySearchInput}
                  placeholder="Search tags..."
                  value={entitySearch}
                  onChange={(e) => setEntitySearch(e.target.value)}
                />
                {sortedTags
                  .filter(
                    (t) =>
                      !entitySearch || t.name.toLowerCase().includes(entitySearch.toLowerCase()),
                  )
                  .map((tag) => (
                    <div
                      key={tag.id}
                      className={sheet.entityItem}
                      onClick={() => handleTagToggle(tag.id!)}
                    >
                      <span
                        className={sheet.entityDot}
                        style={{ background: tag.color || 'var(--color-accent)' }}
                      />
                      <span className={sheet.entityName}>#{tag.name}</span>
                      <input
                        type="checkbox"
                        className={sheet.entityCheck}
                        tabIndex={-1}
                        aria-hidden="true"
                        checked={tagIdsSet === null || tagIdsSet.has(tag.id!)}
                        readOnly
                      />
                    </div>
                  ))}
              </>
            )}
          </div>
        </AccordionSection>

        {/* Status */}
        {statuses.length > 0 && (
          <AccordionSection
            label="Status"
            badge={statusIdsSet?.size}
            open={openSection === 'status'}
            onToggle={() => handleSection('status')}
          >
            <MobileEntityList
              entities={statuses.map((s) =>
                s.hideByDefault ? { ...s, name: `${s.name} (hidden)` } : s,
              )}
              filterIds={statusIdsSet}
              onToggle={handleStatusToggle}
              noneLabel="No status"
              searchPlaceholder="Search statuses..."
              searchText={entitySearch}
              onSearchChange={setEntitySearch}
            />
          </AccordionSection>
        )}

        {showClearAll && active && (
          <button className={sheet.clearButton} onClick={clearAll}>
            Clear all filters
          </button>
        )}
      </>
    )
  }

  // ── Desktop layout ──────────────────────────────────────────────────────
  return (
    <>
      {projects.length > 0 && (
        <FilterDropdown
          label={
            <>
              <svg
                className={topBar.filterIconSvg}
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 4.5l6-3 6 3v7l-6 3-6-3z" />
                <path d="M2 4.5l6 3 6-3M8 7.5v7" />
              </svg>
              {' '}Project
            </>
          }
          active={projectsActive || previewEmpty === 'project'}
          allSelected={!projectsActive && previewEmpty !== 'project'}
          noneSelected={projectsNone}
          onSelectAll={() => {
            setPreviewEmpty(null)
            setProjectIds(null)
          }}
          onDeselectAll={() => {
            setPreviewEmpty(null)
            setProjectIds(new Set())
          }}
          onOpen={() => {
            if (!projectsActive) setPreviewEmpty('project')
          }}
          onClose={() => {
            if (previewEmpty === 'project') setPreviewEmpty(null)
          }}
          searchable
        >
          {(searchText: string) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={projects}
              isChecked={isProjectChecked}
              onToggle={handleProjectToggle}
            />
          )}
        </FilterDropdown>
      )}

      {people.length > 0 && (
        <FilterDropdown
          label={
            <>
              <span className={topBar.filterIcon}>@</span> People
            </>
          }
          active={peopleActive || previewEmpty === 'people'}
          allSelected={!peopleActive && previewEmpty !== 'people'}
          noneSelected={peopleNone}
          onSelectAll={() => {
            setPreviewEmpty(null)
            setPersonIds(null)
          }}
          onDeselectAll={() => {
            setPreviewEmpty(null)
            setPersonIds(new Set())
          }}
          onOpen={() => {
            if (!peopleActive) setPreviewEmpty('people')
          }}
          onClose={() => {
            if (previewEmpty === 'people') setPreviewEmpty(null)
          }}
          searchable
        >
          {(searchText: string) => (
            <>
              <div className={topBar.orgModeToggle}>
                {(
                  [
                    ['include-orgs', 'Orgs'],
                    ['direct-only', 'People only'],
                  ] as [PersonFilterMode, string][]
                ).map(([mode, label]) => (
                  <button
                    type="button"
                    key={mode}
                    className={`${topBar.orgModeOption} ${p.personFilterMode === mode ? topBar.orgModeOptionActive : ''}`}
                    onClick={() => update({ personFilterMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <EntityDropdownItems
                searchText={searchText}
                entities={people}
                isChecked={isPersonChecked}
                onToggle={handlePersonToggle}
                namePrefix="@"
                showDot={false}
              />
            </>
          )}
        </FilterDropdown>
      )}

      {orgs.length > 0 && (
        <FilterDropdown
          label={
            <>
              <span className={topBar.filterIcon}>@</span> Org
            </>
          }
          active={orgsActive || previewEmpty === 'org'}
          allSelected={!orgsActive && previewEmpty !== 'org'}
          noneSelected={orgsNone}
          onSelectAll={() => {
            setPreviewEmpty(null)
            setOrgIds(null)
          }}
          onDeselectAll={() => {
            setPreviewEmpty(null)
            setOrgIds(new Set())
          }}
          onOpen={() => {
            if (!orgsActive) setPreviewEmpty('org')
          }}
          onClose={() => {
            if (previewEmpty === 'org') setPreviewEmpty(null)
          }}
          searchable
        >
          {(searchText: string) => (
            <>
              <div className={topBar.orgModeToggle}>
                {(
                  [
                    ['include-people', 'People'],
                    ['direct-only', 'Org only'],
                  ] as [OrgFilterMode, string][]
                ).map(([mode, label]) => (
                  <button
                    type="button"
                    key={mode}
                    className={`${topBar.orgModeOption} ${p.orgFilterMode === mode ? topBar.orgModeOptionActive : ''}`}
                    onClick={() => update({ orgFilterMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <EntityDropdownItems
                searchText={searchText}
                entities={orgs}
                isChecked={isOrgChecked}
                onToggle={handleOrgToggle}
              />
            </>
          )}
        </FilterDropdown>
      )}

      {sortedTags.length > 0 && (
        <FilterDropdown
          label={
            <>
              <span className={topBar.filterIcon}>#</span> Tags
            </>
          }
          active={tagsActive || previewEmpty === 'tags'}
          allSelected={!tagsActive && previewEmpty !== 'tags'}
          noneSelected={tagsNone}
          onSelectAll={() => {
            setPreviewEmpty(null)
            setTags(null)
          }}
          onDeselectAll={() => {
            setPreviewEmpty(null)
            setTags(new Set())
          }}
          onOpen={() => {
            if (!tagsActive) setPreviewEmpty('tags')
          }}
          onClose={() => {
            if (previewEmpty === 'tags') setPreviewEmpty(null)
          }}
          searchable
        >
          {(searchText: string) => {
            const q = searchText.toLowerCase()
            const filtered = q
              ? sortedTags.filter((t) => t.name.toLowerCase().includes(q))
              : sortedTags
            if (filtered.length === 0) {
              return (
                <div className={topBar.dropdownEmpty}>{q ? 'No matches' : 'No tags yet'}</div>
              )
            }
            return (
              <>
                {filtered.map((tag) => (
                  <label
                    key={tag.id}
                    className={topBar.dropdownItem}
                    onClick={() => handleTagToggle(tag.id!)}
                  >
                    <span
                      className={`${topBar.check} ${isTagChecked(tag.id!) ? topBar.checked : ''}`}
                    />
                    {tag.color && (
                      <span className={topBar.dot} style={{ background: tag.color }} />
                    )}
                    #{tag.name}
                  </label>
                ))}
              </>
            )
          }}
        </FilterDropdown>
      )}

      <DateRangeDropdown
        active={dateActive}
        dateField={p.dateField}
        startAnchor={p.dateRangeStart}
        endAnchor={p.dateRangeEnd}
        includeNoDate={p.dateRangeIncludeNoDate}
        hasScheduled={p.hasScheduled}
        hasDeadline={p.hasDeadline}
        onChangeDateField={(dateField) => update({ dateField })}
        onChangeAnchors={(dateRangeStart, dateRangeEnd) => update({ dateRangeStart, dateRangeEnd })}
        onChangeIncludeNoDate={(dateRangeIncludeNoDate) => update({ dateRangeIncludeNoDate })}
        onChangeHasScheduled={(hasScheduled) => update({ hasScheduled })}
        onChangeHasDeadline={(hasDeadline) => update({ hasDeadline })}
      />

      {statuses.length > 0 && (
        <FilterDropdown
          label={
            <>
              <span className={topBar.filterIcon}>&#x25C9;</span> Status
            </>
          }
          active={statusActive || previewEmpty === 'status'}
          allSelected={!statusActive && previewEmpty !== 'status'}
          noneSelected={statusNone}
          onSelectAll={() => {
            setPreviewEmpty(null)
            setStatusIds(null)
          }}
          onDeselectAll={() => {
            setPreviewEmpty(null)
            setStatusIds(new Set())
          }}
          onOpen={() => {
            if (!statusActive) setPreviewEmpty('status')
          }}
          onClose={() => {
            if (previewEmpty === 'status') setPreviewEmpty(null)
          }}
          searchable
        >
          {(searchText: string) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={statuses.map((s) =>
                s.hideByDefault ? { ...s, name: `${s.name} (hidden)` } : s,
              )}
              isChecked={isStatusChecked}
              onToggle={handleStatusToggle}
            />
          )}
        </FilterDropdown>
      )}

      <button
        type="button"
        className={`${topBar.filterChip} ${p.showHiddenStatuses ? topBar.filterChipActive : ''}`}
        onClick={() => update({ showHiddenStatuses: !p.showHiddenStatuses })}
        role="switch"
        aria-checked={p.showHiddenStatuses}
      >
        <svg
          className={topBar.filterIcon}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2C5 2 3 4.5 3 7v4c0 .5-.3 1-.7 1.3-.3.2-.3.7.2.7h1.3c.3 0 .5.3.4.6-.2.4.1.9.5.9s.6-.3.9-.6c.2-.2.5-.4.9-.4s.7.2.9.4c.3.3.5.6.9.6s.7-.5.5-.9c-.1-.3.1-.6.4-.6h1.3c.5 0 .5-.5.2-.7-.4-.2-.7-.8-.7-1.3V7c0-2.5-2-5-5-5z" />
          <circle cx="6.5" cy="7" r="1" />
          <circle cx="9.5" cy="7" r="1" />
        </svg>
        {' '}Show hidden
      </button>

      <button
        type="button"
        className={`${topBar.filterChip} ${p.showCompleted ? topBar.filterChipActive : ''}`}
        onClick={() => update({ showCompleted: !p.showCompleted })}
        role="switch"
        aria-checked={p.showCompleted}
      >
        <span className={topBar.filterIcon}>✓</span> Show completed
      </button>

      {showClearAll && active && (
        <button
          type="button"
          className={topBar.clearFilters}
          onClick={clearAll}
          title="Clear all filters"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1.5 2h13l-5 6.5V14l-3-2V8.5L1.5 2z" />
            <line x1="2" y1="14" x2="14" y2="2" stroke="var(--color-overdue)" strokeWidth="2" />
          </svg>
        </button>
      )}
    </>
  )
}
