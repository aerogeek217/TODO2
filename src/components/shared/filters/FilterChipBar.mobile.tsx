import { useCallback, useState } from 'react'
import type { OrgFilterMode, PersonFilterMode } from '../../../models'
import { toggleItem } from '../../../utils/filter'
import { DATE_FIELD_LABELS_SHORT } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import sheet from '../../overlays/FilterSheet.module.css'
import {
  cycleTri,
  triIcon,
  triLabel,
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'

type MobileSection = EntityKey | 'toggles' | 'date'

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

export function FilterChipBarMobile({
  predicate,
  onChange,
  showClearAll = true,
  onClearExtra,
  onClearAll,
}: FilterChipBarProps) {
  const [openSection, setOpenSection] = useState<MobileSection | null>(null)
  const [entitySearch, setEntitySearch] = useState('')
  const resetDensityState = useCallback(() => {
    setOpenSection(null)
    setEntitySearch('')
  }, [])

  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p,
    people,
    orgs,
    projects,
    statuses,
    sortedTags,
    allTagIds,
    personIdsSet,
    orgIdsSet,
    projectIdsSet,
    statusIdsSet,
    tagIdsSet,
    dateActive,
    active,
    update,
    setPersonIds,
    setOrgIds,
    setProjectIds,
    setStatusIds,
    setTags,
    clearAll,
  } = s

  const handleSection = (next: MobileSection) => {
    setOpenSection(openSection === next ? null : next)
    setEntitySearch('')
  }

  const handlePersonToggle = (personId: number) => {
    const allIds = [0, ...people.map((x) => x.id!)]
    setPersonIds(toggleItem(personIdsSet, personId, allIds))
  }
  const handleOrgToggle = (orgId: number) => {
    const allIds = [0, ...orgs.map((o) => o.id!)]
    setOrgIds(toggleItem(orgIdsSet, orgId, allIds))
  }
  const handleProjectToggle = (projectId: number) => {
    const allIds = [0, ...projects.map((x) => x.id!)]
    setProjectIds(toggleItem(projectIdsSet, projectId, allIds))
  }
  const handleStatusToggle = (statusId: number) => {
    const allIds = [0, ...statuses.map((st) => st.id!)]
    setStatusIds(toggleItem(statusIdsSet, statusId, allIds))
  }
  const handleTagToggle = (tagId: number) => {
    setTags(toggleItem(tagIdsSet, tagId, allTagIds))
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
            entities={statuses.map((st) =>
              st.hideByDefault ? { ...st, name: `${st.name} (hidden)` } : st,
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
