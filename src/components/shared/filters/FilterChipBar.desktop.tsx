import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { attrSelector, FILTER_MENU_ATTR } from '../../../utils/dom-contract'
import { createPortal } from 'react-dom'
import { usePopoverAnchor, type PopoverCaret } from '../../../hooks/use-popover-anchor'
import { datesSpokenValue, datesTooltip, datesValue, filterChips, FILTER_FIELD_ORDER, type FilterChipField } from '../../../utils/filter-chips'
import { useChipDay } from './filter-menu'
import { entityPickerSelection } from '../../../utils/filter-negation'
import { NO_TAGS_LABEL } from '../../../utils/filter-labels'
import type { TodoPredicate } from '../../../models'
import picker from './FilterPicker.module.css'
import { ImportantIcon } from '../MarkerIcons'
import { hasMarkers, MARKERS_LABEL } from '../../../utils/markers'
import { peopleMenuEntries, useEntityMenuOffers } from '../person-menu-entries'
import {
  AtIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FunnelIcon,
  HashIcon,
  StatusRingIcon,
  WidgetKindIcon,
} from '../icons'
import { EntityDropdownItems, MarkerClausePicker, SelectionPanelBody, type FilterModeProps } from './FilterPanels'
import { DateFilterPanel } from './DateFilterPanel'
import { DatePendingNotContext, screenPendingNot } from './date-pending-not'
import { DATE_FILTER_DIALOG_LABEL, DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { useTooltip } from '../use-tooltip'
import { usePopoverFocus, useReturnFocus } from '../use-popover-focus'
import {
  FOLD_HIDDEN_ATTR,
  FOLD_HOLD_ATTR,
  FOLD_VALUE_ATTR,
  FOLD_VARIANT_ATTR,
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
 * not none) people — the person menu's items (`peopleMenuEntries`): for one
 * person `Review with <name>…`, `Email check-in to <name>` (the one-click
 * send, inside the click) and `Paste reply from <name>…`; for several
 * `Review N people’s tasks…` and `Email check-in to N people…` (the check-in
 * dialog with exactly those people ticked; it has its own Paste a reply…).
 * Review isn't offered while the deck is open. Else a hint.
 */
function PeopleCheckinAction({ people, onDone }: { people: readonly { id: number; name: string }[]; onDone: () => void }) {
  const { review } = useEntityMenuOffers()
  return (
    <>
      <div className={picker.dropdownDivider} />
      {people.length === 0 ? (
        <div className={styles.checkinHint}>Narrow to some people to review or email them.</div>
      ) : (
        peopleMenuEntries(people, { review, after: onDone }).map((item) => (
          <button
            key={item.label}
            type="button"
            className={styles.checkinAction}
            disabled={item.disabled}
            title={item.title}
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

/**
 * A screen-filter button: icon + label (the value while the filter is on),
 * then a chevron — or, while on, a round × that clears just this field.
 * `valueWidth` cuts the value to that width (ellipsis); the tooltip then
 * shows it whole (`People: Aisha Rahman`), unless the field has its own
 * tooltip, which already spells it out. `onOpenChange` tells the bar while
 * its picker is open (the bar keeps the chip while it is, even with its
 * value cleared from the picker); `onCleared` after its × cleared it.
 */
function FilterButton({ field, consumeEscape, valueWidth, onOpenChange, onCleared }: {
  field: FieldDef
  consumeEscape: boolean
  valueWidth?: number
  onOpenChange?: (open: boolean) => void
  onCleared?: () => void
}) {
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)
  useReturnFocus(open, mainRef)
  const { onOpen, onClose } = field
  const close = useCallback(() => {
    setOpen(false)
    onClose?.()
    onOpenChange?.(false)
  }, [onClose, onOpenChange])
  const { panelRef, style, caret } = usePopoverAnchor({ anchor: { kind: 'ref', ref: pillRef }, open, onClose: close, consumeEscape, caret: true })
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
      className={`${styles.filterButton} ${field.highlighted ? styles.filterButtonActive : ''} ${on ? styles.filterButtonOn : ''} ${open ? styles.filterButtonOpen : ''}`}
      {...(open ? { [FOLD_HOLD_ATTR]: '' } : {})}
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
          else { setOpen(true); onOpen?.(); onOpenChange?.(true) }
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
          onClick={() => { close(); field.onClear(); onCleared?.() }}
        >
          <CloseIcon size={8} />
        </button>
      )}
      {open && createPortal(
        <FieldPopover field={field} panelRef={panelRef} position={style} caret={caret}>
          <FieldPanelBody field={field} onDone={close} />
        </FieldPopover>,
        document.body,
      )}
    </div>
  )
}

/** A filter button's (or Filters menu row's) name: `People filter`, `Dates filter: Due in 14 days or earlier; Created …`. */
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
 * The top bar's Filter button (the funnel and `Filter`) and its menu: every
 * screen filter as a row — each opens that filter's picker beside the menu
 * — then Completed (a toggle) and, while any filter is on, Clear all
 * filters. `folded` = the set filters' chips are folded into it (the bar is
 * short of room): it then shows how many are on, in the accent. The menu
 * holds the keyboard as a popover does: its first row takes the focus on
 * opening, Tab wraps inside it, and the focus comes back to the button (from
 * a picker, to its row) when it closes. `measureOnly` = a copy laid out for
 * the top bar's measure (no shortcut target).
 */
function FilterMenu({ fields, folded, showCompleted, onToggleCompleted, active, onClearAll, consumeEscape, measureOnly }: {
  fields: FieldDef[]
  folded: boolean
  showCompleted: boolean
  onToggleCompleted: () => void
  /** Any screen filter on (Clear all filters shows). */
  active: boolean
  onClearAll: () => void
  consumeEscape: boolean
  measureOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState<{ key: FieldKey; x: number; y: number } | null>(null)
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
  const setMenuRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el
    menuPanelRef(el)
  }, [menuPanelRef])
  const onMenuKeyDown = usePopoverFocus({ open, panelRef: menuRef, triggerRef })

  const openSub = (field: FieldDef, button: HTMLButtonElement) => {
    if (sub?.key === field.key) { closeSub(); return }
    closeSub()
    subRowRef.current = button
    const rect = (button.parentElement ?? button).getBoundingClientRect()
    setSub({ key: field.key, x: rect.right + 4, y: rect.top - 4 })
    field.onOpen?.()
  }

  const badge = folded && count > 0
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.filterButton} ${styles.filterMain} ${styles.filtersTrigger} ${badge ? styles.filterButtonActive : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        {...(open ? { [FOLD_HOLD_ATTR]: '' } : {})}
        {...(measureOnly ? {} : { [FILTER_MENU_ATTR]: '' })}
        aria-label={count > 0 ? `Filter, ${count} active` : 'Filter'}
        onClick={() => (open ? closeAll() : setOpen(true))}
      >
        <span className={styles.icon}><FunnelIcon size={14} /></span>
        <span className={styles.filterLabel}>Filter</span>
        {badge && <span className={styles.countBadge}>{count}</span>}
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

interface FieldValues {
  /** The value text of each active field (tags without their `#`: the button shows a # glyph). */
  values: Partial<Record<FieldKey, string>>
  /** An "is not" field's tooltip: what it hides. */
  tooltips: Partial<Record<FieldKey, string>>
}

/** Each active field's value text (`not Waiting` for an "is not" one) and the "is not" tooltips. */
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
          // Every name loses its # (`home or garden`).
          values.tags = chip.value.replace(/(^not |^|, | or )#/g, '$1')
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
 * The top bar's screen filters: the one Filter button, whose menu holds
 * Priority, Tags, People, Dates and Status (each opening its picker), then
 * Completed and Clear all filters — and after it a chip for each filter that
 * is on (its button: value, ×, a click reopens its picker) and `Completed`
 * while Show completed is on. With `fold` the chips fold into the Filter
 * button (it shows their count). The pickers are the shared `FilterPanels`.
 * With `measureFold` both folds are laid out too, hidden and inert, at their
 * natural widths, for the top bar's measure; `valueWidths` cuts the shown
 * values. With `consumeEscape` (the top bar's filtered-tasks panel is open)
 * the Esc that closes a picker or the Filter menu stops there: the next one
 * closes the panel.
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
  // The chip whose picker is open (kept while it is open).
  const [openChip, setOpenChip] = useState<FieldKey | null>(null)
  // A chip that went with the focus in it (its × or its emptied picker
  // closing): the focus goes to the Filter button rather than nowhere.
  const focusMenuIfLost = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected) return
      document.querySelector<HTMLElement>(attrSelector(FILTER_MENU_ATTR))?.focus()
    })
  }, [])
  const chipOpenChange = useCallback((key: FieldKey, open: boolean) => {
    setOpenChip((cur) => (open ? key : cur === key ? null : cur))
    if (!open) focusMenuIfLost()
  }, [focusMenuIfLost])

  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p, people, statuses, sortedTags, allTagIds, personIdsSet, statusIdsSet, tagIdsSet,
    peopleActive, statusActive, tagsActive, dateActive, active, negated, update,
    setPersonIds, setStatusIds, setTags, setNegated, dropPendingMode, clearField, clearAll,
  } = s

  const names = useMemo(() => ({ people, tags: sortedTags, statuses }), [people, sortedTags, statuses])
  const { values, tooltips } = useFieldValues(p, names)
  const day = useChipDay()

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
            noneLabel={NO_TAGS_LABEL}
            entityMenu="tag"
            onShowTasks={closeAll}
          />
        ),
      },
    })
  }
  // A range's tooltip spells its exact days (from one date type on).
  const dateTooltip = datesTooltip(p.dates, day)
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
      // The top bar is flat: one condition. Picking keeps the picker open.
      render: () => <MarkerClausePicker clause={p.markers?.[0] ?? null} onChange={(c) => update({ markers: c ? [c] : null })} />,
    },
  })
  // The menu's rows and the chips in display order (Priority, Tags, People, Dates, Status).
  fields.sort((a, b) => FILTER_FIELD_ORDER.indexOf(a.key) - FILTER_FIELD_ORDER.indexOf(b.key))

  const toggleCompleted = () => update({ showCompleted: !p.showCompleted })
  // The Filter button, then (unfolded) a chip per filter that is on — and
  // the chip whose picker is open, though the picker emptied it, so the
  // picker isn't pulled away mid-edit. The button keeps its key in both
  // folds, so a fold change keeps its menu.
  const shownChips = fields.filter((field) => field.value != null || field.key === openChip)
  const variant = (folded: boolean, widths?: FilterChipBarProps['valueWidths'], measureOnly = false) => [
    <FilterMenu
      key="menu"
      fields={fields}
      folded={folded}
      showCompleted={p.showCompleted}
      onToggleCompleted={toggleCompleted}
      active={active}
      onClearAll={clearAll}
      consumeEscape={consumeEscape}
      measureOnly={measureOnly}
    />,
    ...(folded ? [] : [
      ...(measureOnly ? fields.filter((field) => field.value != null) : shownChips).map((field) => (
        <FilterButton
          key={field.key}
          field={field}
          consumeEscape={consumeEscape}
          valueWidth={widths?.[field.key]}
          onOpenChange={measureOnly ? undefined : (open) => chipOpenChange(field.key, open)}
          onCleared={measureOnly ? undefined : focusMenuIfLost}
        />
      )),
      ...(p.showCompleted ? [<CompletedChip key="completed" onHide={() => { toggleCompleted(); if (!measureOnly) focusMenuIfLost() }} />] : []),
    ]),
  ]

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
          {variant(folded, undefined, true)}
        </span>
      ))}
    </>
  )
}

/**
 * Show completed as a set filter's chip in the bar (while it is on): `✓
 * Completed ×`; a click anywhere on it hides the completed tasks again (it
 * has no picker). It stays the `Show completed` toggle, pressed.
 */
function CompletedChip({ onHide }: { onHide: () => void }) {
  const { triggerProps, tooltip } = useTooltip('Completed tasks are shown · click to hide them')
  return (
    <div className={`${styles.filterButton} ${styles.filterButtonActive} ${styles.filterButtonOn}`}>
      <button
        type="button"
        className={`${styles.filterMain} ${styles.completedChip}`}
        aria-pressed="true"
        aria-label="Show completed"
        onClick={onHide}
        {...triggerProps}
      >
        <span className={styles.icon}><CheckIcon size={12} /></span>
        <span className={styles.filterLabel}>Completed</span>
        <span className={styles.chipCross} aria-hidden="true"><CloseIcon size={8} /></span>
      </button>
      {tooltip}
    </div>
  )
}
