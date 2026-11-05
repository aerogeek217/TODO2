import { useCallback, useMemo, useRef, useState } from 'react'
import { ClearableField } from '../ClearableField'
import { datesValue, filterChips } from '../../../utils/filter-chips'
import { MARKER_PICKER_ROWS, markerClauseOfIds, markerPickerIds, MARKERS_LABEL, NO_PRIORITY_LABEL } from '../../../utils/markers'
import sheet from './FilterChipBarMobile.module.css'
import { DateFilterPanel } from './DateFilterPanel'
import { DatePendingNotContext, screenPendingNot } from './date-pending-not'
import { FilterModeToggle } from './FilterPanels'
import { entityTicked, entityToggle } from '../../../utils/filter-negation'
import { NO_TAGS_LABEL } from '../../../utils/filter-labels'
import {
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'
import { byName } from '../../../utils/sort-order'
import { splitOnTop, usePickerOrder } from '../../../hooks/use-picker-order'

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
  /** The field's name (`People`, `Status`): the Is / Is not toggle's name. */
  field: string
  entities: { id?: number; name: string; color?: string }[]
  filterIds: Set<number> | null
  /** "Is not": the ticked rows hide tasks. */
  negated: boolean
  onNegatedChange: (negated: boolean) => void
  onToggle: (id: number) => void
  /** The None row's name (`Unassigned`, `No status`, `No tags`); without one, no None row. */
  noneLabel?: string
  /** No search box when absent (a list too short to need one). */
  searchPlaceholder?: string
  searchText: string
  onSearchChange: (text: string) => void
  /** The rows stay in the order given, not by name (Priority's fixed order). */
  keepOrder?: boolean
}

const noSearch = () => {}

/** A row press keeps the focus where it is (the search box). */
function keepFocus(e: React.MouseEvent) {
  e.preventDefault()
}

/**
 * One entity section of the phone filter sheet: Is / Is not, a search box,
 * then a checkbox per row — the ticked ones first (alphabetical, the None
 * row first of its block), a separator, then the rest. The order is fixed
 * when the section opens and whenever the search text changes
 * (`usePickerOrder`); a tick while the search has text clears it (the whole
 * list again, re-sorted), the focus staying in the search.
 */
function MobileEntityList({
  field,
  entities,
  filterIds,
  negated,
  onNegatedChange,
  onToggle,
  noneLabel,
  searchPlaceholder,
  searchText,
  onSearchChange,
  keepOrder = false,
}: MobileEntityListProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const withNone = noneLabel !== undefined
  const ticked = (id: number) => entityTicked(filterIds, negated, id)
  const ids = [...(withNone ? [0] : []), ...entities.flatMap((e) => (e.id == null ? [] : [e.id]))]
  const order = usePickerOrder(searchText, ids, ticked)
  const q = searchText.trim().toLowerCase()
  const matching = entities
    .flatMap((e) => (e.id == null ? [] : [{ ...e, id: e.id }]))
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .toSorted(keepOrder ? () => 0 : byName)
  const { top, rest } = splitOnTop(matching, (e) => order.onTop(e.id))
  const noneOnTop = withNone && order.onTop(0)
  const firstRestId = top.length > 0 || noneOnTop
    ? (withNone && !noneOnTop ? 0 : rest[0]?.id)
    : undefined
  const pick = (id: number) => {
    const was = ticked(id)
    onToggle(id)
    if (!searchText) return
    order.notePick(id, !was)
    onSearchChange('')
  }
  const noneRow = withNone && (
    <label key="none" className={`${sheet.entityItem} ${firstRestId === 0 ? sheet.entityItemSeparated : ''}`} onMouseDown={keepFocus}>
      <span
        className={sheet.entityDot}
        style={{ background: 'var(--color-text-muted)' }}
      />
      <span className={`${sheet.entityName} ${sheet.entityNone}`}>{noneLabel}</span>
      <input
        type="checkbox"
        className={sheet.entityCheck}
        checked={ticked(0)}
        onChange={() => pick(0)}
      />
    </label>
  )
  const entityRow = (e: { id: number; name: string; color?: string }) => (
    <label key={e.id} className={`${sheet.entityItem} ${firstRestId === e.id ? sheet.entityItemSeparated : ''}`} onMouseDown={keepFocus}>
      <span
        className={sheet.entityDot}
        style={{ background: e.color || 'var(--color-accent)' }}
      />
      <span className={sheet.entityName}>
        {e.name}
      </span>
      <input
        type="checkbox"
        className={sheet.entityCheck}
        checked={ticked(e.id)}
        onChange={() => pick(e.id)}
      />
    </label>
  )
  return (
    <div className={sheet.entityList}>
      <FilterModeToggle field={field} negated={negated} onChange={onNegatedChange} touch />
      {searchPlaceholder !== undefined && (
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
      )}
      {/* Each row is a real checkbox with its name as the label: a tap, Space or a screen reader ticks it. */}
      {noneOnTop && noneRow}
      {top.map(entityRow)}
      {!noneOnTop && noneRow}
      {rest.map(entityRow)}
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
  // "Is not" with nothing ticked: no condition yet, so the section holds the mode.
  const [markersPendingNot, setMarkersPendingNot] = useState(false)
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
    negated,
    update,
    setPersonIds,
    setStatusIds,
    setTags,
    setNegated,
    clearAll,
  } = s

  const dates = datesValue(p.dates)
  // An "is not" section shows its chip value (`not Waiting`) instead of a count.
  const names = useMemo(() => ({ people, tags: sortedTags, statuses }), [people, sortedTags, statuses])
  const notValues = useMemo(() => {
    const out: Partial<Record<'people' | 'status' | 'tags' | 'markers', string>> = {}
    for (const chip of filterChips(p, names)) {
      if (chip.negated && (chip.field === 'people' || chip.field === 'status' || chip.field === 'tags' || chip.field === 'markers')) out[chip.field] = chip.value
    }
    return out
  }, [p, names])
  const sectionCount = (key: 'people' | 'status' | 'tags', ids: Set<number> | null) => (notValues[key] != null ? undefined : ids?.size)

  const handleSection = (next: MobileSection) => {
    setOpenSection(openSection === next ? null : next)
    setEntitySearch('')
  }

  const handlePersonToggle = (personId: number) => {
    const allIds = [0, ...people.map((x) => x.id!)]
    setPersonIds(entityToggle(personIdsSet, negated.people, personId, allIds))
  }
  const handleStatusToggle = (statusId: number) => {
    const allIds = [0, ...statuses.map((st) => st.id!)]
    setStatusIds(entityToggle(statusIdsSet, negated.status, statusId, allIds))
  }
  const handleTagToggle = (tagId: number) => {
    setTags(entityToggle(tagIdsSet, negated.tags, tagId, allTagIds))
  }

  // Priority: one condition in the phone's flat filter, ticked as Status is.
  const markerClause = p.markers?.[0] ?? null
  const markersNegated = markerClause ? markerClause.not === true : markersPendingNot
  const markerIdsSet = markerClause ? markerPickerIds(markerClause) : null
  const writeMarkers = (ids: Iterable<number> | null, not: boolean) => {
    if (not) setMarkersPendingNot(true)
    const clause = ids ? markerClauseOfIds(ids, not) : null
    update({ markers: clause ? [clause] : null })
  }
  const handleMarkerToggle = (id: number) => {
    const allIds = [0, ...MARKER_PICKER_ROWS.map((r) => r.id)]
    writeMarkers(entityToggle(markerIdsSet, markersNegated, id, allIds), markersNegated)
  }
  const handleMarkersNegated = (on: boolean) => {
    setMarkersPendingNot(on)
    if (markerIdsSet) writeMarkers(markerIdsSet, on)
  }

  return (
    <>
      {/* Priority section */}
      <AccordionSection
        label={MARKERS_LABEL}
        badge={markerClause && !markerClause.not ? markerClause.values.length : undefined}
        value={markerClause?.not ? notValues.markers : undefined}
        valueOn
        open={openSection === 'markers'}
        onToggle={() => handleSection('markers')}
      >
        <MobileEntityList
          field={MARKERS_LABEL}
          entities={[...MARKER_PICKER_ROWS]}
          filterIds={markerIdsSet}
          negated={markersNegated}
          onNegatedChange={handleMarkersNegated}
          onToggle={handleMarkerToggle}
          noneLabel={NO_PRIORITY_LABEL}
          searchText=""
          onSearchChange={noSearch}
          keepOrder
        />
      </AccordionSection>

      {/* Tags */}
      <AccordionSection
        label="Tags"
        badge={sectionCount('tags', tagIdsSet)}
        value={notValues.tags}
        valueOn
        open={openSection === 'tags'}
        onToggle={() => handleSection('tags')}
      >
        {sortedTags.length === 0 ? (
          <div className={sheet.entityList}>
            <div className={sheet.entityItem}>
              <span className={`${sheet.entityName} ${sheet.entityNone}`}>No tags yet.</span>
            </div>
          </div>
        ) : (
          <MobileEntityList
            field="Tags"
            entities={sortedTags}
            filterIds={tagIdsSet}
            negated={negated.tags}
            onNegatedChange={(on) => setNegated('tags', on)}
            onToggle={handleTagToggle}
            searchPlaceholder="Search tags..."
            searchText={entitySearch}
            onSearchChange={setEntitySearch}
            noneLabel={NO_TAGS_LABEL}
          />
        )}
      </AccordionSection>

      {/* People */}
      {people.length > 0 && (
        <AccordionSection
          label="People"
          badge={sectionCount('people', personIdsSet)}
          value={notValues.people}
          valueOn
          open={openSection === 'people'}
          onToggle={() => handleSection('people')}
        >
          <MobileEntityList
            field="People"
            entities={people}
            filterIds={personIdsSet}
            negated={negated.people}
            onNegatedChange={(on) => setNegated('people', on)}
            onToggle={handlePersonToggle}
            noneLabel="Unassigned"
            searchPlaceholder="Search people..."
            searchText={entitySearch}
            onSearchChange={setEntitySearch}
          />
        </AccordionSection>
      )}

      {/* Dates: the date panel at touch sizes; off, no value (as People / Tags / Status — and Show's `Any` means "has the date") */}
      <AccordionSection
        label="Dates"
        value={dates ?? undefined}
        valueOn
        open={openSection === 'date'}
        onToggle={() => handleSection('date')}
      >
        <div className={sheet.dateSection}>
          <DatePendingNotContext.Provider value={screenPendingNot}>
            <DateFilterPanel variant="sheet" dates={p.dates} onChange={(next) => update({ dates: next })} />
          </DatePendingNotContext.Provider>
        </div>
      </AccordionSection>

      {/* Status */}
      {statuses.length > 0 && (
        <AccordionSection
          label="Status"
          badge={sectionCount('status', statusIdsSet)}
          value={notValues.status}
          valueOn
          open={openSection === 'status'}
          onToggle={() => handleSection('status')}
        >
          <MobileEntityList
            field="Status"
            entities={statuses}
            filterIds={statusIdsSet}
            negated={negated.status}
            onNegatedChange={(on) => setNegated('status', on)}
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
