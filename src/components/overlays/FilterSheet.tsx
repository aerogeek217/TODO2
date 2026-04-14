import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore, type DateField, type OrgFilterMode } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { Priority } from '../../models'
import { toDateInputValue } from '../../utils/date'
import { toggleItem } from '../../utils/filter'
import styles from './FilterSheet.module.css'

const ALL_PRIORITIES = [Priority.High, Priority.Medium, Priority.Normal]

function priorityLabel(p: Priority): string {
  if (p === Priority.High) return 'High'
  if (p === Priority.Medium) return 'Med'
  return 'Normal'
}

function EntityFilterList({
  entities,
  filterIds,
  onToggle,
  noneLabel,
  searchPlaceholder,
  searchText,
  onSearchChange,
}: {
  entities: { id?: number; name: string; color?: string }[]
  filterIds: Set<number> | null
  onToggle: (id: number) => void
  noneLabel: string
  searchPlaceholder: string
  searchText: string
  onSearchChange: (text: string) => void
}) {
  return (
    <div className={styles.entityList}>
      <input
        className={styles.entitySearchInput}
        placeholder={searchPlaceholder}
        value={searchText}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <div className={styles.entityItem} onClick={() => onToggle(0)}>
        <span className={styles.entityDot} style={{ background: 'var(--color-text-muted)' }} />
        <span className={`${styles.entityName} ${styles.entityNone}`}>{noneLabel}</span>
        <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filterIds === null || filterIds.has(0)} readOnly />
      </div>
      {entities
        .filter(e => !searchText || e.name.toLowerCase().includes(searchText.toLowerCase()))
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(e => (
          <div key={e.id} className={styles.entityItem} onClick={() => onToggle(e.id!)}>
            <span className={styles.entityDot} style={{ background: e.color || 'var(--color-accent)' }} />
            <span className={styles.entityName}>{e.name}</span>
            <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filterIds === null || filterIds.has(e.id!)} readOnly />
          </div>
        ))}
    </div>
  )
}

export function FilterSheet() {
  const isOpen = useUIStore((s) => s.isFilterSheetOpen)
  const closeSheet = useCallback(() => useUIStore.getState().setFilterSheetOpen(false), [])
  const { filters, isActive, setPriorities, setCompletedFilter, setFollowupFilter, setAssignedFilter, toggleHardDeadlineOnly, setPersonIds, setTagIds, setOrgIds, setOrgFilterMode, setStatusIds, setSearchText, setDateField, setDateRange, setDateRangeIncludeNoDue, clearAll } = useFilterStore()
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const orgs = useOrgStore((s) => s.orgs)
  const statuses = useStatusStore((s) => s.statuses)
  const location = useLocation()

  const [openSection, setOpenSection] = useState<'priority' | 'toggles' | 'date' | 'people' | 'orgs' | 'tags' | 'status' | null>(null)
  const [entitySearch, setEntitySearch] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setOpenSection(null)
      setEntitySearch('')
    }
  }, [isOpen])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Close sheet on route change
  useEffect(() => {
    if (isOpen) closeSheet()
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  const allPeopleIds = people.map((p) => p.id!)
  const allTagIds = tags.map((t) => t.id!)
  const allOrgIds = orgs.map((o) => o.id!)

  const togglePriority = (p: Priority) => {
    setPriorities(toggleItem(filters.priorities, p, ALL_PRIORITIES))
  }

  const isPriorityActive = (p: Priority): boolean => {
    return filters.priorities === null || filters.priorities.has(p)
  }

  const togglePerson = (id: number) => {
    setPersonIds(toggleItem(filters.personIds, id, [0, ...allPeopleIds]))
  }

  const toggleTag = (id: number) => {
    setTagIds(toggleItem(filters.tagIds, id, [0, ...allTagIds]))
  }

  const toggleOrg = (id: number) => {
    setOrgIds(toggleItem(filters.orgIds, id, [0, ...allOrgIds]))
  }

  const allStatusIds = statuses.map((s) => s.id!)
  const toggleStatus = (id: number) => {
    setStatusIds(toggleItem(filters.statusIds, id, [0, ...allStatusIds]))
  }

  const handleToggleSection = (section: typeof openSection) => {
    setOpenSection(openSection === section ? null : section)
    setEntitySearch('')
  }

  const dateFieldOptions: { value: DateField; label: string }[] = [
    { value: 'due', label: 'Due' },
    { value: 'created', label: 'Created' },
    { value: 'modified', label: 'Modified' },
  ]

  return (
    <>
      <div className={styles.backdrop} onClick={closeSheet} onTouchMove={(e) => e.preventDefault()} />
      <div className={styles.sheet}>
        <div className={styles.scrollBody}>
          {/* Search */}
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search tasks..."
              value={filters.searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {filters.searchText && (
              <button className={styles.searchClear} onClick={() => setSearchText('')}>×</button>
            )}
          </div>

          {/* Priority */}
          <div className={styles.entitySection}>
            <div className={styles.entityHeader} onClick={() => handleToggleSection('priority')}>
              <span className={styles.filterLabel}>
                Priority
                {filters.priorities !== null && <span className={styles.activeCount}>{filters.priorities.size}</span>}
              </span>
              <span className={`${styles.entityChevron} ${openSection === 'priority' ? styles.entityChevronOpen : ''}`}>▸</span>
            </div>
            {openSection === 'priority' && (
              <div className={styles.priorityRow}>
                {ALL_PRIORITIES.map((p) => (
                  <button
                    key={p}
                    className={`${styles.priorityChip} ${isPriorityActive(p) ? styles.priorityChipActive : ''}`}
                    onClick={() => togglePriority(p)}
                  >
                    {priorityLabel(p)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Toggle filters */}
          <div className={styles.entitySection}>
            <div className={styles.entityHeader} onClick={() => handleToggleSection('toggles')}>
              <span className={styles.filterLabel}>
                Show / hide
                {(filters.hardDeadlineOnly || filters.followupFilter !== 'all' || (filters.completedFilter !== 'incomplete' && filters.completedFilter !== 'incomplete-only') || (filters.assignedFilter !== 'unassigned' && filters.assignedFilter !== 'unassigned-only')) && (
                  <span className={styles.activeCount}>
                    {[filters.hardDeadlineOnly, filters.followupFilter !== 'all', filters.completedFilter !== 'incomplete' && filters.completedFilter !== 'incomplete-only', filters.assignedFilter !== 'unassigned' && filters.assignedFilter !== 'unassigned-only'].filter(Boolean).length}
                  </span>
                )}
              </span>
              <span className={`${styles.entityChevron} ${openSection === 'toggles' ? styles.entityChevronOpen : ''}`}>▸</span>
            </div>
            {openSection === 'toggles' && (
              <div className={styles.toggleList}>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>⚑</span>
                    Hard deadlines only
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.hardDeadlineOnly ? styles.toggleActive : ''}`}
                    onClick={toggleHardDeadlineOnly}
                    role="switch"
                    aria-checked={filters.hardDeadlineOnly}
                    aria-label="Hard deadlines only"
                  />
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>&#x1F5E8;</span>
                    Follow up
                  </span>
                  <div className={styles.dateFieldSelector}>
                    {(['all', 'followup', 'no-followup'] as const).map((v) => (
                      <button
                        key={v}
                        className={`${styles.dateFieldOption} ${filters.followupFilter === v ? styles.dateFieldOptionActive : ''}`}
                        onClick={() => setFollowupFilter(v)}
                      >
                        {v === 'all' ? 'All' : v === 'followup' ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>✓</span>
                    Completed
                  </span>
                  <div className={styles.dateFieldSelector}>
                    {(['all', 'incomplete', 'completed', 'incomplete-only'] as const).map((v) => (
                      <button
                        key={v}
                        className={`${styles.dateFieldOption} ${filters.completedFilter === v ? styles.dateFieldOptionActive : ''}`}
                        onClick={() => setCompletedFilter(v)}
                      >
                        {v === 'all' ? 'All' : v === 'incomplete' ? 'No' : v === 'completed' ? 'Yes' : 'No only'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>👤</span>
                    Assigned
                  </span>
                  <div className={styles.dateFieldSelector}>
                    {(['all', 'unassigned', 'assigned', 'unassigned-only'] as const).map((v) => (
                      <button
                        key={v}
                        className={`${styles.dateFieldOption} ${filters.assignedFilter === v ? styles.dateFieldOptionActive : ''}`}
                        onClick={() => setAssignedFilter(v)}
                      >
                        {v === 'all' ? 'All' : v === 'unassigned' ? 'No' : v === 'assigned' ? 'Yes' : 'No only'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Date range */}
          <div className={styles.entitySection}>
            <div className={styles.entityHeader} onClick={() => handleToggleSection('date')}>
              <span className={styles.filterLabel}>
                Date range
                {(filters.dateRangeStart || filters.dateRangeEnd) && <span className={styles.activeCount}>1</span>}
              </span>
              <span className={`${styles.entityChevron} ${openSection === 'date' ? styles.entityChevronOpen : ''}`}>▸</span>
            </div>
            {openSection === 'date' && (
              <div className={styles.dateSection}>
                <div className={styles.dateFieldSelector}>
                  {dateFieldOptions.map(({ value, label }) => (
                    <button
                      key={value}
                      className={`${styles.dateFieldOption} ${filters.dateField === value ? styles.dateFieldOptionActive : ''}`}
                      onClick={() => setDateField(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.dateInputs}>
                  <input
                    className={styles.dateInput}
                    type="date"
                    value={filters.dateRangeStart ? toDateInputValue(filters.dateRangeStart) : ''}
                    onChange={(e) => {
                      const d = e.target.value ? new Date(e.target.value + 'T00:00:00') : null
                      setDateRange(d, filters.dateRangeEnd)
                    }}
                  />
                  <span style={{ color: 'var(--color-text-muted)' }}>to</span>
                  <input
                    className={styles.dateInput}
                    type="date"
                    value={filters.dateRangeEnd ? toDateInputValue(filters.dateRangeEnd) : ''}
                    onChange={(e) => {
                      const d = e.target.value ? new Date(e.target.value + 'T00:00:00') : null
                      setDateRange(filters.dateRangeStart, d)
                    }}
                  />
                </div>
                {filters.dateField === 'due' && (
                  <div className={styles.filterRow}>
                    <span className={styles.filterLabel}>
                      <span className={styles.filterLabelIcon}>∅</span>
                      Include no due date
                    </span>
                    <button
                      className={`${styles.toggle} ${filters.dateRangeIncludeNoDue ? styles.toggleActive : ''}`}
                      onClick={() => setDateRangeIncludeNoDue(!filters.dateRangeIncludeNoDue)}
                      role="switch"
                      aria-checked={filters.dateRangeIncludeNoDue}
                      aria-label="Include no due date"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* People */}
          {people.length > 0 && (
            <div className={styles.entitySection}>
              <div className={styles.entityHeader} onClick={() => handleToggleSection('people')}>
                <span className={styles.filterLabel}>
                  People
                  {filters.personIds !== null && <span className={styles.activeCount}>{filters.personIds.size}</span>}
                </span>
                <span className={`${styles.entityChevron} ${openSection === 'people' ? styles.entityChevronOpen : ''}`}>▸</span>
              </div>
              {openSection === 'people' && (
                <EntityFilterList
                  entities={people}
                  filterIds={filters.personIds}
                  onToggle={togglePerson}
                  noneLabel="Unassigned"
                  searchPlaceholder="Search people..."
                  searchText={entitySearch}
                  onSearchChange={setEntitySearch}
                />
              )}
            </div>
          )}

          {/* Orgs */}
          {orgs.length > 0 && (
            <div className={styles.entitySection}>
              <div className={styles.entityHeader} onClick={() => handleToggleSection('orgs')}>
                <span className={styles.filterLabel}>
                  Orgs
                  {filters.orgIds !== null && <span className={styles.activeCount}>{filters.orgIds.size}</span>}
                </span>
                <span className={`${styles.entityChevron} ${openSection === 'orgs' ? styles.entityChevronOpen : ''}`}>▸</span>
              </div>
              {openSection === 'orgs' && (
                <>
                  <div className={styles.dateFieldSelector}>
                    {([['include-people', 'People'], ['direct-only', 'Org only']] as [OrgFilterMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`${styles.dateFieldOption} ${filters.orgFilterMode === mode ? styles.dateFieldOptionActive : ''}`}
                        onClick={() => setOrgFilterMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <EntityFilterList
                    entities={orgs}
                    filterIds={filters.orgIds}
                    onToggle={toggleOrg}
                    noneLabel="No org"
                    searchPlaceholder="Search orgs..."
                    searchText={entitySearch}
                    onSearchChange={setEntitySearch}
                  />
                </>
              )}
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className={styles.entitySection}>
              <div className={styles.entityHeader} onClick={() => handleToggleSection('tags')}>
                <span className={styles.filterLabel}>
                  Tags
                  {filters.tagIds !== null && <span className={styles.activeCount}>{filters.tagIds.size}</span>}
                </span>
                <span className={`${styles.entityChevron} ${openSection === 'tags' ? styles.entityChevronOpen : ''}`}>▸</span>
              </div>
              {openSection === 'tags' && (
                <EntityFilterList
                  entities={tags}
                  filterIds={filters.tagIds}
                  onToggle={toggleTag}
                  noneLabel="No tags"
                  searchPlaceholder="Search tags..."
                  searchText={entitySearch}
                  onSearchChange={setEntitySearch}
                />
              )}
            </div>
          )}

          {/* Statuses */}
          {statuses.length > 0 && (
            <div className={styles.entitySection}>
              <div className={styles.entityHeader} onClick={() => handleToggleSection('status')}>
                <span className={styles.filterLabel}>
                  Status
                  {filters.statusIds !== null && <span className={styles.activeCount}>{filters.statusIds.size}</span>}
                </span>
                <span className={`${styles.entityChevron} ${openSection === 'status' ? styles.entityChevronOpen : ''}`}>&#x25B8;</span>
              </div>
              {openSection === 'status' && (
                <EntityFilterList
                  entities={statuses}
                  filterIds={filters.statusIds}
                  onToggle={toggleStatus}
                  noneLabel="No status"
                  searchPlaceholder="Search statuses..."
                  searchText={entitySearch}
                  onSearchChange={setEntitySearch}
                />
              )}
            </div>
          )}

          {/* Clear all */}
          {isActive && (
            <button className={styles.clearButton} onClick={() => { clearAll(); closeSheet() }}>
              Clear all filters
            </button>
          )}
        </div>
      </div>
    </>
  )
}
