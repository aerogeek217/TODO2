import { useCallback, useRef, useState } from 'react'
import { toggleItem } from '../../../utils/filter'
import { ClearableField } from '../ClearableField'
import { datesValue } from '../../../utils/filter-chips'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { MARKER_KEYS } from '../../../models'
import { activeMarkers, HOT_LABEL, isHotFilter, MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL, toggleHot, toggleMarker } from '../../../utils/markers'
import sheet from './FilterChipBarMobile.module.css'
import { DateFilterPanel } from './DateFilterPanel'
import {
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'
import { byName } from '../../../utils/sort-order'

type MobileSection = EntityKey | 'markers' | 'toggles' | 'date'

interface AccordionSectionProps {
  label: string
  badge?: number
  /** A value after the label (the Dates row's `Due + Created`); `valueOn` shows it in the accent. */
  value?: string
  valueOn?: boolean
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}

function AccordionSection({ label, badge, value, valueOn = false, open, onToggle, children }: AccordionSectionProps) {
  return (
    <div className={sheet.entitySection}>
      <div className={sheet.entityHeader} onClick={onToggle}>
        <span className={sheet.filterLabel}>
          {label}
          {badge !== undefined && badge > 0 && <span className={sheet.activeCount}>{badge}</span>}
        </span>
        {value !== undefined && <span className={`${sheet.sectionValue} ${valueOn ? sheet.sectionValueOn : ''}`}>{value}</span>}
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
  const searchRef = useRef<HTMLInputElement>(null)
  return (
    <div className={sheet.entityList}>
      <ClearableField
        className={sheet.entitySearchField}
        value={searchText}
        onClear={() => onSearchChange('')}
        inputRef={searchRef}
        label="Clear search"
      >
        <input
          ref={searchRef}
          className={sheet.entitySearchInput}
          placeholder={searchPlaceholder}
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </ClearableField>
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
    active,
    update,
    setPersonIds,
    setStatusIds,
    setTags,
    clearAll,
  } = s

  const dates = datesValue(p.dates)

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
      {/* Priority section */}
      <AccordionSection
        label={MARKERS_LABEL}
        badge={markersActiveCount}
        open={openSection === 'markers'}
        onToggle={() => handleSection('markers')}
      >
        <div>
          {/* Priority: Hot, or every switched-on marker (strict AND). Hot
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

      {/* Dates: the date panel at touch sizes */}
      <AccordionSection
        label="Dates"
        value={dates ?? 'Any'}
        valueOn={dates != null}
        open={openSection === 'date'}
        onToggle={() => handleSection('date')}
      >
        <div className={sheet.dateSection}>
          <DateFilterPanel variant="sheet" dates={p.dates} onChange={(next) => update({ dates: next })} />
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
