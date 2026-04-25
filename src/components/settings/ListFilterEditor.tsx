import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DateAnchor,
  OrgFilterMode,
  PersonFilterMode,
  TodoPredicate,
} from '../../models'
import type { DateField } from '../../models/app-view'
import { useRightEdgeFlip } from '../../hooks/use-right-edge-flip'
import { fixedAnchor } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { startOfToday } from '../../utils/date'
import { toggleItem } from '../../utils/filter'
import { DateAnchorInput } from '../shared/DateAnchorInput'
import { StatusIcon } from '../shared/StatusIcon'
import topBar from '../layout/TopBar.module.css'
import styles from './ListFilterEditor.module.css'

interface Props {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
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

const DATE_FIELD_LABELS: Record<DateField, string> = {
  date: 'Effective Date',
  scheduled: 'Scheduled',
  deadline: 'Deadline',
  created: 'Created',
  modified: 'Modified',
}

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

/** Small wrapper over the TopBar-style filter chip + dropdown panel. */
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
}: {
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
}) {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { panelRef, align } = useRightEdgeFlip<HTMLDivElement>(open)

  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false)
      setSearchText('')
      onClose?.()
    } else {
      setOpen(true)
      onOpen?.()
    }
  }, [open, onOpen, onClose])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearchText('')
        onClose?.()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, searchable])

  const rendered = typeof children === 'function' ? children(searchText) : children

  return (
    <div className={topBar.dropdownWrapper} ref={ref}>
      <button
        type="button"
        className={`${topBar.filterChip} ${active ? topBar.filterChipActive : ''}`}
        onClick={handleToggle}
        aria-expanded={open}
      >
        {label}
        <span className={`${topBar.chevron} ${open ? topBar.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className={topBar.dropdownPanel}
          data-align={align === 'end' ? 'end' : undefined}
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
                    else {
                      setOpen(false)
                      setSearchText('')
                      onClose?.()
                    }
                  }
                }}
              />
            </div>
          )}
          <div className={searchable ? topBar.dropdownItemsScrollable : undefined}>
            {rendered}
          </div>
        </div>
      )}
    </div>
  )
}

function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  namePrefix,
  showDot = true,
  showNoneSentinel = true,
}: {
  searchText: string
  entities: { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
  showDot?: boolean
  showNoneSentinel?: boolean
}) {
  const q = searchText.toLowerCase()
  const showNone = showNoneSentinel && (!q || 'none'.includes(q))
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
          {namePrefix}{entity.name}
        </label>
      ))}
      {q && filtered.length === 0 && !showNone && (
        <div className={topBar.dropdownEmpty}>No matches</div>
      )}
    </>
  )
}

function TriStateRow({ label, value, onChange }: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  const next = value === null ? true : value === true ? false : null
  const icon = value === null ? '—' : value === true ? '✓' : '✕'
  const title = value === null
    ? 'No filter'
    : value ? 'Only tasks with this field' : 'Only tasks without this field'
  return (
    <label className={topBar.dropdownItem} onClick={() => onChange(next)} title={title}>
      <span className={`${topBar.triState} ${value !== null ? topBar.triStateActive : ''}`}>{icon}</span>
      {label}
    </label>
  )
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
}: {
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
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { panelRef, align } = useRightEdgeFlip<HTMLDivElement>(open)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleOpen = () => {
    if (!open && !active) {
      const todayAnchor = fixedAnchor(startOfToday())
      if (dateField === 'date' || dateField === 'scheduled' || dateField === 'deadline') {
        onChangeAnchors(todayAnchor, null)
      } else {
        onChangeAnchors(null, todayAnchor)
      }
    }
    setOpen(!open)
  }

  return (
    <div className={topBar.dropdownWrapper} ref={ref}>
      <button
        type="button"
        className={`${topBar.filterChip} ${active ? topBar.filterChipActive : ''}`}
        onClick={handleOpen}
        aria-expanded={open}
      >
        <svg className={topBar.filterIconSvg} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {' '}Date
        <span className={`${topBar.chevron} ${open ? topBar.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className={topBar.dropdownPanel}
          data-align={align === 'end' ? 'end' : undefined}
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
        </div>
      )}
    </div>
  )
}

/**
 * Controlled filter editor — renders the same chip-row vocabulary as TopBar
 * but bound to an arbitrary `TodoPredicate` instead of the global filter-store.
 * Used inline in `DashboardListsEditor` (draft predicate) and in `ListView`
 * (bound to filter-store via criteria ↔ predicate round-trip).
 */
export function ListFilterEditor({ predicate, onChange }: Props) {
  const p = { ...DEFAULT_PREDICATE, ...predicate }
  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const [previewEmpty, setPreviewEmpty] = useState<'project' | 'people' | 'org' | 'status' | 'tags' | null>(null)

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
    p.dateRangeStart !== null || p.dateRangeEnd !== null || p.hasScheduled !== null || p.hasDeadline !== null
  const active = hasAnyFilter(p)

  const update = useCallback((patch: Partial<TodoPredicate>) => {
    onChange({ ...p, ...patch })
  }, [p, onChange])

  const setPersonIds = (next: Set<number> | null) =>
    update({ personIds: next ? Array.from(next) : null })
  const setOrgIds = (next: Set<number> | null) =>
    update({ orgIds: next ? Array.from(next) : null })
  const setProjectIds = (next: Set<number> | null) =>
    update({ projectIds: next ? Array.from(next) : null })
  const setStatusIds = (next: Set<number> | null) =>
    update({ statusIds: next ? Array.from(next) : null })
  const setTags = (next: Set<number> | null) =>
    update({ tags: next ? Array.from(next) : null })

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
    onChange({ ...DEFAULT_PREDICATE, searchText: '' })
  }

  return (
    <div className={styles.bar} role="toolbar" aria-label="Filter editor">
      <div className={styles.searchWrapper}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search..."
          value={p.searchText}
          onChange={(e) => update({ searchText: e.target.value })}
        />
        {p.searchText && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => update({ searchText: '' })}
          >
            &times;
          </button>
        )}
      </div>

      {projects.length > 0 && (
        <FilterDropdown
          label={
            <>
              <svg className={topBar.filterIconSvg} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4.5l6-3 6 3v7l-6 3-6-3z" />
                <path d="M2 4.5l6 3 6-3M8 7.5v7" />
              </svg>
              {' '}Project
            </>
          }
          active={projectsActive || previewEmpty === 'project'}
          allSelected={!projectsActive && previewEmpty !== 'project'}
          noneSelected={projectsNone}
          onSelectAll={() => { setPreviewEmpty(null); setProjectIds(null) }}
          onDeselectAll={() => { setPreviewEmpty(null); setProjectIds(new Set()) }}
          onOpen={() => { if (!projectsActive) setPreviewEmpty('project') }}
          onClose={() => { if (previewEmpty === 'project') setPreviewEmpty(null) }}
          searchable
        >
          {(searchText) => (
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
          label={<><span className={topBar.filterIcon}>@</span> People</>}
          active={peopleActive || previewEmpty === 'people'}
          allSelected={!peopleActive && previewEmpty !== 'people'}
          noneSelected={peopleNone}
          onSelectAll={() => { setPreviewEmpty(null); setPersonIds(null) }}
          onDeselectAll={() => { setPreviewEmpty(null); setPersonIds(new Set()) }}
          onOpen={() => { if (!peopleActive) setPreviewEmpty('people') }}
          onClose={() => { if (previewEmpty === 'people') setPreviewEmpty(null) }}
          searchable
        >
          {(searchText) => (
            <>
              <div className={topBar.orgModeToggle}>
                {([['include-orgs', 'Orgs'], ['direct-only', 'People only']] as [PersonFilterMode, string][]).map(([mode, label]) => (
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
          label={<><span className={topBar.filterIcon}>@</span> Org</>}
          active={orgsActive || previewEmpty === 'org'}
          allSelected={!orgsActive && previewEmpty !== 'org'}
          noneSelected={orgsNone}
          onSelectAll={() => { setPreviewEmpty(null); setOrgIds(null) }}
          onDeselectAll={() => { setPreviewEmpty(null); setOrgIds(new Set()) }}
          onOpen={() => { if (!orgsActive) setPreviewEmpty('org') }}
          onClose={() => { if (previewEmpty === 'org') setPreviewEmpty(null) }}
          searchable
        >
          {(searchText) => (
            <>
              <div className={topBar.orgModeToggle}>
                {([['include-people', 'People'], ['direct-only', 'Org only']] as [OrgFilterMode, string][]).map(([mode, label]) => (
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
          label={<><span className={topBar.filterIcon}>#</span> Tags</>}
          active={tagsActive || previewEmpty === 'tags'}
          allSelected={!tagsActive && previewEmpty !== 'tags'}
          noneSelected={tagsNone}
          onSelectAll={() => { setPreviewEmpty(null); setTags(null) }}
          onDeselectAll={() => { setPreviewEmpty(null); setTags(new Set()) }}
          onOpen={() => { if (!tagsActive) setPreviewEmpty('tags') }}
          onClose={() => { if (previewEmpty === 'tags') setPreviewEmpty(null) }}
          searchable
        >
          {(searchText) => {
            const q = searchText.toLowerCase()
            const filtered = q ? sortedTags.filter((t) => t.name.toLowerCase().includes(q)) : sortedTags
            if (filtered.length === 0) {
              return <div className={topBar.dropdownEmpty}>{q ? 'No matches' : 'No tags yet'}</div>
            }
            return (
              <>
                {filtered.map((tag) => (
                  <label
                    key={tag.id}
                    className={topBar.dropdownItem}
                    onClick={() => handleTagToggle(tag.id!)}
                  >
                    <span className={`${topBar.check} ${isTagChecked(tag.id!) ? topBar.checked : ''}`} />
                    {tag.color && <span className={topBar.dot} style={{ background: tag.color }} />}
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
          label={<><span className={topBar.filterIcon}>&#x25C9;</span> Status</>}
          active={statusActive || previewEmpty === 'status'}
          allSelected={!statusActive && previewEmpty !== 'status'}
          noneSelected={statusNone}
          onSelectAll={() => { setPreviewEmpty(null); setStatusIds(null) }}
          onDeselectAll={() => { setPreviewEmpty(null); setStatusIds(new Set()) }}
          onOpen={() => { if (!statusActive) setPreviewEmpty('status') }}
          onClose={() => { if (previewEmpty === 'status') setPreviewEmpty(null) }}
          searchable
        >
          {(searchText) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={statuses.map((s) => (s.hideByDefault ? { ...s, name: `${s.name} (hidden)` } : s))}
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
        <svg className={topBar.filterIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

      {active && (
        <button
          type="button"
          className={topBar.clearFilters}
          onClick={clearAll}
          title="Clear all filters"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 2h13l-5 6.5V14l-3-2V8.5L1.5 2z" />
            <line x1="2" y1="14" x2="14" y2="2" stroke="var(--color-overdue)" strokeWidth="2" />
          </svg>
        </button>
      )}
    </div>
  )
}

