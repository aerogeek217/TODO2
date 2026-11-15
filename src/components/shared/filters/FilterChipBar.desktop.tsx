import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FILTER_MENU_ATTR } from '../../../utils/dom-contract'
import { createPortal } from 'react-dom'
import { usePopoverAnchor, type PopoverCaret } from '../../../hooks/use-popover-anchor'
import { datesSpokenValue, datesValue, filterChips, FILTER_FIELD_ORDER, type FilterChipField } from '../../../utils/filter-chips'
import { entityPickerSelection } from '../../../utils/filter-negation'
import { NO_TAGS_LABEL } from '../../../utils/filter-labels'
import type { TodoPredicate } from '../../../models'
import picker from './FilterPicker.module.css'
import { ImportantIcon } from '../MarkerIcons'
import { MARKERS_LABEL } from '../../../utils/markers'
import { peopleMenuEntries, useEntityMenuOffers } from '../person-menu-entries'
import {
  AtIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  HashIcon,
  StatusRingIcon,
  WidgetKindIcon,
} from '../icons'
import { EntityDropdownItems, MarkerClausePicker, SelectionPanelBody, type FilterModeProps } from './FilterPanels'
import { DateFilterPanel } from './DateFilterPanel'
import { DatePendingNotContext, screenPendingNot } from './date-pending-not'
import { DATE_FILTER_DIALOG_LABEL, DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { usePopoverFocus, useReturnFocus } from '../use-popover-focus'
import {
  narrowedPeople,
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'
import styles from './ScreenFilters.module.css'
import { PopoverRoot } from '../PopoverRoot'
import { PopoverLevelContext, usePopoverLevel } from '../popover-level'

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
      /** Below the items (the People picker's Review action); `closeAll` closes every filter popover. */
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
  /** The value text while the filter is on (`Priya Nair`, `q4 +1`); null when off. */
  value: string | null
  /** The value as the button's name says it, when it differs from `value`. */
  spokenValue?: string | null
  /** The × button's name; default `Clear <label> filter`. */
  clearLabel?: string
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
 * not none) people — the person menu's Review (`peopleMenuEntries`): for one
 * person `Review with <name>`, for several `Review N people’s tasks` — a
 * jump to a Review widget with `@A or @B`. Else a hint. None inside a dialog
 * the task dialog can't show above (`useEntityMenuOffers`): Review is all it offers.
 */
function PeopleReviewAction({ people, onDone }: { people: readonly { id: number; name: string }[]; onDone: () => void }) {
  const { review } = useEntityMenuOffers()
  if (!review) return null
  return (
    <>
      <div className={picker.dropdownDivider} />
      {people.length === 0 ? (
        <div className={styles.reviewHint}>Narrow to some people to review them.</div>
      ) : (
        peopleMenuEntries(people, { review, after: onDone }).map((item) => (
          <button
            key={item.label}
            type="button"
            className={styles.reviewAction}
            disabled={item.disabled}
            data-tooltip={item.title}
            onClick={item.onSelect}
          >
            {item.icon}
            {item.label}
          </button>
        ))
      )}
    </>
  )
}

/** A Filter menu row's name: `People filter`, `Dates filter: Due in 14 days or earlier; Created …`. */
function filterName(field: FieldDef): string {
  const value = field.spokenValue ?? field.value
  return value != null ? `${field.label} filter: ${value}` : `${field.label} filter`
}

function clearName(field: FieldDef): string {
  return field.clearLabel ?? `Clear ${field.label.toLowerCase()} filter`
}

/** The portaled popover a field's picker sits in: the picker panel, or the field's own popover. */
function FieldPopover({ field, panelRef, position, caret = null, children }: {
  field: FieldDef
  panelRef: (el: HTMLDivElement | null) => void
  position: Pick<CSSProperties, 'position' | 'left' | 'top'>
  /** The caret towards the filter button (none for a picker beside the Filters menu). */
  caret?: PopoverCaret | null
  children: ReactNode
}) {
  const custom = field.panel.kind === 'custom' ? field.panel : null
  return (
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      className={custom?.className ?? picker.dropdownPanel}
      style={{ position: position.position, left: position.left, top: position.top }}
      role={custom?.dialogLabel ? 'dialog' : undefined}
      aria-label={custom?.dialogLabel}
    >
      {children}
    </PopoverRoot>
  )
}

/**
 * The top bar's Filter button (`Filter`) and its menu: every screen filter
 * as a row — each opens that filter's picker beside the menu — then
 * Completed (a toggle) and, while any filter is on, Clear all filters. The
 * filters that are on show as the field's pills (feedback P2); the button's
 * name counts them. The menu holds the keyboard as a popover does: its
 * first row takes the focus on opening, Tab wraps inside it, and the focus
 * comes back to the button (from a picker, to its row) when it closes.
 */
function FilterMenu({ fields, showCompleted, onToggleCompleted, active, onClearAll, consumeEscape }: {
  fields: FieldDef[]
  showCompleted: boolean
  onToggleCompleted: () => void
  /** Any screen filter on (Clear all filters shows). */
  active: boolean
  onClearAll: () => void
  consumeEscape: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState<{ key: FieldKey; row: { left: number; top: number; right: number; bottom: number } } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const subRef = useRef<HTMLDivElement | null>(null)
  const subRowRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const level = usePopoverLevel()
  const count = fields.filter((f) => f.value != null).length + (showCompleted ? 1 : 0)
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
  // A picker closed with the focus in it: back to its row.
  useReturnFocus(sub != null, subRowRef)

  const { panelRef: menuPanelRef, style: menuStyle, caret: menuCaret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: closeAll,
    // A picker's list scrolling in the submenu must not close the menu.
    closeOnScroll: false,
    extraInsideRefs: [subRef],
    consumeEscape,
    caret: true,
  })
  const { panelRef: subPanelRef, style: subStyle } = usePopoverAnchor({
    // Beside its row, to the right — or to the left of the menu when the right has no room.
    anchor: { kind: 'rect', ...(sub?.row ?? { left: 0, top: 0, right: 0, bottom: 0 }) },
    placement: 'right-start',
    open: sub != null,
    offset: 4,
    onClose: closeSub,
    closeOnOutsideClick: false,
    consumeEscape,
  })
  const setSubRef = useCallback((el: HTMLDivElement | null) => {
    subRef.current = el
    subPanelRef(el)
  }, [subPanelRef])
  const setMenuRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    menuPanelRef(el)
  }, [menuPanelRef])
  const onMenuKeyDown = usePopoverFocus({ open, panelRef: menuRef, triggerRef })

  const openSub = (field: FieldDef, button: HTMLButtonElement) => {
    if (sub?.key === field.key) { closeSub(); return }
    closeSub()
    subRowRef.current = button
    // The menu's edges, the row's height (a picker clear of the whole menu, on whichever side has room).
    const rect = (button.parentElement ?? button).getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect() ?? rect
    setSub({ key: field.key, row: { left: menu.left, top: rect.top - 4, right: menu.right, bottom: rect.bottom } })
    field.onOpen?.()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.filterButton} ${styles.filterMain} ${styles.filtersTrigger}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        {...{ [FILTER_MENU_ATTR]: '' }}
        aria-label={count > 0 ? `Filter, ${count} active` : 'Filter'}
        onClick={() => (open ? closeAll() : setOpen(true))}
      >
        <span className={styles.filterLabel}>Filter</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>
      </button>
      {open && createPortal(
        <PopoverRoot
          ref={setMenuRef}
          id={menuId}
          caret={menuCaret}
          className={styles.menu}
          style={{ position: menuStyle.position, left: menuStyle.left, top: menuStyle.top }}
          role="group"
          aria-label="Screen filters"
          onKeyDown={onMenuKeyDown}
        >
          <div className={styles.menuLabel}>Screen filters · apply to every widget</div>
          {fields.map((field) => (
            <div key={field.key} className={`${styles.menuRow} ${sub?.key === field.key ? styles.menuRowOpen : ''}`}>
              <button
                type="button"
                className={styles.menuRowMain}
                aria-expanded={sub?.key === field.key}
                aria-label={filterName(field)}
                onClick={(e) => openSub(field, e.currentTarget)}
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
          <div className={styles.menuRow}>
            <button
              type="button"
              className={styles.menuRowMain}
              aria-pressed={showCompleted}
              aria-label="Show completed"
              onClick={() => { if (sub) closeSub(); onToggleCompleted() }}
            >
              <span className={`${styles.icon} ${showCompleted ? styles.iconOn : ''}`}><CheckIcon size={12} /></span>
              <span className={styles.menuRowName}>Completed</span>
              <span className={showCompleted ? styles.menuRowValue : styles.menuRowAny}>{showCompleted ? 'Shown' : 'Hidden'}</span>
            </button>
          </div>
          {active && (
            <>
              <div className={styles.menuSeparator} role="separator" />
              <button
                type="button"
                className={styles.menuClearAll}
                onClick={() => { onClearAll(); closeAll() }}
              >
                Clear all filters
              </button>
            </>
          )}
        </PopoverRoot>,
        document.body,
      )}
      {sub && subField && createPortal(
        // A field's picker beside the menu is a popover on it: a level above.
        <PopoverLevelContext.Provider value={level}>
          <FieldPopover field={subField} panelRef={setSubRef} position={subStyle}>
            <FieldPanelBody key={subField.key} field={subField} onDone={closeSub} onCloseAll={closeAll} />
          </FieldPopover>
        </PopoverLevelContext.Provider>,
        document.body,
      )}
    </>
  )
}

/** Each active field's value text (`not Waiting` for an "is not" one; tags without their `#`: the row shows a # glyph). */
function useFieldValues(p: TodoPredicate, names: Parameters<typeof filterChips>[1]): Partial<Record<FieldKey, string>> {
  return useMemo(() => {
    const values: Partial<Record<FieldKey, string>> = {}
    for (const chip of filterChips(p, names)) {
      switch (chip.field) {
        case 'people':
        case 'status':
        case 'markers':
          values[chip.field] = chip.value
          break
        case 'tags':
          // Every name loses its # (`home or garden`).
          values.tags = chip.value.replace(/(^not |^|, | or )#/g, '$1')
          break
      }
    }
    const dates = datesValue(p.dates)
    if (dates != null) values.dates = dates
    return values
  }, [p, names])
}

/**
 * The top bar's screen filters: the one Filter button, whose menu holds
 * Priority, Tags, People, Dates and Status (each opening its picker), then
 * Completed and Clear all filters. The filters that are on show as the
 * field's pills (`TopBarFilterField`), not here. The pickers are the shared
 * `FilterPanels`. With `consumeEscape` (the top bar's filtered-tasks panel
 * is open) the Esc that closes a picker or the Filter menu stops there: the
 * next one closes the panel.
 */
export function FilterChipBarDesktop({
  predicate,
  onChange,
  onClearExtra,
  onClearAll,
  consumeEscape = false,
}: FilterChipBarProps) {
  const [previewEmpty, setPreviewEmpty] = useState<EntityKey | null>(null)
  const resetDensityState = useCallback(() => setPreviewEmpty(null), [])
  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p, people, statuses, sortedTags, allTagIds, personIdsSet, statusIdsSet, tagIdsSet,
    peopleActive, statusActive, tagsActive, active, negated, update,
    setPersonIds, setStatusIds, setTags, setNegated, dropPendingMode, clearField, clearAll,
  } = s

  const names = useMemo(() => ({ people, tags: sortedTags, statuses }), [people, sortedTags, statuses])
  const values = useFieldValues(p, names)

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
      value: values.people ?? null,
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
            showDot={false}
            entityMenu="person"
            onShowTasks={closeAll}
          />
        ),
        footer: (closeAll) => (
          <PeopleReviewAction
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
      value: values.tags ?? null,
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
            noneLabel={NO_TAGS_LABEL}
            entityMenu="tag"
            onShowTasks={closeAll}
          />
        ),
      },
    })
  }
  fields.push({
    key: 'dates',
    label: 'Dates',
    icon: <WidgetKindIcon kind="calendar" />,
    value: values.dates ?? null,
    spokenValue: datesSpokenValue(p.dates),
    clearLabel: 'Clear date filters',
    onClear: () => clearField('dates'),
    panel: {
      kind: 'custom',
      className: DATE_FILTER_POPOVER_CLASS,
      dialogLabel: DATE_FILTER_DIALOG_LABEL,
      // Picking a type or clearing keeps the panel open.
      render: () => (
        <DatePendingNotContext.Provider value={screenPendingNot}>
          <DateFilterPanel dates={p.dates} onChange={(dates) => update({ dates })} autoFocus />
        </DatePendingNotContext.Provider>
      ),
    },
  })
  if (statuses.length > 0) {
    const h = entityHandlers('status', 'Status', statusActive, statusIdsSet, [0, ...statuses.map((x) => x.id!)], setStatusIds)
    fields.push({
      key: 'status',
      label: 'Status',
      icon: <StatusRingIcon />,
      value: values.status ?? null,
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
    value: values.markers ?? null,
    onClear: () => clearField('markers'),
    panel: {
      kind: 'custom',
      // The top bar is flat: one condition. Picking keeps the picker open.
      render: () => <MarkerClausePicker clause={p.markers?.[0] ?? null} onChange={(c) => update({ markers: c ? [c] : null })} />,
    },
  })
  // The menu's rows in display order (Priority, Tags, People, Dates, Status).
  fields.sort((a, b) => FILTER_FIELD_ORDER.indexOf(a.key) - FILTER_FIELD_ORDER.indexOf(b.key))

  return (
    <FilterMenu
      fields={fields}
      showCompleted={p.showCompleted}
      onToggleCompleted={() => update({ showCompleted: !p.showCompleted })}
      active={active}
      onClearAll={clearAll}
      consumeEscape={consumeEscape}
    />
  )
}
