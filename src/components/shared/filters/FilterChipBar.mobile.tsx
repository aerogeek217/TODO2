import { useCallback, useMemo, useRef, useState } from 'react'
import { ClearableField } from '../ClearableField'
import { datesValue, filterChips } from '../../../utils/filter-chips'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { MARKER_KEYS } from '../../../models'
import { activeMarkers, hasExcludedMarker, HOT_LABEL, isHotFilter, MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL, markersValue, toggleHot } from '../../../utils/markers'
import sheet from './FilterChipBarMobile.module.css'
import { DateFilterPanel } from './DateFilterPanel'
import { FilterModeToggle, MarkerConditionToggle } from './FilterPanels'
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
  searchPlaceholder: string
  searchText: string
  onSearchChange: (text: string) => void
  /** Display name prefix (e.g. "@" for people, "#" for tags). */
  namePrefix?: string
}

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
  namePrefix,
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
    .toSorted(byName)
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
        {namePrefix}
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
    const out: Partial<Record<'people' | 'status' | 'tags', string>> = {}
    for (const chip of filterChips(p, names)) {
      if (chip.negated && (chip.field === 'people' || chip.field === 'status' || chip.field === 'tags')) out[chip.field] = chip.value
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

  const hot = isHotFilter(p.markers)
  const markersActiveCount = (hot ? 1 : 0) + activeMarkers(p.markers).length
  // With a No marker the row spells the filter out (`Urgent, not Important`), like an "is not" field.
  const markersNot = hasExcludedMarker(p.markers)

  return (
    <>
      {/* Priority section */}
      <AccordionSection
        label={MARKERS_LABEL}
        badge={markersNot ? undefined : markersActiveCount}
        value={markersNot ? markersValue(p.markers) : undefined}
        valueOn
        open={openSection === 'markers'}
        onToggle={() => handleSection('markers')}
      >
        <div>
          {/* Priority: Hot, or Any · Yes · No per marker (strict AND). Hot
              clears the single markers and disables them. */}
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
          {MARKER_KEYS.map((key) => (
            <div key={key} className={`${sheet.filterRow} ${hot ? sheet.filterRowDisabled : ''}`}>
              <span className={sheet.filterLabel} aria-hidden>
                <span className={sheet.filterLabelIcon} style={{ color: MARKER_COLOR[key] }}><MarkerIcon marker={key} /></span>
                {MARKER_LABELS[key]}
              </span>
              <MarkerConditionToggle marker={key} value={p.markers} onChange={(markers) => update({ markers })} touch disabled={hot} />
            </div>
          ))}
        </div>
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
            namePrefix="#"
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
