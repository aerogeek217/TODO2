import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { toggleItem } from '../../../utils/filter'
import { clearChipField, filterChips, FILTER_FIELD_ORDER, type FilterChipField } from '../../../utils/filter-chips'
import type { TodoPredicate } from '../../../models'
import picker from './FilterPicker.module.css'
import { ImportantIcon } from '../MarkerIcons'
import { hasMarkers, MARKERS_LABEL } from '../../../utils/markers'
import { useUIStore } from '../../../stores/ui-store'
import {
  AtIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EnvelopeIcon,
  HashIcon,
  StatusRingIcon,
  WidgetKindIcon,
} from '../icons'
import { DateRangePanelBody, EntityDropdownItems, MarkersPanelBody, SelectionPanelBody } from './FilterPanels'
import {
  narrowedPeople,
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'
import styles from './ScreenFilters.module.css'

type FieldKey = Extract<FilterChipField, 'people' | 'tags' | 'dates' | 'status' | 'markers'>

type FieldPanel =
  | {
      kind: 'selection'
      allSelected: boolean
      noneSelected: boolean
      onSelectAll: () => void
      onDeselectAll: () => void
      items: (searchText: string) => ReactNode
      /** Below the items (the People picker's Email check-in action); `closeAll` closes every filter popover. */
      footer?: (closeAll: () => void) => ReactNode
    }
  | { kind: 'custom'; render: (close: () => void) => ReactNode }

/** One screen filter (Priority, Tags, People, Dates, Status) as the bar and the Filters menu show it. */
interface FieldDef {
  key: FieldKey
  label: string
  icon: ReactNode
  /** Accent look: the filter is on, or its picker is previewing an empty pick. */
  highlighted: boolean
  /** The value text while the filter is on (`Priya Nair`, `q4 +1`); null when off. */
  value: string | null
  onClear: () => void
  onOpen?: () => void
  onClose?: () => void
  panel: FieldPanel
}

/**
 * A field's picker body; owns the search text of a selection picker.
 * `onDone` closes this picker; `onCloseAll` also closes the Filters menu it
 * opened from (the same as `onDone` for a bar button).
 */
function FieldPanelBody({ field, onDone, onCloseAll = onDone }: { field: FieldDef; onDone: () => void; onCloseAll?: () => void }) {
  const [searchText, setSearchText] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { panel } = field
  useEffect(() => {
    if (panel.kind === 'selection') requestAnimationFrame(() => searchRef.current?.focus())
  }, [panel.kind])
  if (panel.kind === 'custom') return <>{panel.render(onDone)}</>
  return (
    <>
      <SelectionPanelBody
        allSelected={panel.allSelected}
        noneSelected={panel.noneSelected}
        onSelectAll={panel.onSelectAll}
        onDeselectAll={panel.onDeselectAll}
        search={{ text: searchText, setText: setSearchText, onEscape: onDone }}
        searchInputRef={searchRef}
      >
        {panel.items(searchText)}
      </SelectionPanelBody>
      {panel.footer?.(onCloseAll)}
    </>
  )
}

/**
 * The People picker's footer: `Email check-in to <name>…` / `… N people…`
 * while the filter is narrowed to some (not all, not none) people — opens
 * the check-in dialog with exactly those people ticked — else a hint.
 */
function PeopleCheckinAction({ people, onDone }: { people: readonly { id: number; name: string }[]; onDone: () => void }) {
  const only = people.length === 1 ? people[0] : undefined
  return (
    <>
      <div className={picker.dropdownDivider} />
      {people.length === 0 ? (
        <div className={styles.checkinHint}>Narrow to some people to email them.</div>
      ) : (
        <button
          type="button"
          className={styles.checkinAction}
          onClick={() => {
            onDone()
            useUIStore.getState().openCheckinDialog(people.map((p) => p.id))
          }}
        >
          <EnvelopeIcon />
          {only ? `Email check-in to ${only.name}…` : `Email check-in to ${people.length} people…`}
        </button>
      )}
    </>
  )
}

/**
 * A screen-filter button: icon + label (the value while the filter is on),
 * then a chevron — or, while on, a round × that clears just this field.
 */
function FilterButton({ field }: { field: FieldDef }) {
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const { onOpen, onClose } = field
  const close = useCallback(() => {
    setOpen(false)
    onClose?.()
  }, [onClose])
  const { panelRef, style } = usePopoverAnchor({ anchor: { kind: 'ref', ref: pillRef }, open, onClose: close })
  const on = field.value != null

  return (
    <div ref={pillRef} className={`${styles.filterButton} ${field.highlighted ? styles.filterButtonActive : ''} ${on ? styles.filterButtonOn : ''}`}>
      <button
        type="button"
        className={styles.filterMain}
        aria-expanded={open}
        aria-label={on ? `${field.label} filter: ${field.value}` : `${field.label} filter`}
        onClick={() => {
          if (open) close()
          else { setOpen(true); onOpen?.() }
        }}
      >
        <span className={styles.icon}>{field.icon}</span>
        <span className={styles.filterLabel}>{field.value ?? field.label}</span>
        {!on && <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>}
      </button>
      {on && (
        <button
          type="button"
          className={styles.clearField}
          aria-label={`Clear ${field.label.toLowerCase()} filter`}
          onClick={() => { close(); field.onClear() }}
        >
          <CloseIcon size={8} />
        </button>
      )}
      {open && createPortal(
        <div ref={panelRef} className={picker.dropdownPanel} style={{ position: style.position, left: style.left, top: style.top }}>
          <FieldPanelBody field={field} onDone={close} />
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * The narrow-window fold: one Filters button (with a count badge) whose menu
 * lists every screen filter; each row opens that filter's picker beside it.
 */
function FiltersMenu({ fields, onClearAll }: { fields: FieldDef[]; onClearAll: () => void }) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState<{ key: FieldKey; x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  const count = fields.filter((f) => f.value != null).length
  const subField = sub ? fields.find((f) => f.key === sub.key) : undefined
  const subOnClose = subField?.onClose

  const closeSub = useCallback(() => {
    setSub(null)
    subOnClose?.()
  }, [subOnClose])
  const closeAll = useCallback(() => {
    closeSub()
    setOpen(false)
  }, [closeSub])

  const { panelRef: menuPanelRef, style: menuStyle } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: closeAll,
    // A picker's list scrolling in the submenu must not close the menu.
    closeOnScroll: false,
    extraInsideRefs: [subRef],
  })
  const { panelRef: subPanelRef, style: subStyle } = usePopoverAnchor({
    anchor: { kind: 'point', x: sub?.x ?? 0, y: sub?.y ?? 0 },
    open: sub != null,
    offset: 0,
    onClose: closeSub,
    closeOnOutsideClick: false,
  })
  const setSubRef = useCallback((el: HTMLDivElement | null) => {
    subRef.current = el
    subPanelRef(el)
  }, [subPanelRef])

  const openSub = (field: FieldDef, row: HTMLElement) => {
    if (sub?.key === field.key) { closeSub(); return }
    closeSub()
    const rect = row.getBoundingClientRect()
    setSub({ key: field.key, x: rect.right + 4, y: rect.top - 4 })
    field.onOpen?.()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.filterButton} ${styles.filterMain} ${styles.filtersTrigger} ${count > 0 ? styles.filterButtonActive : ''}`}
        aria-expanded={open}
        aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
        onClick={() => (open ? closeAll() : setOpen(true))}
      >
        <span className={styles.filterLabel}>Filters</span>
        {count > 0 && <span className={styles.countBadge}>{count}</span>}
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>
      </button>
      {open && createPortal(
        <div
          ref={menuPanelRef}
          className={styles.menu}
          style={{ position: menuStyle.position, left: menuStyle.left, top: menuStyle.top }}
          role="group"
          aria-label="Screen filters"
        >
          <div className={styles.menuLabel}>Screen filters · apply to every widget</div>
          {fields.map((field) => (
            <div key={field.key} className={`${styles.menuRow} ${sub?.key === field.key ? styles.menuRowOpen : ''}`}>
              <button
                type="button"
                className={styles.menuRowMain}
                aria-expanded={sub?.key === field.key}
                aria-label={field.value != null ? `${field.label} filter: ${field.value}` : `${field.label} filter`}
                onClick={(e) => openSub(field, e.currentTarget.parentElement ?? e.currentTarget)}
              >
                <span className={styles.icon}>{field.icon}</span>
                <span className={styles.menuRowName}>{field.label}</span>
                {field.value != null
                  ? <span className={styles.menuRowValue}>{field.value}</span>
                  : <span className={styles.menuRowAny}>Any <ChevronRightIcon size={10} /></span>}
              </button>
              {field.value != null && (
                <button
                  type="button"
                  className={styles.clearField}
                  aria-label={`Clear ${field.label.toLowerCase()} filter`}
                  onClick={() => { if (sub?.key === field.key) closeSub(); field.onClear() }}
                >
                  <CloseIcon size={8} />
                </button>
              )}
            </div>
          ))}
          <div className={styles.menuSeparator} role="separator" />
          <button
            type="button"
            className={styles.menuClearAll}
            disabled={count === 0}
            onClick={() => { onClearAll(); closeAll() }}
          >
            Clear all filters
          </button>
        </div>,
        document.body,
      )}
      {sub && subField && createPortal(
        <div
          ref={setSubRef}
          className={picker.dropdownPanel}
          style={{ position: subStyle.position, left: subStyle.left, top: subStyle.top }}
        >
          <FieldPanelBody key={subField.key} field={subField} onDone={closeSub} onCloseAll={closeAll} />
        </div>,
        document.body,
      )}
    </>
  )
}

/** The value text of each active field (tags without their `#`: the button shows a # glyph). */
function useFieldValues(p: TodoPredicate, names: Parameters<typeof filterChips>[1]): Partial<Record<FieldKey, string>> {
  return useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {}
    for (const chip of filterChips(p, names)) {
      switch (chip.field) {
        case 'people':
        case 'status':
        case 'markers':
          out[chip.field] = chip.value
          break
        case 'tags':
          out.tags = chip.value.replace(/^#/, '')
          break
        case 'dates':
          out.dates = chip.label === 'Dates' ? chip.value : `${chip.label} ${chip.value}`
          break
      }
    }
    return out
  }, [p, names])
}

/**
 * The top bar's screen filters: Priority, Tags, People, Dates and Status
 * buttons (folded into one Filters menu — which ends with Clear all filters —
 * when `fold` is set), then Show completed. The top bar's funnel clears them
 * all. The pickers are the shared `FilterPanels`.
 */
export function FilterChipBarDesktop({
  predicate,
  onChange,
  onClearExtra,
  onClearAll,
  fold = false,
  compact = false,
}: FilterChipBarProps) {
  const [previewEmpty, setPreviewEmpty] = useState<EntityKey | null>(null)
  const resetDensityState = useCallback(() => setPreviewEmpty(null), [])

  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p, people, statuses, sortedTags, allTagIds, personIdsSet, statusIdsSet, tagIdsSet,
    peopleActive, statusActive, tagsActive, dateActive, update,
    setPersonIds, setStatusIds, setTags, clearAll,
  } = s

  const names = useMemo(() => ({ people, tags: sortedTags, statuses }), [people, sortedTags, statuses])
  const values = useFieldValues(p, names)

  const entityHandlers = (key: EntityKey, isActive: boolean, setIds: (next: Set<number> | null) => void) => ({
    onOpen: () => { if (!isActive) setPreviewEmpty(key) },
    onClose: () => setPreviewEmpty((cur) => (cur === key ? null : cur)),
    allSelected: !isActive && previewEmpty !== key,
    onSelectAll: () => { setPreviewEmpty(null); setIds(null) },
    onDeselectAll: () => { setPreviewEmpty(null); setIds(new Set()) },
  })

  const toggle = (key: EntityKey, id: number, current: Set<number> | null, allIds: number[], setIds: (next: Set<number> | null) => void) => {
    if (previewEmpty === key) {
      setPreviewEmpty(null)
      setIds(new Set([id]))
      return
    }
    setIds(toggleItem(current, id, allIds))
  }
  const checked = (key: EntityKey, current: Set<number> | null) => (id: number) =>
    previewEmpty === key ? false : current === null || current.has(id)
  const none = (key: EntityKey, current: Set<number> | null) =>
    previewEmpty === key || (current !== null && current.size === 0)
  const clearField = (field: FieldKey) => update(clearChipField(p, field))

  const fields: FieldDef[] = []
  if (people.length > 0) {
    const h = entityHandlers('people', peopleActive, setPersonIds)
    fields.push({
      key: 'people',
      label: 'People',
      icon: <AtIcon />,
      highlighted: peopleActive || previewEmpty === 'people',
      value: values.people ?? null,
      onClear: () => clearField('people'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        allSelected: h.allSelected,
        noneSelected: none('people', personIdsSet),
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText) => (
          <EntityDropdownItems
            searchText={searchText}
            entities={people}
            isChecked={checked('people', personIdsSet)}
            onToggle={(id) => toggle('people', id, personIdsSet, [0, ...people.map((x) => x.id!)], setPersonIds)}
            namePrefix="@"
            showDot={false}
          />
        ),
        footer: (closeAll) => (
          <PeopleCheckinAction
            people={previewEmpty === 'people' ? [] : narrowedPeople(people, personIdsSet)}
            onDone={closeAll}
          />
        ),
      },
    })
  }
  if (sortedTags.length > 0) {
    const h = entityHandlers('tags', tagsActive, setTags)
    const isTagChecked = checked('tags', tagIdsSet)
    fields.push({
      key: 'tags',
      label: 'Tags',
      icon: <HashIcon />,
      highlighted: tagsActive || previewEmpty === 'tags',
      value: values.tags ?? null,
      onClear: () => clearField('tags'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        allSelected: h.allSelected,
        noneSelected: none('tags', tagIdsSet),
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText) => {
          const q = searchText.toLowerCase()
          const filtered = q ? sortedTags.filter((t) => t.name.toLowerCase().includes(q)) : sortedTags
          if (filtered.length === 0) {
            return <div className={picker.dropdownEmpty}>{q ? 'No matches' : 'No tags yet'}</div>
          }
          return filtered.map((tag) => (
            <label key={tag.id} className={picker.dropdownItem} onClick={() => toggle('tags', tag.id!, tagIdsSet, allTagIds, setTags)}>
              <span className={`${picker.check} ${isTagChecked(tag.id!) ? picker.checked : ''}`} />
              {tag.color && <span className={picker.dot} style={{ background: tag.color }} />}
              #{tag.name}
            </label>
          ))
        },
      },
    })
  }
  fields.push({
    key: 'dates',
    label: 'Dates',
    icon: <WidgetKindIcon kind="calendar" />,
    highlighted: dateActive,
    value: values.dates ?? null,
    onClear: () => clearField('dates'),
    panel: {
      kind: 'custom',
      render: (close) => (
        <DateRangePanelBody
          active={dateActive}
          dateField={p.dateField}
          startAnchor={p.dateRangeStart}
          endAnchor={p.dateRangeEnd}
          includeNoDate={p.dateRangeIncludeNoDate}
          hasDeadline={p.hasDeadline}
          hasFollowup={p.hasFollowup ?? null}
          onChangeDateField={(dateField) => update({ dateField })}
          onChangeAnchors={(dateRangeStart, dateRangeEnd) => update({ dateRangeStart, dateRangeEnd })}
          onChangeIncludeNoDate={(dateRangeIncludeNoDate) => update({ dateRangeIncludeNoDate })}
          onChangeHasDeadline={(hasDeadline) => update({ hasDeadline })}
          onChangeHasFollowup={(hasFollowup) => update({ hasFollowup })}
          onCleared={close}
        />
      ),
    },
  })
  if (statuses.length > 0) {
    const h = entityHandlers('status', statusActive, setStatusIds)
    fields.push({
      key: 'status',
      label: 'Status',
      icon: <StatusRingIcon />,
      highlighted: statusActive || previewEmpty === 'status',
      value: values.status ?? null,
      onClear: () => clearField('status'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        allSelected: h.allSelected,
        noneSelected: none('status', statusIdsSet),
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText) => (
          <EntityDropdownItems
            searchText={searchText}
            entities={statuses}
            isChecked={checked('status', statusIdsSet)}
            onToggle={(id) => toggle('status', id, statusIdsSet, [0, ...statuses.map((x) => x.id!)], setStatusIds)}
          />
        ),
      },
    })
  }
  fields.push({
    key: 'markers',
    label: MARKERS_LABEL,
    icon: <ImportantIcon outline />,
    highlighted: hasMarkers(p.markers),
    value: values.markers ?? null,
    onClear: () => clearField('markers'),
    panel: {
      kind: 'custom',
      // Several markers can be ticked, so picking one keeps the picker open.
      render: () => <MarkersPanelBody value={p.markers ?? null} onChange={(markers) => update({ markers })} />,
    },
  })
  // Buttons and the folded menu in display order (Priority, Tags, People, Dates, Status).
  fields.sort((a, b) => FILTER_FIELD_ORDER.indexOf(a.key) - FILTER_FIELD_ORDER.indexOf(b.key))

  return (
    <>
      {fold
        ? <FiltersMenu fields={fields} onClearAll={clearAll} />
        : fields.map((field) => <FilterButton key={field.key} field={field} />)}
      <span className={styles.separator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.completed} ${p.showCompleted ? styles.completedOn : ''}`}
        onClick={() => update({ showCompleted: !p.showCompleted })}
        aria-pressed={p.showCompleted}
        aria-label="Show completed"
      >
        <CheckIcon size={12} />
        {compact ? 'Completed' : 'Show completed'}
      </button>
    </>
  )
}
