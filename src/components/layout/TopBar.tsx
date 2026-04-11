import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore, type DateField } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useFileStorageStore } from '../../stores/file-storage-store'
import { Priority } from '../../models'
import { startOfToday } from '../../utils/date'
import { toggleItem } from '../../utils/filter'
import styles from './TopBar.module.css'

const ALL_PRIORITIES = [Priority.High, Priority.Medium, Priority.Normal]

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
  due: 'Due',
  created: 'Created',
  modified: 'Modified',
}

function DateRangeDropdown({
  active,
  dateField,
  startDate,
  endDate,
  includeNoDue,
  onChangeDateField,
  onChangeRange,
  onChangeIncludeNoDue,
}: {
  active: boolean
  dateField: DateField
  startDate: Date | null
  endDate: Date | null
  includeNoDue: boolean
  onChangeDateField: (field: DateField) => void
  onChangeRange: (start: Date | null, end: Date | null) => void
  onChangeIncludeNoDue: (include: boolean) => void
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

  const toStr = (d: Date | null) => d ? d.toISOString().split('T')[0] : ''

  const handleOpen = () => {
    if (!open && !active) {
      if (dateField === 'due') {
        onChangeRange(startOfToday(), null)
      } else {
        onChangeRange(null, startOfToday())
      }
    }
    setOpen(!open)
  }

  return (
    <div className={styles.dropdownWrapper} ref={ref}>
      <button
        className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
        onClick={handleOpen}
      >
        <svg className={styles.filterIconSvg} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        {' '}Date
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className={styles.dropdownPanel}>
          <div className={styles.dateFieldSelector}>
            {(['due', 'created', 'modified'] as const).map((field) => (
              <button
                key={field}
                className={`${styles.dateFieldOption} ${dateField === field ? styles.dateFieldOptionActive : ''}`}
                onClick={() => {
                  if (field === dateField) return
                  onChangeDateField(field)
                  if (field === 'due') {
                    onChangeRange(startOfToday(), null)
                  } else {
                    onChangeRange(null, startOfToday())
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
            <input
              type="date"
              className={styles.dateInput}
              value={toStr(startDate)}
              onChange={(e) => onChangeRange(e.target.value ? new Date(e.target.value + 'T00:00:00') : null, endDate)}
            />
          </div>
          <div className={styles.dateRangeRow}>
            <label className={styles.dateLabel}>To</label>
            <input
              type="date"
              className={styles.dateInput}
              value={toStr(endDate)}
              onChange={(e) => onChangeRange(startDate, e.target.value ? new Date(e.target.value + 'T00:00:00') : null)}
            />
          </div>
          {dateField === 'due' && (
            <>
              <div className={styles.dropdownDivider} />
              <label className={styles.dropdownItem} onClick={() => onChangeIncludeNoDue(!includeNoDue)}>
                <span className={`${styles.check} ${includeNoDue ? styles.checked : ''}`} />
                Include tasks with no due date
              </label>
            </>
          )}
          <div className={styles.dropdownDivider} />
          <div className={styles.dropdownActions}>
            <button
              className={`${styles.dropdownAction} ${!active ? styles.dropdownActionDisabled : ''}`}
              onClick={() => { onChangeRange(null, null); setOpen(false) }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  const { filters, isActive, setPriorities, toggleShowCompleted, toggleShowAssigned, toggleStarredOnly, toggleHardDeadlineOnly, setPersonIds, setTagIds, setOrgIds, setSearchText, setDateField, setDateRange, setDateRangeIncludeNoDue, clearAll } = useFilterStore()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [localSearch, setLocalSearch] = useState(filters.searchText)
  const [searchFocused, setSearchFocused] = useState(false)
  const miniListRef = useRef<HTMLDivElement>(null)
  const todos = useTodoStore((s) => s.todos)
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
  const tags = useTagStore((s) => s.tags)
  const orgs = useOrgStore((s) => s.orgs)

  // Track which filter dropdown is in "preview empty" mode:
  // when opened with all selected, show unchecked visually but don't commit to store
  // until user clicks an item. If closed without selection, stays at all (null).
  const [previewEmpty, setPreviewEmpty] = useState<'people' | 'org' | 'tags' | null>(null)

  const priorityActive = filters.priorities !== null
  const peopleActive = filters.personIds !== null
  const tagsActive = filters.tagIds !== null
  const orgsActive = filters.orgIds !== null
  const dateRangeActive = filters.dateRangeStart !== null || filters.dateRangeEnd !== null

  const handlePriorityToggle = useCallback(
    (p: Priority) => setPriorities(toggleItem(filters.priorities, p, ALL_PRIORITIES)),
    [filters.priorities, setPriorities],
  )
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
  const handleTagToggle = useCallback(
    (tagId: number) => {
      if (previewEmpty === 'tags') {
        setPreviewEmpty(null)
        setTagIds(new Set([tagId]))
        return
      }
      const allIds = [0, ...tags.map((t) => t.id!)]
      setTagIds(toggleItem(filters.tagIds, tagId, allIds))
    },
    [filters.tagIds, tags, setTagIds, previewEmpty],
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

  const isPriorityChecked = (p: Priority) => filters.priorities === null || filters.priorities.has(p)
  const isPersonChecked = (id: number) => previewEmpty === 'people' ? false : filters.personIds === null || filters.personIds.has(id)
  const isTagChecked = (id: number) => previewEmpty === 'tags' ? false : filters.tagIds === null || filters.tagIds.has(id)
  const isOrgChecked = (id: number) => previewEmpty === 'org' ? false : filters.orgIds === null || filters.orgIds.has(id)

  const priorityNone = filters.priorities !== null && filters.priorities.size === 0
  const peopleNone = previewEmpty === 'people' || (filters.personIds !== null && filters.personIds.size === 0)
  const tagsNone = previewEmpty === 'tags' || (filters.tagIds !== null && filters.tagIds.size === 0)
  const orgsNone = previewEmpty === 'org' || (filters.orgIds !== null && filters.orgIds.size === 0)

  const miniListResults = useMemo(() => {
    if (!localSearch || !searchFocused) return []
    const q = localSearch.toLowerCase()
    const results = []
    for (const t of todos) {
      if (t.title.toLowerCase().includes(q)) {
        results.push(t)
        if (results.length >= 10) break
      }
    }
    return results
  }, [localSearch, searchFocused, todos])

  const showMiniList = searchFocused && localSearch.length > 0 && miniListResults.length > 0

  const { isConnected, isSupported } = useFileStorageStore()
  const location = useLocation()
  const isSettingsPage = location.pathname === '/settings'

  if (isSettingsPage) return null

  return (
    <header className={styles.topBar} data-filter-row>
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
        {showMiniList && (
          <div className={styles.searchMiniList} ref={miniListRef} tabIndex={-1} onBlur={(e) => {
            if (!miniListRef.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== searchInputRef.current) {
              setSearchFocused(false)
            }
          }}>
            {miniListResults.map((todo) => (
              <button
                key={todo.id}
                className={`${styles.miniListItem} ${todo.isCompleted ? styles.miniListItemCompleted : ''} ${todo.isAssigned ? styles.miniListItemAssigned : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  openEditPopup(todo.id)
                  handleSearchChange('')
                  setSearchFocused(false)
                  searchInputRef.current?.blur()
                }}
              >
                <span className={styles.miniListPriority} style={{
                  background: todo.priority === Priority.High ? 'var(--color-priority-high)' : todo.priority === Priority.Medium ? 'var(--color-priority-medium)' : 'var(--color-text-muted)',
                }} />
                <span className={styles.miniListTitle}>{todo.title}</span>
                {todo.dueDate && (
                  <span className={styles.miniListDue}>{new Date(todo.dueDate).toLocaleDateString()}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
          <FilterDropdown
            label={<><span className={styles.filterIcon}>↑</span> Priority</>}
            active={priorityActive}
            allSelected={!priorityActive}
            noneSelected={priorityNone}
            onSelectAll={() => setPriorities(null)}
            onDeselectAll={() => setPriorities(new Set())}
          >
            {([
              { p: Priority.High, label: 'High', color: 'var(--color-priority-high)' },
              { p: Priority.Medium, label: 'Medium', color: 'var(--color-priority-medium)' },
              { p: Priority.Normal, label: 'Normal', color: undefined },
            ] as const).map(({ p, label, color }) => (
              <label key={p} className={styles.dropdownItem} onClick={() => handlePriorityToggle(p)}>
                <span className={`${styles.check} ${isPriorityChecked(p) ? styles.checked : ''}`} />
                {color && <span className={styles.dot} style={{ background: color }} />}
                {label}
              </label>
            ))}
          </FilterDropdown>

          <DateRangeDropdown
            active={dateRangeActive}
            dateField={filters.dateField}
            startDate={filters.dateRangeStart}
            endDate={filters.dateRangeEnd}
            includeNoDue={filters.dateRangeIncludeNoDue}
            onChangeDateField={setDateField}
            onChangeRange={setDateRange}
            onChangeIncludeNoDue={setDateRangeIncludeNoDue}
          />

          <button
            className={`${styles.filterChip} ${filters.hardDeadlineOnly ? styles.filterChipActive : ''}`}
            onClick={toggleHardDeadlineOnly}
          >
            <span className={styles.filterIcon}>⚑</span> Deadlines
          </button>

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
              {(searchText: string) => {
                const q = searchText.toLowerCase()
                const showNone = !q || 'none'.includes(q)
                const filtered = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people
                return (
                  <>
                    {showNone && (
                      <label className={styles.dropdownItem} onClick={() => handlePersonToggle(0)}>
                        <span className={`${styles.check} ${isPersonChecked(0) ? styles.checked : ''}`} />
                        <span className={styles.noneLabel}>None</span>
                      </label>
                    )}
                    {filtered.map((person) => (
                      <label key={person.id} className={styles.dropdownItem} onClick={() => handlePersonToggle(person.id!)}>
                        <span className={`${styles.check} ${isPersonChecked(person.id!) ? styles.checked : ''}`} />
                        @{person.name}
                      </label>
                    ))}
                    {q && !showNone && filtered.length === 0 && (
                      <div className={styles.dropdownEmpty}>No matches</div>
                    )}
                  </>
                )
              }}
            </FilterDropdown>
          )}

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
            {(searchText: string) => {
              const q = searchText.toLowerCase()
              const showNone = !q || 'none'.includes(q)
              const filtered = q ? orgs.filter((o) => o.name.toLowerCase().includes(q)) : orgs
              return (
                <>
                  {showNone && (
                    <label className={styles.dropdownItem} onClick={() => handleOrgToggle(0)}>
                      <span className={`${styles.check} ${isOrgChecked(0) ? styles.checked : ''}`} />
                      <span className={styles.noneLabel}>None</span>
                    </label>
                  )}
                  {filtered.map((org) => (
                    <label key={org.id} className={styles.dropdownItem} onClick={() => handleOrgToggle(org.id!)}>
                      <span className={`${styles.check} ${isOrgChecked(org.id!) ? styles.checked : ''}`} />
                      {org.color && <span className={styles.dot} style={{ background: org.color }} />}
                      {org.name}
                    </label>
                  ))}
                  {q && !showNone && filtered.length === 0 && (
                    <div className={styles.dropdownEmpty}>No matches</div>
                  )}
                </>
              )
            }}
          </FilterDropdown>

          <button
            className={`${styles.filterChip} ${filters.showAssigned ? styles.filterChipActive : ''}`}
            onClick={toggleShowAssigned}
          >
            <svg className={styles.filterIconSvg} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {' '}Assigned
          </button>

          {tags.length > 0 && (
            <FilterDropdown
              label={<><span className={styles.filterIcon}>#</span> Tags</>}
              active={tagsActive || previewEmpty === 'tags'}
              allSelected={!tagsActive && previewEmpty !== 'tags'}
              noneSelected={tagsNone}
              onSelectAll={() => { setPreviewEmpty(null); setTagIds(null) }}
              onDeselectAll={() => { setPreviewEmpty(null); setTagIds(new Set()) }}
              onOpen={() => { if (!tagsActive) setPreviewEmpty('tags') }}
              onClose={() => { if (previewEmpty === 'tags') setPreviewEmpty(null) }}
              searchable
            >
              {(searchText: string) => {
                const q = searchText.toLowerCase()
                const showNone = !q || 'none'.includes(q)
                const filtered = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags
                return (
                  <>
                    {showNone && (
                      <label className={styles.dropdownItem} onClick={() => handleTagToggle(0)}>
                        <span className={`${styles.check} ${isTagChecked(0) ? styles.checked : ''}`} />
                        <span className={styles.noneLabel}>None</span>
                      </label>
                    )}
                    {filtered.map((tag) => (
                      <label key={tag.id} className={styles.dropdownItem} onClick={() => handleTagToggle(tag.id!)}>
                        <span className={`${styles.check} ${isTagChecked(tag.id!) ? styles.checked : ''}`} />
                        <span className={styles.dot} style={{ background: tag.color }} />
                        {tag.name}
                      </label>
                    ))}
                    {q && !showNone && filtered.length === 0 && (
                      <div className={styles.dropdownEmpty}>No matches</div>
                    )}
                  </>
                )
              }}
            </FilterDropdown>
          )}

          <button
            className={`${styles.filterChip} ${filters.starredOnly ? styles.filterChipStarActive : ''}`}
            onClick={toggleStarredOnly}
          >
            <span className={styles.filterIcon}>★</span> Starred
          </button>
          <button
            className={`${styles.filterChip} ${filters.showCompleted ? styles.filterChipActive : ''}`}
            onClick={toggleShowCompleted}
          >
            <span className={styles.filterIcon}>✓</span> Completed
          </button>

      {isActive && (
        <button className={styles.clearFilters} onClick={clearAll} title="Clear all filters">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 2h13l-5 6.5V14l-3-2V8.5L1.5 2z" />
            <line x1="2" y1="14" x2="14" y2="2" stroke="var(--color-priority-high)" strokeWidth="2" />
          </svg>
        </button>
      )}

      {isSupported && !isConnected && (
        <span className={styles.storageStatus}>Local only</span>
      )}
    </header>
  )
}
