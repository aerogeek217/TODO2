import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore, type DateField } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
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

export function FilterSheet() {
  const isOpen = useUIStore((s) => s.isFilterSheetOpen)
  const closeSheet = useCallback(() => useUIStore.getState().setFilterSheetOpen(false), [])
  const { filters, isActive, setPriorities, toggleShowCompleted, toggleStarredOnly, toggleHardDeadlineOnly, toggleShowAssigned, setPersonIds, setTagIds, setOrgIds, setSearchText, setDateField, setDateRange, setDateRangeIncludeNoDue, clearAll } = useFilterStore()
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const orgs = useOrgStore((s) => s.orgs)
  const location = useLocation()

  const [openSection, setOpenSection] = useState<'priority' | 'toggles' | 'date' | 'people' | 'orgs' | 'tags' | null>(null)
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
                {(filters.hardDeadlineOnly || filters.starredOnly || filters.showCompleted || filters.showAssigned) && (
                  <span className={styles.activeCount}>
                    {[filters.hardDeadlineOnly, filters.starredOnly, filters.showCompleted, filters.showAssigned].filter(Boolean).length}
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
                    Follow up only
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.starredOnly ? styles.toggleActive : ''}`}
                    onClick={toggleStarredOnly}
                    role="switch"
                    aria-checked={filters.starredOnly}
                    aria-label="Follow up only"
                  />
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>✓</span>
                    Show completed
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.showCompleted ? styles.toggleActive : ''}`}
                    onClick={toggleShowCompleted}
                    role="switch"
                    aria-checked={filters.showCompleted}
                    aria-label="Show completed"
                  />
                </div>
                <div className={styles.filterRow}>
                  <span className={styles.filterLabel}>
                    <span className={styles.filterLabelIcon}>👤</span>
                    Show assigned
                  </span>
                  <button
                    className={`${styles.toggle} ${filters.showAssigned ? styles.toggleActive : ''}`}
                    onClick={toggleShowAssigned}
                    role="switch"
                    aria-checked={filters.showAssigned}
                    aria-label="Show assigned"
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
                <div className={styles.entityList}>
                  <input
                    className={styles.entitySearchInput}
                    placeholder="Search people..."
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}

                  />
                  {/* Unassigned option */}
                  <div className={styles.entityItem} onClick={() => togglePerson(0)}>
                    <span className={styles.entityDot} style={{ background: 'var(--color-text-muted)' }} />
                    <span className={`${styles.entityName} ${styles.entityNone}`}>Unassigned</span>
                    <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.personIds === null || filters.personIds.has(0)} readOnly />
                  </div>
                  {people
                    .filter((p) => !entitySearch || p.name.toLowerCase().includes(entitySearch.toLowerCase()))
                    .map((p) => (
                      <div key={p.id} className={styles.entityItem} onClick={() => togglePerson(p.id!)}>
                        <span className={styles.entityDot} style={{ background: p.color || 'var(--color-accent)' }} />
                        <span className={styles.entityName}>{p.name}</span>
                        <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.personIds === null || filters.personIds.has(p.id!)} readOnly />
                      </div>
                    ))}
                </div>
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
                <div className={styles.entityList}>
                  <input
                    className={styles.entitySearchInput}
                    placeholder="Search orgs..."
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}

                  />
                  <div className={styles.entityItem} onClick={() => toggleOrg(0)}>
                    <span className={styles.entityDot} style={{ background: 'var(--color-text-muted)' }} />
                    <span className={`${styles.entityName} ${styles.entityNone}`}>No org</span>
                    <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.orgIds === null || filters.orgIds.has(0)} readOnly />
                  </div>
                  {orgs
                    .filter((o) => !entitySearch || o.name.toLowerCase().includes(entitySearch.toLowerCase()))
                    .map((o) => (
                      <div key={o.id} className={styles.entityItem} onClick={() => toggleOrg(o.id!)}>
                        <span className={styles.entityDot} style={{ background: o.color || 'var(--color-accent)' }} />
                        <span className={styles.entityName}>{o.name}</span>
                        <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.orgIds === null || filters.orgIds.has(o.id!)} readOnly />
                      </div>
                    ))}
                </div>
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
                <div className={styles.entityList}>
                  <input
                    className={styles.entitySearchInput}
                    placeholder="Search tags..."
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}

                  />
                  <div className={styles.entityItem} onClick={() => toggleTag(0)}>
                    <span className={styles.entityDot} style={{ background: 'var(--color-text-muted)' }} />
                    <span className={`${styles.entityName} ${styles.entityNone}`}>No tags</span>
                    <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.tagIds === null || filters.tagIds.has(0)} readOnly />
                  </div>
                  {tags
                    .filter((t) => !entitySearch || t.name.toLowerCase().includes(entitySearch.toLowerCase()))
                    .map((t) => (
                      <div key={t.id} className={styles.entityItem} onClick={() => toggleTag(t.id!)}>
                        <span className={styles.entityDot} style={{ background: t.color || 'var(--color-accent)' }} />
                        <span className={styles.entityName}>{t.name}</span>
                        <input type="checkbox" className={styles.entityCheck} tabIndex={-1} aria-hidden="true" checked={filters.tagIds === null || filters.tagIds.has(t.id!)} readOnly />
                      </div>
                    ))}
                </div>
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
