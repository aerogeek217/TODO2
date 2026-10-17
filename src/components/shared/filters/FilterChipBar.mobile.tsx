import { useCallback, useState } from 'react'
import { toggleItem } from '../../../utils/filter'
import { DATE_FIELD_LABELS_SHORT } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { FollowupFlagIcon } from '../FollowupIcons'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { MARKER_KEYS } from '../../../models'
import { activeMarkers, HOT_LABEL, isHotFilter, MARKER_COLOR, MARKER_LABELS, toggleHot, toggleMarker } from '../../../utils/markers'
import sheet from './FilterChipBarMobile.module.css'
import {
  cycleTri,
  triIcon,
  triLabel,
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'
import { byName } from '../../../utils/sort-order'

type MobileSection = EntityKey | 'markers' | 'toggles' | 'date'

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
        .toSorted(byName)
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
    statuses,
    sortedTags,
    allTagIds,
    personIdsSet,
    statusIdsSet,
    tagIdsSet,
    dateActive,
    active,
    update,
    setPersonIds,
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
  const handleStatusToggle = (statusId: number) => {
    const allIds = [0, ...statuses.map((st) => st.id!)]
    setStatusIds(toggleItem(statusIdsSet, statusId, allIds))
  }
  const handleTagToggle = (tagId: number) => {
    setTags(toggleItem(tagIdsSet, tagId, allTagIds))
  }

  const hot = isHotFilter(p.markers)
  const markersActiveCount = (hot ? 1 : 0) + activeMarkers(p.markers).length

  return (
    <>
      {/* Markers section */}
      <AccordionSection
        label="Markers"
        badge={markersActiveCount}
        open={openSection === 'markers'}
        onToggle={() => handleSection('markers')}
      >
        <div>
          {/* Markers: Hot, or every switched-on marker (strict AND). Hot
              switches the single markers off and disables them. */}
          <div className={sheet.filterRow}>
            <span className={sheet.filterLabel}>
              <span className={sheet.filterLabelIcon} style={{ color: 'var(--color-danger)' }}><HotIcon /></span>
              {HOT_LABEL}
            </span>
            <button
              className={`${sheet.toggle} ${hot ? sheet.toggleActive : ''}`}
              onClick={() => update({ markers: toggleHot(p.markers) })}
              role="switch"
              aria-checked={hot}
              aria-label="Only hot tasks"
            />
          </div>
          {MARKER_KEYS.map((key) => {
            const on = activeMarkers(p.markers).includes(key)
            return (
              <div key={key} className={sheet.filterRow} style={hot ? { opacity: 0.4 } : undefined}>
                <span className={sheet.filterLabel}>
                  <span className={sheet.filterLabelIcon} style={{ color: MARKER_COLOR[key] }}><MarkerIcon marker={key} /></span>
                  {MARKER_LABELS[key]}
                </span>
                <button
                  className={`${sheet.toggle} ${on ? sheet.toggleActive : ''}`}
                  onClick={() => update({ markers: toggleMarker(p.markers, key) })}
                  role="switch"
                  aria-checked={on}
                  disabled={hot}
                  aria-label={`Only ${MARKER_LABELS[key].toLowerCase()} tasks`}
                />
              </div>
            )
          })}
        </div>
      </AccordionSection>

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

      {/* People */}
      {people.length > 0 && (
        <AccordionSection
          label="People"
          badge={personIdsSet?.size}
          open={openSection === 'people'}
          onToggle={() => handleSection('people')}
        >
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

      {/* Date range section */}
      <AccordionSection
        label="Date range"
        badge={dateActive ? 1 : 0}
        open={openSection === 'date'}
        onToggle={() => handleSection('date')}
      >
        <div className={sheet.dateSection}>
          <div className={sheet.dateFieldSelector}>
            {(['deadline', 'followup', 'created', 'modified'] as const).map((field) => (
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
          {p.dateField === 'deadline' && (
            <div className={sheet.filterRow}>
              <span className={sheet.filterLabel}>
                <span className={sheet.filterLabelIcon}>∅</span>
                Include tasks with no due date
              </span>
              <button
                className={`${sheet.toggle} ${p.dateRangeIncludeNoDate ? sheet.toggleActive : ''}`}
                onClick={() => update({ dateRangeIncludeNoDate: !p.dateRangeIncludeNoDate })}
                role="switch"
                aria-checked={p.dateRangeIncludeNoDate}
                aria-label="Include tasks with no due date"
              />
            </div>
          )}
          <div className={sheet.filterRow}>
            <span className={sheet.filterLabel}>
              <span className={sheet.filterLabelIcon}>⚑</span>
              Has due date
            </span>
            <button
              className={`${sheet.triToggle} ${p.hasDeadline !== null ? sheet.triToggleActive : ''}`}
              onClick={() => update({ hasDeadline: cycleTri(p.hasDeadline) })}
              aria-label={`Has due date: ${triLabel(p.hasDeadline)}`}
              title={triLabel(p.hasDeadline)}
            >
              {triIcon(p.hasDeadline)}
            </button>
          </div>
          <div className={sheet.filterRow}>
            <span className={sheet.filterLabel}>
              <span className={sheet.filterLabelIcon}><FollowupFlagIcon /></span>
              Has follow-up
            </span>
            <button
              className={`${sheet.triToggle} ${(p.hasFollowup ?? null) !== null ? sheet.triToggleActive : ''}`}
              onClick={() => update({ hasFollowup: cycleTri(p.hasFollowup ?? null) })}
              aria-label={`Has follow-up: ${triLabel(p.hasFollowup ?? null)}`}
              title={triLabel(p.hasFollowup ?? null)}
            >
              {triIcon(p.hasFollowup ?? null)}
            </button>
          </div>
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
            entities={statuses}
            filterIds={statusIdsSet}
            onToggle={handleStatusToggle}
            noneLabel="No status"
            searchPlaceholder="Search statuses..."
            searchText={entitySearch}
            onSearchChange={setEntitySearch}
          />
        </AccordionSection>
      )}

      {/* Toggles section */}
      <AccordionSection
        label="Show / hide"
        badge={p.showCompleted ? 1 : 0}
        open={openSection === 'toggles'}
        onToggle={() => handleSection('toggles')}
      >
        <div>
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

      {showClearAll && active && (
        <button className={sheet.clearButton} onClick={clearAll}>
          Clear all filters
        </button>
      )}
    </>
  )
}
