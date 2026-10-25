import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { datesSpokenValue, datesTooltip, datesValue, filterChips, FILTER_FIELD_ORDER, type FilterChipField } from '../../../utils/filter-chips'
import { entityPickerSelection } from '../../../utils/filter-negation'
import { NO_TAGS_LABEL } from '../../../utils/filter-labels'
import type { TodoPredicate } from '../../../models'
import picker from './FilterPicker.module.css'
import { ImportantIcon } from '../MarkerIcons'
import { hasMarkers, MARKERS_LABEL } from '../../../utils/markers'
import { useUIStore } from '../../../stores/ui-store'
import { sendPersonCheckin } from '../../../services/checkin-email/person-checkin'
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
import { EntityDropdownItems, MarkersPanelBody, SelectionPanelBody, type FilterModeProps } from './FilterPanels'
import { DateFilterPanel } from './DateFilterPanel'
import { DATE_FILTER_DIALOG_LABEL, DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { useTooltip } from '../use-tooltip'
import { useReturnFocus } from '../use-popover-focus'
import {
  FOLD_HIDDEN_ATTR,
  FOLD_VALUE_ATTR,
  FOLD_VARIANT_ATTR,
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
      /** The Is / Is not toggle (People / Status / Tags). */
      mode?: FilterModeProps
      allSelected: boolean
      noneSelected: boolean
      onSelectAll: () => void
      onDeselectAll: () => void
      /**
       * `closeAll` closes every filter popover (a person's / tag's Show tasks);
       * `clearSearch` empties the search box (a pick clears it).
       */
      items: (searchText: string, closeAll: () => void, clearSearch: () => void) => ReactNode
      /** Below the items (the People picker's Email check-in action); `closeAll` closes every filter popover. */
      footer?: (closeAll: () => void) => ReactNode
    }
  | {
      kind: 'custom'
      render: (close: () => void) => ReactNode
      /** The popover's class instead of the picker panel's. */
      className?: string
      /** The popover is a `dialog` with this name. */
      dialogLabel?: string
    }

/** One screen filter (Priority, Tags, People, Dates, Status) as the bar and the Filters menu show it. */
interface FieldDef {
  key: FieldKey
  label: string
  icon: ReactNode
  /** Accent look: the filter is on, or its picker is previewing an empty pick. */
  highlighted: boolean
  /** The value text while the filter is on (`Priya Nair`, `q4 +1`); null when off. */
  value: string | null
  /** The value as the button's name says it, when it differs from `value`. */
  spokenValue?: string | null
  /** Shown on hover / focus of the button (several lines: the first `tooltipLabelLines` are the label). */
  tooltip?: string | null
  tooltipLabelLines?: number
  /** The × button's name; default `Clear <label> filter`. */
  clearLabel?: string
  /** A longer value before the ellipsis (the Dates button). */
  wide?: boolean
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
        mode={panel.mode}
        allSelected={panel.allSelected}
        noneSelected={panel.noneSelected}
        onSelectAll={panel.onSelectAll}
        onDeselectAll={panel.onDeselectAll}
        search={{ text: searchText, setText: setSearchText, onEscape: onDone }}
        searchInputRef={searchRef}
      >
        {panel.items(searchText, onCloseAll, () => setSearchText(''))}
      </SelectionPanelBody>
      {panel.footer?.(onCloseAll)}
    </>
  )
}

/**
 * The People picker's footer while the filter is narrowed to some (not all,
 * not none) people: `Email check-in to <name>` emails that one person at
 * once (`sendPersonCheckin`); `Email check-in to N people…` opens the
 * check-in dialog with exactly those people ticked. Else a hint.
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
            // The one-person send first, inside the click: its clipboard write needs the gesture.
            if (only) void sendPersonCheckin(only.id)
            else useUIStore.getState().openCheckinDialog(people.map((p) => p.id))
            onDone()
          }}
        >
          <EnvelopeIcon />
          {only ? `Email check-in to ${only.name}` : `Email check-in to ${people.length} people…`}
        </button>
      )}
    </>
  )
}

/**
 * A screen-filter button: icon + label (the value while the filter is on),
 * then a chevron — or, while on, a round × that clears just this field.
 * `valueWidth` cuts the value to that width (ellipsis); the tooltip then
 * shows it whole (`People: Aisha Rahman`), unless the field has its own
 * tooltip, which already spells it out.
 */
function FilterButton({ field, consumeEscape, valueWidth }: { field: FieldDef; consumeEscape: boolean; valueWidth?: number }) {
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)
  useReturnFocus(open, mainRef)
  const { onOpen, onClose } = field
  const close = useCallback(() => {
    setOpen(false)
    onClose?.()
  }, [onClose])
  const { panelRef, style } = usePopoverAnchor({ anchor: { kind: 'ref', ref: pillRef }, open, onClose: close, consumeEscape })
  const on = field.value != null
  const cut = on && valueWidth != null
  // No tooltip over an open picker. A field's own tooltip starts with its whole value already.
  const { triggerProps, tooltip } = useTooltip(
    open ? null : (field.tooltip ?? (cut ? `${field.label}: ${field.value}` : null)),
    { labelLines: field.tooltip ? field.tooltipLabelLines : undefined },
  )

  return (
    <div
      ref={pillRef}
      className={`${styles.filterButton} ${field.highlighted ? styles.filterButtonActive : ''} ${on ? styles.filterButtonOn : ''} ${on && open ? styles.filterButtonOpen : ''}`}
    >
      <button
        ref={mainRef}
        type="button"
        className={styles.filterMain}
        aria-expanded={open}
        aria-label={filterName(field)}
        {...triggerProps}
        onClick={() => {
          if (open) close()
          else { setOpen(true); onOpen?.() }
        }}
      >
        <span className={styles.icon}>{field.icon}</span>
        <span
          className={`${styles.filterLabel} ${field.wide ? styles.filterLabelWide : ''}`}
          style={cut ? { maxWidth: valueWidth } : undefined}
          {...(on ? { [FOLD_VALUE_ATTR]: field.key } : {})}
        >
          {field.value ?? field.label}
        </span>
        {!on && <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>}
      </button>
      {tooltip}
      {on && (
        <button
          type="button"
          className={styles.clearField}
          aria-label={clearName(field)}
          onClick={() => { close(); field.onClear() }}
        >
          <CloseIcon size={8} />
        </button>
      )}
      {open && createPortal(
        <FieldPopover field={field} panelRef={panelRef} position={style}>
          <FieldPanelBody field={field} onDone={close} />
        </FieldPopover>,
        document.body,
      )}
    </div>
  )
}

/** A filter button's (or Filters menu row's) name: `People filter`, `Dates filter: Due within 7 days; Created …`. */
function filterName(field: FieldDef): string {
  const value = field.spokenValue ?? field.value
  return value != null ? `${field.label} filter: ${value}` : `${field.label} filter`
}

function clearName(field: FieldDef): string {
  return field.clearLabel ?? `Clear ${field.label.toLowerCase()} filter`
}

/** The portaled popover a field's picker sits in: the picker panel, or the field's own popover. */
function FieldPopover({ field, panelRef, position, children }: {
  field: FieldDef
  panelRef: (el: HTMLDivElement | null) => void
  position: Pick<CSSProperties, 'position' | 'left' | 'top'>
  children: ReactNode
}) {
  const custom = field.panel.kind === 'custom' ? field.panel : null
  return (
    <div
      ref={panelRef}
      className={custom?.className ?? picker.dropdownPanel}
      style={{ position: position.position, left: position.left, top: position.top }}
      role={custom?.dialogLabel ? 'dialog' : undefined}
      aria-label={custom?.dialogLabel}
    >
      {children}
    </div>
  )
}

/**
 * The narrow-window fold: one Filters button (with a count badge) whose menu
 * lists every screen filter; each row opens that filter's picker beside it.
 */
function FiltersMenu({ fields, onClearAll, consumeEscape }: { fields: FieldDef[]; onClearAll: () => void; consumeEscape: boolean }) {
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
    consumeEscape,
  })
  const { panelRef: subPanelRef, style: subStyle } = usePopoverAnchor({
    anchor: { kind: 'point', x: sub?.x ?? 0, y: sub?.y ?? 0 },
    open: sub != null,
    offset: 0,
    onClose: closeSub,
    closeOnOutsideClick: false,
    consumeEscape,
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
                aria-label={filterName(field)}
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
                  aria-label={clearName(field)}
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
        <FieldPopover field={subField} panelRef={setSubRef} position={subStyle}>
          <FieldPanelBody key={subField.key} field={subField} onDone={closeSub} onCloseAll={closeAll} />
        </FieldPopover>,
        document.body,
      )}
    </>
  )
}

interface FieldValues {
  /** The value text of each active field (tags without their `#`: the button shows a # glyph). */
  values: Partial<Record<FieldKey, string>>
  /** An "is not" field's (or a Priority No's) tooltip: what it hides. */
  tooltips: Partial<Record<FieldKey, string>>
}

/** Each active field's value text (`not Waiting` for an "is not" one) and the "is not" / Priority No tooltips. */
function useFieldValues(p: TodoPredicate, names: Parameters<typeof filterChips>[1]): FieldValues {
  return useMemo(() => {
    const values: Partial<Record<FieldKey, string>> = {}
    const tooltips: Partial<Record<FieldKey, string>> = {}
    for (const chip of filterChips(p, names)) {
      switch (chip.field) {
        case 'people':
        case 'status':
        case 'markers':
          values[chip.field] = chip.value
          if (chip.tooltip) tooltips[chip.field] = chip.tooltip
          break
        case 'tags':
          values.tags = chip.value.replace(/^(not )?#/, '$1')
          if (chip.tooltip) tooltips.tags = chip.tooltip
          break
      }
    }
    const dates = datesValue(p.dates)
    if (dates != null) values.dates = dates
    return { values, tooltips }
  }, [p, names])
}

/**
 * The top bar's screen filters: Priority, Tags, People, Dates and Status
 * buttons (folded into one Filters menu — which ends with Clear all filters —
 * when `fold` is set), then Show completed (labelled `Completed`). The top bar's funnel clears them
 * all. The pickers are the shared `FilterPanels`. With `measureFold` both
 * folds are laid out too, hidden and inert, at their natural widths, for the
 * top bar's measure; `valueWidths` cuts the shown values. With `consumeEscape` (the
 * top bar's filtered-tasks panel is open) the Esc that closes a picker or
 * the Filters menu stops there: the next one closes the panel.
 */
export function FilterChipBarDesktop({
  predicate,
  onChange,
  onClearExtra,
  onClearAll,
  fold = false,
  measureFold = false,
  valueWidths,
  consumeEscape = false,
}: FilterChipBarProps) {
  const [previewEmpty, setPreviewEmpty] = useState<EntityKey | null>(null)
  const resetDensityState = useCallback(() => setPreviewEmpty(null), [])

  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p, people, statuses, sortedTags, allTagIds, personIdsSet, statusIdsSet, tagIdsSet,
    peopleActive, statusActive, tagsActive, dateActive, negated, update,
    setPersonIds, setStatusIds, setTags, setNegated, dropPendingMode, clearField, clearAll,
  } = s

  const names = useMemo(() => ({ people, tags: sortedTags, statuses }), [people, sortedTags, statuses])
  const { values, tooltips } = useFieldValues(p, names)

  // "Is": an inactive field's picker opens with nothing ticked (`previewEmpty`)
  // and the first tick narrows to it. "Is not": nothing ticked is no filter,
  // so ticks are plain adds / removes.
  const entityHandlers = (key: EntityKey, label: string, isActive: boolean, current: Set<number> | null, allIds: number[], setIds: (next: Set<number> | null) => void) => {
    const not = negated[key]
    const sel = entityPickerSelection(current, not, previewEmpty === key, allIds)
    const mode: FilterModeProps = {
      field: label,
      negated: not,
      onChange: (on) => {
        // Back to "is" with nothing filtered: the preview again (nothing ticked).
        setPreviewEmpty(on || current !== null ? null : key)
        setNegated(key, on)
      },
    }
    return {
      mode,
      onOpen: () => { if (!isActive) setPreviewEmpty(key) },
      onClose: () => {
        setPreviewEmpty((cur) => (cur === key ? null : cur))
        dropPendingMode(key)
      },
      allSelected: sel.allSelected,
      noneSelected: sel.noneSelected,
      onSelectAll: () => { setPreviewEmpty(null); setIds(sel.all) },
      onDeselectAll: () => { setPreviewEmpty(null); setIds(sel.none) },
      isChecked: sel.isChecked,
      onToggle: (id: number) => {
        if (sel.previewing) setPreviewEmpty(null)
        setIds(sel.toggled(id))
      },
    }
  }

  const fields: FieldDef[] = []
  if (people.length > 0) {
    const h = entityHandlers('people', 'People', peopleActive, personIdsSet, [0, ...people.map((x) => x.id!)], setPersonIds)
    fields.push({
      key: 'people',
      label: 'People',
      icon: <AtIcon />,
      highlighted: peopleActive || previewEmpty === 'people' || negated.people,
      value: values.people ?? null,
      tooltip: tooltips.people,
      tooltipLabelLines: 1,
      onClear: () => clearField('people'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        mode: h.mode,
        allSelected: h.allSelected,
        noneSelected: h.noneSelected,
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText, closeAll, clearSearch) => (
          <EntityDropdownItems
            searchText={searchText}
            entities={people}
            label="People"
            isChecked={h.isChecked}
            onToggle={h.onToggle}
            onSearchClear={clearSearch}
            namePrefix="@"
            showDot={false}
            entityMenu="person"
            onShowTasks={closeAll}
          />
        ),
        footer: (closeAll) => (
          <PeopleCheckinAction
            people={previewEmpty === 'people' && !negated.people ? [] : narrowedPeople(people, personIdsSet, negated.people)}
            onDone={closeAll}
          />
        ),
      },
    })
  }
  if (sortedTags.length > 0) {
    const h = entityHandlers('tags', 'Tags', tagsActive, tagIdsSet, allTagIds, setTags)
    fields.push({
      key: 'tags',
      label: 'Tags',
      icon: <HashIcon />,
      highlighted: tagsActive || previewEmpty === 'tags' || negated.tags,
      value: values.tags ?? null,
      tooltip: tooltips.tags,
      tooltipLabelLines: 1,
      onClear: () => clearField('tags'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        mode: h.mode,
        allSelected: h.allSelected,
        noneSelected: h.noneSelected,
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText, closeAll, clearSearch) => (
          <EntityDropdownItems
            searchText={searchText}
            entities={sortedTags}
            label="Tags"
            isChecked={h.isChecked}
            onToggle={h.onToggle}
            onSearchClear={clearSearch}
            namePrefix="#"
            noneLabel={NO_TAGS_LABEL}
            entityMenu="tag"
            onShowTasks={closeAll}
          />
        ),
      },
    })
  }
  const dateTooltip = datesTooltip(p.dates)
  fields.push({
    key: 'dates',
    label: 'Dates',
    icon: <WidgetKindIcon kind="calendar" />,
    highlighted: dateActive,
    value: values.dates ?? null,
    spokenValue: datesSpokenValue(p.dates),
    tooltip: dateTooltip,
    // Each type's line is the label; the last line (how they combine) is muted.
    tooltipLabelLines: dateTooltip ? dateTooltip.split('\n').length - 1 : undefined,
    clearLabel: 'Clear date filters',
    wide: true,
    onClear: () => clearField('dates'),
    panel: {
      kind: 'custom',
      className: DATE_FILTER_POPOVER_CLASS,
      dialogLabel: DATE_FILTER_DIALOG_LABEL,
      // Picking a type or clearing keeps the panel open.
      render: () => <DateFilterPanel dates={p.dates} onChange={(dates) => update({ dates })} autoFocus />,
    },
  })
  if (statuses.length > 0) {
    const h = entityHandlers('status', 'Status', statusActive, statusIdsSet, [0, ...statuses.map((x) => x.id!)], setStatusIds)
    fields.push({
      key: 'status',
      label: 'Status',
      icon: <StatusRingIcon />,
      highlighted: statusActive || previewEmpty === 'status' || negated.status,
      value: values.status ?? null,
      tooltip: tooltips.status,
      tooltipLabelLines: 1,
      onClear: () => clearField('status'),
      onOpen: h.onOpen,
      onClose: h.onClose,
      panel: {
        kind: 'selection',
        mode: h.mode,
        allSelected: h.allSelected,
        noneSelected: h.noneSelected,
        onSelectAll: h.onSelectAll,
        onDeselectAll: h.onDeselectAll,
        items: (searchText, _closeAll, clearSearch) => (
          <EntityDropdownItems
            searchText={searchText}
            entities={statuses}
            label="Status"
            isChecked={h.isChecked}
            onToggle={h.onToggle}
            onSearchClear={clearSearch}
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
    tooltip: tooltips.markers,
    tooltipLabelLines: 1,
    onClear: () => clearField('markers'),
    panel: {
      kind: 'custom',
      // Several markers can be set, so picking one keeps the picker open.
      render: () => <MarkersPanelBody value={p.markers ?? null} onChange={(markers) => update({ markers })} />,
    },
  })
  // Buttons and the folded menu in display order (Priority, Tags, People, Dates, Status).
  fields.sort((a, b) => FILTER_FIELD_ORDER.indexOf(a.key) - FILTER_FIELD_ORDER.indexOf(b.key))

  const variant = (folded: boolean, widths?: FilterChipBarProps['valueWidths']) => (folded
    ? <FiltersMenu fields={fields} onClearAll={clearAll} consumeEscape={consumeEscape} />
    : fields.map((field) => <FilterButton key={field.key} field={field} consumeEscape={consumeEscape} valueWidth={widths?.[field.key]} />))

  return (
    <>
      {measureFold
        ? <span className={styles.foldShown} {...{ [FOLD_VARIANT_ATTR]: fold ? 'folded' : 'open' }}>{variant(fold, valueWidths)}</span>
        : variant(fold, valueWidths)}
      {measureFold && ([false, true] as const).map((folded) => (
        // Each fold at its natural width, for the measure only: never seen, never reached.
        <span
          key={folded ? 'folded' : 'open'}
          className={styles.foldHidden}
          aria-hidden="true"
          inert
          {...{ [FOLD_VARIANT_ATTR]: folded ? 'folded' : 'open', [FOLD_HIDDEN_ATTR]: '' }}
        >
          {variant(folded)}
        </span>
      ))}
      <span className={styles.separator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.completed} ${p.showCompleted ? styles.completedOn : ''}`}
        onClick={() => update({ showCompleted: !p.showCompleted })}
        aria-pressed={p.showCompleted}
        aria-label="Show completed"
      >
        <CheckIcon size={12} />
        Completed
      </button>
    </>
  )
}
