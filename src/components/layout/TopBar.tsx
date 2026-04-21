import { useState, useRef, useEffect, useCallback, useMemo, forwardRef } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore, fixedAnchor, type DateField, type OrgFilterMode, type PersonFilterMode } from '../../stores/filter-store'
import type { DateAnchor, PersistedTodoItem } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import { useProjectStore } from '../../stores/project-store'
import { useUIStore } from '../../stores/ui-store'
import { useFileStorageStore } from '../../stores/file-storage-store'
import { startOfToday, formatDateShort } from '../../utils/date'
import { scheduledLabel } from '../../utils/effective-date'
import { toggleItem, matchTodoText, type TextMatchField } from '../../utils/filter'
import { StatusIcon } from '../shared/StatusIcon'
import { DateAnchorInput } from '../shared/DateAnchorInput'
import styles from './TopBar.module.css'

const SEARCH_FIELD_ORDER: TextMatchField[] = ['title', 'notes', 'project', 'person', 'org', 'status']
const SEARCH_FIELD_LABELS: Record<TextMatchField, string> = {
  title: 'Title',
  notes: 'Notes',
  project: 'Project',
  person: 'Person',
  org: 'Org',
  status: 'Status',
}
const MAX_GROUP_PREVIEW = 5

function SearchFieldIcon({ field }: { field: TextMatchField }) {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (field) {
    case 'title':
      return <svg {...common}><path d="M3 3h10M3 6h10M3 9h7M3 12h10" /></svg>
    case 'notes':
      return <svg {...common}><path d="M4 2h6l2 2v10H4z" /><path d="M6 6h4M6 8h4M6 10h3" /></svg>
    case 'project':
      return <svg {...common}><path d="M2 4.5l6-3 6 3v7l-6 3-6-3z" /><path d="M2 4.5l6 3 6-3M8 7.5v7" /></svg>
    case 'person':
      return <span className={styles.miniListGroupIcon} style={{ fontSize: 12 }}>@</span>
    case 'org':
      return <svg {...common}><rect x="3" y="5" width="10" height="9" /><path d="M6 14v-3h4v3M6 8h.01M10 8h.01" /></svg>
    case 'status':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></svg>
  }
}

const SearchResultsGroups = forwardRef<HTMLDivElement, {
  groups: Record<TextMatchField, PersistedTodoItem[]>
  query: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onOpen: (todoId: number) => void
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void
}>(function SearchResultsGroups({ groups, query, searchInputRef, onOpen, onBlur }, ref) {
  const [expanded, setExpanded] = useState<Set<TextMatchField>>(() => new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setExpanded(new Set())
  }, [query])

  const setRefs = (el: HTMLDivElement | null) => {
    containerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
  }

  const focusSibling = (current: HTMLElement, dir: 1 | -1) => {
    const options = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const i = options.indexOf(current as HTMLButtonElement)
    if (dir === -1 && i <= 0) { searchInputRef.current?.focus(); return }
    const next = options[i + dir]
    next?.focus()
  }

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, todoId: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusSibling(e.currentTarget, 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusSibling(e.currentTarget, -1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(todoId) }
    else if (e.key === 'Escape') { e.preventDefault(); searchInputRef.current?.focus() }
  }

  return (
    <div
      ref={setRefs}
      className={styles.searchMiniList}
      id="search-results"
      role="listbox"
      aria-label="Search results"
      tabIndex={-1}
      onBlur={onBlur}
    >
      {SEARCH_FIELD_ORDER.map(field => {
        const items = groups[field]
        if (items.length === 0) return null
        const shown = expanded.has(field) ? items : items.slice(0, MAX_GROUP_PREVIEW)
        return (
          <div key={field} role="group" aria-label={SEARCH_FIELD_LABELS[field]}>
            <div className={styles.miniListGroupHeader}>
              <SearchFieldIcon field={field} />
              <span>{SEARCH_FIELD_LABELS[field]}</span>
              <span className={styles.miniListGroupCount}>{items.length}</span>
            </div>
            {shown.map((todo, localIdx) => (
              <button
                key={`${field}-${todo.id}-${localIdx}`}
                role="option"
                aria-selected={false}
                className={`${styles.miniListItem} ${todo.isCompleted ? styles.miniListItemCompleted : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onOpen(todo.id) }}
                onKeyDown={(e) => onItemKeyDown(e, todo.id)}
              >
                <span className={styles.miniListTitle}>{todo.title}</span>
                {field === 'notes' && todo.notes && (
                  <span className={styles.miniListMatchSnippet}>{todo.notes.replace(/\s+/g, ' ').trim()}</span>
                )}
                {todo.scheduledDate && (
                  <span className={styles.miniListDue}>{scheduledLabel(todo.scheduledDate, startOfToday())}</span>
                )}
                {todo.dueDate && (
                  <span className={styles.miniListDue}>{formatDateShort(todo.dueDate)}</span>
                )}
              </button>
            ))}
            {items.length > MAX_GROUP_PREVIEW && !expanded.has(field) && (
              <button
                className={styles.miniListShowAll}
                onMouseDown={(e) => { e.preventDefault(); setExpanded(prev => new Set(prev).add(field)) }}
              >
                Show all {items.length}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
})

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

  const renderedChildren = typeof children === 'function' ? children(searchText) : children

  return (
    <div className={styles.dropdownWrapper} ref={ref}>
      <button
        className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
        onClick={handleToggle}
        aria-expanded={open}
      >
        {label}
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className={styles.dropdownPanel}>
          <div className={styles.dropdownActions}>
            <button
              className={`${styles.dropdownAction} ${allSelected ? styles.dropdownActionDisabled : ''}`}
              onClick={allSelected ? undefined : onSelectAll}
            >
              Select all
            </button>
            <span className={styles.dropdownActionSep}>/</span>
            <button
              className={`${styles.dropdownAction} ${noneSelected ? styles.dropdownActionDisabled : ''}`}
              onClick={noneSelected ? undefined : onDeselectAll}
            >
              Deselect all
            </button>
          </div>
          <div className={styles.dropdownDivider} />
          {searchable && (
            <div className={styles.dropdownSearchWrapper}>
              <input
                ref={searchRef}
                className={styles.dropdownSearchInput}
                type="text"
                placeholder="Search..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchText) {
                      setSearchText('')
                    } else {
                      setOpen(false)
                      setSearchText('')
                      onClose?.()
                    }
                  }
                }}
              />
            </div>
          )}
          <div className={searchable ? styles.dropdownItemsScrollable : undefined}>
            {renderedChildren}
          </div>
        </div>
      )}
    </div>
  )
}

const DATE_FIELD_LABELS: Record<DateField, string> = {
  date: 'Date',
  scheduled: 'Scheduled',
  deadline: 'Deadline',
  created: 'Created',
  modified: 'Modified',
}

function TriStateRow({ label, value, onChange }: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  // cycle: null → true → false → null
  const next = value === null ? true : value === true ? false : null
  const icon = value === null ? '—' : value === true ? '✓' : '✕'
  return (
    <label
      className={styles.dropdownItem}
      onClick={() => onChange(next)}
      title={value === null ? 'No filter' : value ? 'Only tasks with this field' : 'Only tasks without this field'}
    >
      <span className={`${styles.triState} ${value !== null ? styles.triStateActive : ''}`}>{icon}</span>
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
    <div className={styles.dropdownWrapper} ref={ref}>
      <button
        className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
        onClick={handleOpen}
        aria-expanded={open}
      >
        <svg className={styles.filterIconSvg} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        {' '}Date
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className={styles.dropdownPanel}>
          <div className={styles.dateFieldSelector}>
            {(['date', 'scheduled', 'deadline', 'created', 'modified'] as const).map((field) => (
              <button
                key={field}
                className={`${styles.dateFieldOption} ${dateField === field ? styles.dateFieldOptionActive : ''}`}
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
          <div className={styles.dropdownDivider} />
          <div className={styles.dateRangeRow}>
            <label className={styles.dateLabel}>From</label>
            <DateAnchorInput
              value={startAnchor}
              onChange={(v) => onChangeAnchors(v, endAnchor)}
              aria-label="Date range start"
            />
          </div>
          <div className={styles.dateRangeRow}>
            <label className={styles.dateLabel}>To</label>
            <DateAnchorInput
              value={endAnchor}
              onChange={(v) => onChangeAnchors(startAnchor, v)}
              aria-label="Date range end"
            />
          </div>
          {dateField === 'date' && (
            <>
              <div className={styles.dropdownDivider} />
              <label className={styles.dropdownItem} onClick={() => onChangeIncludeNoDate(!includeNoDate)}>
                <span className={`${styles.check} ${includeNoDate ? styles.checked : ''}`} />
                Include tasks with no scheduled or deadline date
              </label>
            </>
          )}
          <div className={styles.dropdownDivider} />
          <TriStateRow label="Has scheduled" value={hasScheduled} onChange={onChangeHasScheduled} />
          <TriStateRow label="Has deadline" value={hasDeadline} onChange={onChangeHasDeadline} />
          <div className={styles.dropdownDivider} />
          <div className={styles.dropdownActions}>
            <button
              className={`${styles.dropdownAction} ${!active ? styles.dropdownActionDisabled : ''}`}
              onClick={() => { onChangeAnchors(null, null); onChangeHasScheduled(null); onChangeHasDeadline(null); setOpen(false) }}
            >
              Clear
            </button>
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
}: {
  searchText: string
  entities: { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
  showDot?: boolean
}) {
  const q = searchText.toLowerCase()
  const showNone = !q || 'none'.includes(q)
  const filtered = (q ? entities.filter(e => e.name.toLowerCase().includes(q)) : entities).toSorted((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      {showNone && (
        <label className={styles.dropdownItem} onClick={() => onToggle(0)}>
          <span className={`${styles.check} ${isChecked(0) ? styles.checked : ''}`} />
          <span className={styles.noneLabel}>None</span>
        </label>
      )}
      {filtered.map(entity => (
        <label key={entity.id} className={styles.dropdownItem} onClick={() => onToggle(entity.id!)}>
          <span className={`${styles.check} ${isChecked(entity.id!) ? styles.checked : ''}`} />
          {entity.icon ? (
            <span className={styles.dotIcon} style={{ color: entity.color }}><StatusIcon icon={entity.icon} filled /></span>
          ) : showDot && entity.color ? (
            <span className={styles.dot} style={{ background: entity.color }} />
          ) : null}
          {namePrefix}{entity.name}
        </label>
      ))}
      {q && !showNone && filtered.length === 0 && (
        <div className={styles.dropdownEmpty}>No matches</div>
      )}
    </>
  )
}


export function TopBar() {
  const { filters, isActive, setShowCompleted, setShowHiddenStatuses, setPersonIds, setPersonFilterMode, setOrgIds, setOrgFilterMode, setProjectIds, setStatusIds, setSearchText, setDateField, setDateRangeAnchors, setDateRangeIncludeNoDate, setHasScheduled, setHasDeadline, clearAll } = useFilterStore()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [localSearch, setLocalSearch] = useState(filters.searchText)
  const [searchFocused, setSearchFocused] = useState(false)
  const miniListRef = useRef<HTMLDivElement>(null)
  const todos = useTodoStore((s) => s.todos)
  const projects = useProjectStore((s) => s.projects)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const handleSearchChange = useCallback((value: string) => {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchText(value), 150)
  }, [setSearchText])

  // Sync local state when store is cleared externally
  const storeSearchText = filters.searchText
  useEffect(() => {
    setLocalSearch(storeSearchText)
  }, [storeSearchText])
  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const statuses = useStatusStore((s) => s.statuses)

  // Track which filter dropdown is in "preview empty" mode:
  // when opened with all selected, show unchecked visually but don't commit to store
  // until user clicks an item. If closed without selection, stays at all (null).
  const [previewEmpty, setPreviewEmpty] = useState<'project' | 'people' | 'org' | 'status' | null>(null)

  const peopleActive = filters.personIds !== null
  const orgsActive = filters.orgIds !== null
  const projectsActive = filters.projectIds !== null
  const statusActive = filters.statusIds !== null
  const dateRangeActive = filters.dateRangeStart !== null || filters.dateRangeEnd !== null || filters.hasScheduled !== null || filters.hasDeadline !== null

  const handlePersonToggle = useCallback(
    (personId: number) => {
      if (previewEmpty === 'people') {
        // First click during preview: commit just this item
        setPreviewEmpty(null)
        setPersonIds(new Set([personId]))
        return
      }
      const allIds = [0, ...people.map((p) => p.id!)]
      setPersonIds(toggleItem(filters.personIds, personId, allIds))
    },
    [filters.personIds, people, setPersonIds, previewEmpty],
  )
  const handleOrgToggle = useCallback(
    (orgId: number) => {
      if (previewEmpty === 'org') {
        setPreviewEmpty(null)
        setOrgIds(new Set([orgId]))
        return
      }
      const allIds = [0, ...orgs.map((o) => o.id!)]
      setOrgIds(toggleItem(filters.orgIds, orgId, allIds))
    },
    [filters.orgIds, orgs, setOrgIds, previewEmpty],
  )
  const handleStatusToggle = useCallback(
    (statusId: number) => {
      if (previewEmpty === 'status') {
        setPreviewEmpty(null)
        setStatusIds(new Set([statusId]))
        return
      }
      const allIds = [0, ...statuses.map((s) => s.id!)]
      setStatusIds(toggleItem(filters.statusIds, statusId, allIds))
    },
    [filters.statusIds, statuses, setStatusIds, previewEmpty],
  )

  const handleProjectToggle = useCallback(
    (projectId: number) => {
      if (previewEmpty === 'project') {
        setPreviewEmpty(null)
        setProjectIds(new Set([projectId]))
        return
      }
      const allIds = [0, ...projects.map((p) => p.id!)]
      setProjectIds(toggleItem(filters.projectIds, projectId, allIds))
    },
    [filters.projectIds, projects, setProjectIds, previewEmpty],
  )

  const isPersonChecked = (id: number) => previewEmpty === 'people' ? false : filters.personIds === null || filters.personIds.has(id)
  const isOrgChecked = (id: number) => previewEmpty === 'org' ? false : filters.orgIds === null || filters.orgIds.has(id)
  const isProjectChecked = (id: number) => previewEmpty === 'project' ? false : filters.projectIds === null || filters.projectIds.has(id)
  const isStatusChecked = (id: number) => previewEmpty === 'status' ? false : filters.statusIds === null || filters.statusIds.has(id)

  const peopleNone = previewEmpty === 'people' || (filters.personIds !== null && filters.personIds.size === 0)
  const orgsNone = previewEmpty === 'org' || (filters.orgIds !== null && filters.orgIds.size === 0)
  const projectsNone = previewEmpty === 'project' || (filters.projectIds !== null && filters.projectIds.size === 0)
  const statusNone = previewEmpty === 'status' || (filters.statusIds !== null && filters.statusIds.size === 0)

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const statusesById = useMemo(() => new Map(statuses.map(s => [s.id!, s])), [statuses])

  const miniListGroups = useMemo(() => {
    if (!localSearch || !searchFocused) return null
    const groups: Record<TextMatchField, PersistedTodoItem[]> = {
      title: [], notes: [], project: [], person: [], org: [], status: [],
    }
    for (const t of todos) {
      const people = assignedPeopleMap.get(t.id) ?? []
      const orgs = assignedOrgsMap.get(t.id) ?? []
      const { fields } = matchTodoText(t, localSearch, {
        projectName: t.projectId != null ? projectsById.get(t.projectId)?.name : undefined,
        personNames: people.map(p => p.name),
        orgNames: orgs.map(o => o.name),
        statusName: t.statusId != null ? statusesById.get(t.statusId)?.name : undefined,
      })
      for (const f of fields) groups[f].push(t)
    }
    return groups
  }, [localSearch, searchFocused, todos, assignedPeopleMap, assignedOrgsMap, projectsById, statusesById])

  const totalMatchCount = miniListGroups
    ? (Object.values(miniListGroups) as PersistedTodoItem[][]).reduce((n, arr) => n + arr.length, 0)
    : 0
  const showMiniList = searchFocused && localSearch.length > 0 && !!miniListGroups && totalMatchCount > 0

  const { isConnected, isSupported } = useFileStorageStore()
  const location = useLocation()
  const isSettingsPage = location.pathname === '/settings'

  if (isSettingsPage) return null

  return (
    <header className={`${styles.topBar} ${isActive ? styles.topBarFiltered : ''}`} data-filter-row>
      <div className={styles.searchWrapper}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search..."
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-controls="search-results"
          aria-expanded={showMiniList}
          onFocus={() => setSearchFocused(true)}
          onBlur={(e) => {
            if (miniListRef.current?.contains(e.relatedTarget as Node)) return
            setSearchFocused(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleSearchChange('')
              setSearchFocused(false)
              searchInputRef.current?.blur()
            } else if (e.key === 'ArrowDown' && showMiniList) {
              e.preventDefault()
              const first = miniListRef.current?.querySelector<HTMLButtonElement>('[role="option"]')
              first?.focus()
            }
          }}
          data-search-input
        />
        {localSearch && (
          <button
            className={styles.searchClear}
            onMouseDown={(e) => { e.preventDefault(); handleSearchChange(''); searchInputRef.current?.focus() }}
          >
            &times;
          </button>
        )}
        {showMiniList && miniListGroups && (
          <SearchResultsGroups
            ref={miniListRef}
            groups={miniListGroups}
            query={localSearch}
            searchInputRef={searchInputRef}
            onOpen={(todoId) => {
              openEditPopup(todoId)
              handleSearchChange('')
              setSearchFocused(false)
              searchInputRef.current?.blur()
            }}
            onBlur={(e) => {
              if (!miniListRef.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== searchInputRef.current) {
                setSearchFocused(false)
              }
            }}
          />
        )}
      </div>

          {projects.length > 0 && (
            <FilterDropdown
              label={
                <>
                  <svg className={styles.filterIconSvg} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
              label={<><span className={styles.filterIcon}>@</span> People</>}
              active={peopleActive || previewEmpty === 'people'}
              allSelected={!peopleActive && previewEmpty !== 'people'}
              noneSelected={peopleNone}
              onSelectAll={() => { setPreviewEmpty(null); setPersonIds(null) }}
              onDeselectAll={() => { setPreviewEmpty(null); setPersonIds(new Set()) }}
              onOpen={() => { if (!peopleActive) setPreviewEmpty('people') }}
              onClose={() => { if (previewEmpty === 'people') setPreviewEmpty(null) }}
              searchable
            >
              {(searchText: string) => (
                <>
                  <div className={styles.orgModeToggle}>
                    {([['include-orgs', 'Orgs'], ['direct-only', 'People only']] as [PersonFilterMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`${styles.orgModeOption} ${filters.personFilterMode === mode ? styles.orgModeOptionActive : ''}`}
                        onClick={() => setPersonFilterMode(mode)}
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
              label={<><span className={styles.filterIcon}>@</span> Org</>}
              active={orgsActive || previewEmpty === 'org'}
              allSelected={!orgsActive && previewEmpty !== 'org'}
              noneSelected={orgsNone}
              onSelectAll={() => { setPreviewEmpty(null); setOrgIds(null) }}
              onDeselectAll={() => { setPreviewEmpty(null); setOrgIds(new Set()) }}
              onOpen={() => { if (!orgsActive) setPreviewEmpty('org') }}
              onClose={() => { if (previewEmpty === 'org') setPreviewEmpty(null) }}
              searchable
            >
              {(searchText: string) => (
                <>
                  <div className={styles.orgModeToggle}>
                    {([['include-people', 'People'], ['direct-only', 'Org only']] as [OrgFilterMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`${styles.orgModeOption} ${filters.orgFilterMode === mode ? styles.orgModeOptionActive : ''}`}
                        onClick={() => setOrgFilterMode(mode)}
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

          <DateRangeDropdown
            active={dateRangeActive}
            dateField={filters.dateField}
            startAnchor={filters.dateRangeStart}
            endAnchor={filters.dateRangeEnd}
            includeNoDate={filters.dateRangeIncludeNoDate}
            hasScheduled={filters.hasScheduled}
            hasDeadline={filters.hasDeadline}
            onChangeDateField={setDateField}
            onChangeAnchors={setDateRangeAnchors}
            onChangeIncludeNoDate={setDateRangeIncludeNoDate}
            onChangeHasScheduled={setHasScheduled}
            onChangeHasDeadline={setHasDeadline}
          />

          {statuses.length > 0 && (
            <FilterDropdown
              label={<><span className={styles.filterIcon}>&#x25C9;</span> Status</>}
              active={statusActive || previewEmpty === 'status'}
              allSelected={!statusActive && previewEmpty !== 'status'}
              noneSelected={statusNone}
              onSelectAll={() => { setPreviewEmpty(null); setStatusIds(null) }}
              onDeselectAll={() => { setPreviewEmpty(null); setStatusIds(new Set()) }}
              onOpen={() => { if (!statusActive) setPreviewEmpty('status') }}
              onClose={() => { if (previewEmpty === 'status') setPreviewEmpty(null) }}
              searchable
            >
              {(searchText: string) => (
                <EntityDropdownItems
                  searchText={searchText}
                  entities={statuses.map(s => s.hideByDefault ? { ...s, name: `${s.name} (hidden)` } : s)}
                  isChecked={isStatusChecked}
                  onToggle={handleStatusToggle}
                />
              )}
            </FilterDropdown>
          )}

          <button
            className={`${styles.filterChip} ${filters.showHiddenStatuses ? styles.filterChipActive : ''}`}
            onClick={() => setShowHiddenStatuses(!filters.showHiddenStatuses)}
            role="switch"
            aria-checked={filters.showHiddenStatuses}
          >
            <svg className={styles.filterIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2C5 2 3 4.5 3 7v4c0 .5-.3 1-.7 1.3-.3.2-.3.7.2.7h1.3c.3 0 .5.3.4.6-.2.4.1.9.5.9s.6-.3.9-.6c.2-.2.5-.4.9-.4s.7.2.9.4c.3.3.5.6.9.6s.7-.5.5-.9c-.1-.3.1-.6.4-.6h1.3c.5 0 .5-.5.2-.7-.4-.2-.7-.8-.7-1.3V7c0-2.5-2-5-5-5z" />
              <circle cx="6.5" cy="7" r="1" />
              <circle cx="9.5" cy="7" r="1" />
            </svg> Show hidden
          </button>

          <button
            className={`${styles.filterChip} ${filters.showCompleted ? styles.filterChipActive : ''}`}
            onClick={() => setShowCompleted(!filters.showCompleted)}
            role="switch"
            aria-checked={filters.showCompleted}
          >
            <span className={styles.filterIcon}>✓</span> Show completed
          </button>

      {isActive && (
        <button className={styles.clearFilters} onClick={() => { clearAll(); setPreviewEmpty(null) }} title="Clear all filters">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 2h13l-5 6.5V14l-3-2V8.5L1.5 2z" />
            <line x1="2" y1="14" x2="14" y2="2" stroke="var(--color-overdue)" strokeWidth="2" />
          </svg>
        </button>
      )}

      {isSupported && !isConnected && (
        <span className={styles.storageStatus}>Local only</span>
      )}
    </header>
  )
}
