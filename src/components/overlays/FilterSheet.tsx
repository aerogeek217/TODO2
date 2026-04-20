import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore, type DateField, type OrgFilterMode, type PersonFilterMode } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { toggleItem } from '../../utils/filter'
import { DateAnchorInput } from '../shared/DateAnchorInput'
import styles from './FilterSheet.module.css'

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
  const { filters, isActive, setShowCompleted, setShowHiddenStatuses, setPersonIds, setPersonFilterMode, setOrgIds, setOrgFilterMode, setProjectIds, setStatusIds, setSearchText, setDateField, setDateRangeAnchors, setDateRangeIncludeNoDate, setHasScheduled, setHasDeadline, clearAll } = useFilterStore()
  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)
  const location = useLocation()

  const [openSection, setOpenSection] = useState<'toggles' | 'date' | 'projects' | 'people' | 'orgs' | 'status' | null>(null)
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
  const allOrgIds = orgs.map((o) => o.id!)

  const togglePerson = (id: number) => {
    setPersonIds(toggleItem(filters.personIds, id, [0, ...allPeopleIds]))
  }

  const toggleOrg = (id: number) => {
    setOrgIds(toggleItem(filters.orgIds, id, [0, ...allOrgIds]))
  }

  const allProjectIds = projects.map((p) => p.id!)
  const toggleProject = (id: number) => {
    setProjectIds(toggleItem(filters.projectIds, id, [0, ...allProjectIds]))
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
    { value: 'date', label: 'Date' },
    { value: 'scheduled', label: 'Sched.' },
    { value: 'deadline', label: 'Deadline' },
    { value: 'created', label: 'Created' },
    { value: 'modified', label: 'Modified' },
  ]

  const cycleTri = (v: boolean | null): boolean | null =>
    v === null ? true : v === true ? false : null
  const triIcon = (v: boolean | null) => v === null ? '—' : v === true ? '✓' : '✕'
  const triLabel = (v: boolean | null) =>
    v === null ? 'No filter' : v ? 'Only tasks with this field' : 'Only tasks without this field'

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

          {/* Toggle filters */}
          <div className={styles.entitySection}>
            <div className={styles.entityHeader} onClick={() => handleToggleSection('toggles')}>
              <span className={styles.filterLabel}>
                Show / hide
                {(filters.showCompleted || filters.showHiddenStatuses) && (
                  <span className={styles.activeCount}>
                    {[filters.showCompleted, filters.showHiddenStatuses].filter(Boolean).length}
                  </span>
                )}
              </span>
              <span className={`${styles.entityChevron} ${openSection === 'toggles' ? styles.entityChevronOpen : ''}`}>▸</span>
            </div>
            {openSection === 'toggles' && (
              <div className={styles.toggleList}>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>👁</span>
                    Show hidden
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.showHiddenStatuses ? styles.toggleActive : ''}`}
                    onClick={() => setShowHiddenStatuses(!filters.showHiddenStatuses)}
                    role="switch"
                    aria-checked={filters.showHiddenStatuses}
                    aria-label="Show hidden statuses"
                  />
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>✓</span>
                    Completed
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.showCompleted ? styles.toggleActive : ''}`}
                    onClick={() => setShowCompleted(!filters.showCompleted)}
                    role="switch"
                    aria-checked={filters.showCompleted}
                    aria-label="Show completed"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Date range */}
          <div className={styles.entitySection}>
            <div className={styles.entityHeader} onClick={() => handleToggleSection('date')}>
              <span className={styles.filterLabel}>
                Date range
                {(filters.dateRangeStart || filters.dateRangeEnd || filters.hasScheduled !== null || filters.hasDeadline !== null) && <span className={styles.activeCount}>1</span>}
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
                  <DateAnchorInput
                    value={filters.dateRangeStart}
                    onChange={(v) => setDateRangeAnchors(v, filters.dateRangeEnd)}
                    aria-label="Date range start"
                  />
                  <span style={{ color: 'var(--color-text-muted)' }}>to</span>
                  <DateAnchorInput
                    value={filters.dateRangeEnd}
                    onChange={(v) => setDateRangeAnchors(filters.dateRangeStart, v)}
                    aria-label="Date range end"
                  />
                </div>
                {filters.dateField === 'date' && (
                  <div className={styles.filterRow}>
                    <span className={styles.filterLabel}>
                      <span className={styles.filterLabelIcon}>∅</span>
                      Include tasks with no date
                    </span>
                    <button
                      className={`${styles.toggle} ${filters.dateRangeIncludeNoDate ? styles.toggleActive : ''}`}
                      onClick={() => setDateRangeIncludeNoDate(!filters.dateRangeIncludeNoDate)}
                      role="switch"
                      aria-checked={filters.dateRangeIncludeNoDate}
                      aria-label="Include tasks with no date"
                    />
                  </div>
                )}
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>📅</span>
                    Has scheduled
                  </span>
                  <button
                    className={`${styles.triToggle} ${filters.hasScheduled !== null ? styles.triToggleActive : ''}`}
                    onClick={() => setHasScheduled(cycleTri(filters.hasScheduled))}
                    aria-label={`Has scheduled: ${triLabel(filters.hasScheduled)}`}
                    title={triLabel(filters.hasScheduled)}
                  >
                    {triIcon(filters.hasScheduled)}
                  </button>
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>⚑</span>
                    Has deadline
                  </span>
                  <button
                    className={`${styles.triToggle} ${filters.hasDeadline !== null ? styles.triToggleActive : ''}`}
                    onClick={() => setHasDeadline(cycleTri(filters.hasDeadline))}
                    aria-label={`Has deadline: ${triLabel(filters.hasDeadline)}`}
                    title={triLabel(filters.hasDeadline)}
                  >
                    {triIcon(filters.hasDeadline)}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Projects */}
          {projects.length > 0 && (
            <div className={styles.entitySection}>
              <div className={styles.entityHeader} onClick={() => handleToggleSection('projects')}>
                <span className={styles.filterLabel}>
                  Projects
                  {filters.projectIds !== null && <span className={styles.activeCount}>{filters.projectIds.size}</span>}
                </span>
                <span className={`${styles.entityChevron} ${openSection === 'projects' ? styles.entityChevronOpen : ''}`}>▸</span>
              </div>
              {openSection === 'projects' && (
                <EntityFilterList
                  entities={projects}
                  filterIds={filters.projectIds}
                  onToggle={toggleProject}
                  noneLabel="No project"
                  searchPlaceholder="Search projects..."
                  searchText={entitySearch}
                  onSearchChange={setEntitySearch}
                />
              )}
            </div>
          )}

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
                <>
                  <div className={styles.dateFieldSelector}>
                    {([['include-orgs', 'Orgs'], ['direct-only', 'People only']] as [PersonFilterMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`${styles.dateFieldOption} ${filters.personFilterMode === mode ? styles.dateFieldOptionActive : ''}`}
                        onClick={() => setPersonFilterMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <EntityFilterList
                    entities={people}
                    filterIds={filters.personIds}
                    onToggle={togglePerson}
                    noneLabel="Unassigned"
                    searchPlaceholder="Search people..."
                    searchText={entitySearch}
                    onSearchChange={setEntitySearch}
                  />
                </>
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
                  entities={statuses.map(s => ({ ...s, name: s.hideByDefault ? `${s.name} (hidden)` : s.name }))}
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
