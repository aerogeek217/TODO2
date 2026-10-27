import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import {
  chipClauses, chipKey, heldFields, predicateLineItems, removeChip, wrapChipInOrGroup,
  type FilterChip, type LineItem,
} from '../../../utils/filter-chips'
import { withOrGroupClauses, withoutOrGroup } from '../../../utils/or-groups'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon } from '../icons'
import { ADD_FILTER_ITEMS, useChipNames } from './filter-menu'
import { PredicateFieldPicker, PredicateFieldPickerBody } from './PredicateFieldPicker'
import { pickerLabel } from './picker-label'
import { DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { pointBelow } from './popover-point'
import { useTooltip } from '../use-tooltip'
import menuStyles from '../MenuPopover.module.css'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

/** Which clauses an edit goes to: the predicate's own (`null`) or or group `n`'s. */
type Scope = number | null

/** A chip by what it filters: its field, and a date chip's date type. */
type ChipRef = Pick<FilterChip, 'field' | 'dateField'>

/**
 * One of the predicate's own chips shown moved into a new or group (at
 * `index`, after the others) that isn't written yet: the group's first edit
 * writes it; closing what is open without one puts the chip back.
 */
interface Wrap {
  chip: ChipRef
  index: number
}

/**
 * What is open: a field's picker (of the predicate's own clauses or of an
 * or group's), or an or group's panel (Add another · Remove group; with
 * `orAnother`, only the fields to add — a chip's "Or another filter").
 * With `at` it is a popover there (the list's filter line); without, it is
 * drawn in place under its row (the editors).
 */
type Open =
  | { kind: 'field'; scope: Scope; field: ListFilterField; dateField?: DateField; adding: boolean; wrap?: Wrap; at?: PopoverPoint }
  | { kind: 'group'; index: number; orAnother: boolean; wrap?: Wrap; at?: PopoverPoint }

/** A + Filter pick: that field's picker as a popover, adding to the predicate's own clauses. */
interface AddPicker {
  field: ListFilterField
  at: PopoverPoint
}

interface PredicateChipsProps {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  /** Rendered before the list chips (e.g. the screen filter chips). */
  before?: ReactNode
  /** The + Filter menu's heading. */
  addLabel?: string
  /** Inside a dialog: Esc closes an open field picker only, not the dialog. */
  inDialog?: boolean
  /** Fields + Filter doesn't offer (e.g. People in the check-in filter, which is per person). */
  omitFields?: readonly ListFilterField[]
  /**
   * `line` (default): one row — the list's filter line; a chip's picker and a
   * group's panel open as popovers. `stack`: the editors' Filters block — a
   * column, one chip or group per row, each expanding in place under itself.
   */
  layout?: 'line' | 'stack'
}

const FIELD_ITEMS = new Map(ADD_FILTER_ITEMS.map((item) => [item.field, item]))

/**
 * A list's own filter as chips — field name muted, then the value; one chip
 * per date type that filters; × removes it (a date chip only its type) —
 * and a "+ Filter" menu that adds one (priority, tags, people, dates,
 * status, text). Its or groups follow as plates, their chips joined with
 * "or" and every item with "and". A chip's picker ends with "Or another
 * filter", which makes the chip a group's first alternative and adds a
 * second; a group's panel adds another or removes the group.
 */
export function PredicateChips({
  predicate, onChange, before, addLabel = 'Add a filter to this list', inDialog = false, omitFields, layout = 'line',
}: PredicateChipsProps) {
  const stack = layout === 'stack'
  const names = useChipNames()
  const [open, setOpen] = useState<Open | null>(null)
  const [addPicker, setAddPicker] = useState<AddPicker | null>(null)
  const [menuAt, setMenuAt] = useState<PopoverPoint | null>(null)
  // A trigger clicked while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const menuWasOpen = useRef(false)
  const blockRef = useRef<HTMLDivElement>(null)
  // The rows to focus once an expansion closes from the keyboard: the first that is there.
  const focusAfter = useRef<string[] | null>(null)

  const wrap = open?.wrap
  const shown = useMemo(() => (wrap ? wrapChipInOrGroup(predicate, wrap.chip) ?? predicate : predicate), [predicate, wrap])
  const items = useMemo(() => predicateLineItems(shown, names), [shown, names])
  const groups = shown.orGroups ?? []
  const hasGroups = items.some((item) => item.kind === 'orGroup')

  useEffect(() => {
    const keys = focusAfter.current
    if (keys == null) return
    focusAfter.current = null
    for (const key of keys) {
      const row = blockRef.current?.querySelector<HTMLElement>(`[data-filter-row="${key}"]`)
      if (row) {
        row.focus()
        return
      }
    }
  })

  const offered = (field: ListFilterField) => !omitFields?.includes(field)
  /** The fields a group (or a new one starting with `clauses`) can still take. */
  const addable = (clauses: FilterClauses) => {
    const held = heldFields(clauses)
    return ADD_FILTER_ITEMS.filter((item) => offered(item.field) && !held.has(item.field))
  }
  const clausesOf = (scope: Scope): FilterClauses => (scope == null ? shown : groups[scope] ?? emptyFilterClauses())

  /** Writes `next`; an unwritten wrap is written with it; what is open closes when its group went. */
  const commit = (next: TodoPredicate) => {
    onChange(next)
    if (!open) return
    const index = open.kind === 'group' ? open.index : open.scope
    if (index != null && index >= (next.orGroups?.length ?? 0)) setOpen(null)
    // The chip a picker was adding is there now: it reads as any other chip's picker.
    else if (open.kind === 'field' && open.adding) setOpen({ ...open, adding: false, wrap: undefined })
    else if (open.wrap) setOpen({ ...open, wrap: undefined })
  }

  const rowKey = (scope: Scope, chip: ChipRef) => `${scope ?? 'root'}:${chipKey(chip as FilterChip)}`
  /** Closes what is open; from the keyboard, the focus goes back to its row. */
  const collapse = (refocus = true) => {
    if (open && refocus && !open.at) {
      if (open.wrap) focusAfter.current = [rowKey(null, open.wrap.chip)]
      else if (open.kind === 'group') focusAfter.current = [`group:${open.index}`]
      else {
        const chip = rowKey(open.scope, { field: open.field, dateField: open.dateField })
        focusAfter.current = open.scope == null ? [chip] : [chip, `group:${open.scope}`]
      }
    }
    setOpen(null)
  }

  const remove = (chip: FilterChip, scope: Scope) => {
    if (wrap) {
      // The wrap isn't written: the chip is still the predicate's own.
      setOpen(null)
      onChange(removeChip(predicate, chip, scope === wrap.index ? undefined : scope ?? undefined))
      return
    }
    if (isChipOpen(chip, scope)) setOpen(null)
    commit(removeChip(predicate, chip, scope ?? undefined))
  }

  function isChipOpen(chip: ChipRef, scope: Scope): boolean {
    if (open?.kind !== 'field' || open.scope !== scope || open.field !== chip.field) return false
    return chip.field !== 'dates' || open.dateField == null || open.dateField === chip.dateField
  }
  const isGroupOpen = (index: number) => open?.kind === 'group' && open.index === index

  const toggleChip = (chip: FilterChip, scope: Scope, el: Element) => {
    setAddPicker(null)
    if (stack && isChipOpen(chip, scope) && !open?.wrap) {
      setOpen(null)
      return
    }
    setOpen({
      kind: 'field', scope, field: chip.field as ListFilterField, dateField: chip.dateField, adding: false,
      ...(stack ? {} : { at: pointBelow(el) }),
    })
  }
  const toggleGroup = (index: number, el: Element) => {
    setAddPicker(null)
    if (stack && isGroupOpen(index)) {
      setOpen(null)
      return
    }
    setOpen({ kind: 'group', index, orAnother: false, ...(stack ? {} : { at: pointBelow(el) }) })
  }

  /** A chip's "Or another filter": the chip becomes a group's first alternative (or is one); its fields to add. */
  const orAnother = (o: Extract<Open, { kind: 'field' }>) => {
    if (o.scope != null) {
      setOpen({ kind: 'group', index: o.scope, orAnother: true, ...(o.at ? { at: o.at } : {}) })
      return
    }
    const chip = { field: o.field, dateField: o.dateField }
    setOpen({ kind: 'group', index: groups.length, orAnother: true, wrap: { chip, index: groups.length }, ...(o.at ? { at: o.at } : {}) })
  }
  /** Whether a field picker offers "Or another filter" (not while adding; a new group only below the cap). */
  const offersOrAnother = (o: Extract<Open, { kind: 'field' }>) => {
    if (o.adding) return false
    if (o.scope != null) return addable(clausesOf(o.scope)).length > 0
    const chip = { field: o.field, dateField: o.dateField }
    return wrapChipInOrGroup(shown, chip) != null && addable(chipClauses(shown, chip)).length > 0
  }

  const addToGroup = (o: Extract<Open, { kind: 'group' }>, field: ListFilterField) => {
    setOpen({ kind: 'field', scope: o.index, field, adding: true, ...(o.wrap ? { wrap: o.wrap } : {}), ...(o.at ? { at: o.at } : {}) })
  }

  const orAnotherRow = (o: Extract<Open, { kind: 'field' }>) => (offersOrAnother(o) ? (
    // The date panel has no padding of its own.
    <div className={`${styles.orAnotherRow} ${o.field === 'dates' ? styles.orAnotherRowInset : ''}`}>
      <button type="button" className={styles.orAnother} onClick={() => orAnother(o)}>
        <PlusIcon size={12} />
        <span className={styles.orAnotherLabel}>Or another filter</span>
        <ChevronRightIcon />
      </button>
    </div>
  ) : undefined)

  /** The body of what is open: a field's picker (+ Or another filter), or a group's panel. */
  const openBody = (o: Open): ReactNode => {
    if (o.kind === 'group') {
      return (
        <GroupPanel
          fields={addable(clausesOf(o.index))}
          count={groupChipCount(items, o.index)}
          orAnother={o.orAnother}
          onAdd={(field) => addToGroup(o, field)}
          onRemoveGroup={() => {
            setOpen(null)
            onChange(withoutOrGroup(predicate, o.index))
          }}
        />
      )
    }
    return (
      <>
        {fieldPicker(o)}
        {orAnotherRow(o)}
      </>
    )
  }

  /** A field's picker body: of the predicate's own clauses, or of an or group's. */
  const fieldPicker = (o: Extract<Open, { kind: 'field' }>) => {
    const scope = o.scope
    return scope == null ? (
      <PredicateFieldPickerBody
        field={o.field}
        predicate={shown}
        onChange={commit}
        adding={o.adding}
        dateField={o.dateField}
        onClose={() => collapse()}
      />
    ) : (
      <PredicateFieldPickerBody
        field={o.field}
        predicate={clausesOf(scope)}
        onChange={(c) => commit(withOrGroupClauses(shown, scope, () => c))}
        adding={o.adding}
        dateField={o.dateField}
        onClose={() => collapse()}
      />
    )
  }

  /** Esc in an expanded row closes it (not the editor around it). */
  const onBlockKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !open || open.at) return
    e.preventDefault()
    e.stopPropagation()
    collapse()
  }

  const inlineOpen = stack && open != null && !open.at ? open : null
  const expansion = (o: Open) => (
    <div
      className={`${styles.expansion} ${o.kind === 'field' && o.field === 'dates' ? styles.expansionDates : ''}`}
      role="group"
      aria-label={o.kind === 'group' ? 'Group' : pickerLabel(o.field)}
      data-testid="list-filter-expansion"
    >
      {openBody(o)}
    </div>
  )
  // An expanded chip of the predicate's own whose row went (its date type cleared): drawn after the rows.
  const rootOpenRow = inlineOpen?.kind === 'field' && inlineOpen.scope == null
    && items.some((item) => item.kind === 'chip' && isChipOpen(item.chip, null))

  const chipRow = (chip: FilterChip, scope: Scope) => (
    <ListChip
      key={chipKey(chip)}
      chip={chip}
      open={isChipOpen(chip, scope)}
      disclosure={stack}
      rowKey={rowKey(scope, chip)}
      onEdit={(el) => toggleChip(chip, scope, el)}
      onRemove={() => remove(chip, scope)}
    />
  )

  const renderItem = (item: LineItem): ReactNode => {
    if (item.kind === 'chip') {
      if (!stack) return chipRow(item.chip, null)
      return (
        <>
          <div className={styles.stackRow}>{chipRow(item.chip, null)}</div>
          {inlineOpen?.kind === 'field' && inlineOpen.scope == null && isChipOpen(item.chip, null) && expansion(inlineOpen)}
        </>
      )
    }
    const index = item.index
    const groupOpen = isGroupOpen(index)
    const plate = (
      <div
        className={styles.orGroup}
        role="group"
        aria-label="Group"
        data-testid="or-group"
        data-open={groupOpen ? '' : undefined}
        onClick={(e) => { if (e.target === e.currentTarget) toggleGroup(index, e.currentTarget) }}
      >
        {item.chips.map((chip, i) => {
          const or = i > 0 && (stack ? (
            <span className={styles.orWord} aria-hidden="true" onClick={(e) => toggleGroup(index, e.currentTarget)}>or</span>
          ) : (
            <button
              type="button"
              className={styles.orWord}
              aria-label="Group"
              aria-haspopup="dialog"
              aria-expanded={groupOpen}
              onClick={(e) => toggleGroup(index, e.currentTarget.parentElement ?? e.currentTarget)}
            >
              or
            </button>
          ))
          if (!stack || i < item.chips.length - 1) {
            return (
              <Fragment key={chipKey(chip)}>
                {or}
                {chipRow(chip, index)}
              </Fragment>
            )
          }
          // The group's chevron stays on the line of its last chip when the chips wrap.
          return (
            <span key={chipKey(chip)} className={styles.groupTail}>
              {or}
              {chipRow(chip, index)}
              <button
                type="button"
                className={`${styles.groupToggle} ${groupOpen ? styles.groupToggleOpen : ''}`}
                aria-label="Group"
                aria-expanded={groupOpen}
                data-filter-row={`group:${index}`}
                onClick={(e) => toggleGroup(index, e.currentTarget)}
              >
                <ChevronDownIcon />
              </button>
            </span>
          )
        })}
      </div>
    )
    if (!stack) return plate
    const groupExpansion = inlineOpen && (inlineOpen.kind === 'group' ? inlineOpen.index === index : inlineOpen.scope === index)
    return (
      <>
        <div className={styles.stackRow}>{plate}</div>
        {groupExpansion && expansion(inlineOpen)}
      </>
    )
  }

  const menuEntries: MenuEntry[] = [
    { kind: 'label', text: addLabel },
    ...ADD_FILTER_ITEMS.filter((item) => offered(item.field)).map((item): MenuEntry => ({
      kind: 'item',
      label: item.label,
      icon: item.icon,
      submenu: item.submenu,
      onSelect: () => {
        if (!menuAt) return
        setOpen(null)
        setAddPicker({ field: item.field, at: menuAt })
      },
    })),
  ]

  const addFilter = (
    <button
      type="button"
      className={`${styles.addFilter} ${menuAt ? styles.addFilterOpen : ''}`}
      aria-haspopup="menu"
      aria-expanded={menuAt != null}
      onMouseDown={() => { menuWasOpen.current = menuAt != null }}
      onClick={(e) => {
        if (menuWasOpen.current) {
          menuWasOpen.current = false
          return
        }
        setMenuAt(pointBelow(e.currentTarget, 'end'))
      }}
    >
      <PlusIcon size={12} /> Filter
    </button>
  )

  const lineItems = items.map((item, i) => (
    <Fragment key={item.kind === 'chip' ? chipKey(item.chip) : `group-${item.index}`}>
      {i > 0 && hasGroups && <span className={styles.andWord}>and</span>}
      {renderItem(item)}
    </Fragment>
  ))

  return (
    <>
      {stack ? (
        <div ref={blockRef} className={styles.stack} onKeyDown={onBlockKeyDown} data-testid="filter-stack">
          {before}
          {lineItems}
          {inlineOpen?.kind === 'field' && inlineOpen.scope == null && !rootOpenRow && expansion(inlineOpen)}
          <div className={styles.stackRow}>{addFilter}</div>
        </div>
      ) : (
        <>
          {before}
          {lineItems}
          {addFilter}
        </>
      )}
      {menuAt && (
        <MenuPopover
          point={menuAt}
          placement="bottom-end"
          width={220}
          label="Add a filter"
          entries={menuEntries}
          onClose={() => setMenuAt(null)}
        />
      )}
      {addPicker && (
        <PredicateFieldPicker
          key={`add-${addPicker.field}-${addPicker.at.x}-${addPicker.at.y}`}
          field={addPicker.field}
          predicate={predicate}
          onChange={onChange}
          at={addPicker.at}
          adding
          consumeEscape={inDialog}
          onClose={() => setAddPicker(null)}
        />
      )}
      {open?.at && (open.kind === 'field' ? (
        <FieldPopover
          key={`${open.scope ?? 'root'}-${open.field}-${open.dateField ?? ''}-${open.at.x}-${open.at.y}`}
          field={open.field}
          at={open.at}
          consumeEscape={inDialog}
          onClose={() => setOpen(null)}
        >
          {openBody(open)}
        </FieldPopover>
      ) : (
        <GroupPopover key={`group-${open.index}-${open.at.x}-${open.at.y}`} at={open.at} consumeEscape={inDialog} onClose={() => setOpen(null)}>
          {openBody(open)}
        </GroupPopover>
      ))}
    </>
  )
}

/**
 * An or group's panel: the fields it can still take (each opens its
 * picker, adding to the group) and Remove group — or, for a chip's "Or
 * another filter", the fields alone.
 */
function GroupPanel({ fields, count, orAnother, onAdd, onRemoveGroup }: {
  fields: ReadonlyArray<(typeof ADD_FILTER_ITEMS)[number]>
  count: number
  orAnother: boolean
  onAdd: (field: ListFilterField) => void
  onRemoveGroup: () => void
}) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])
  return (
    <div className={styles.groupPanel}>
      {fields.length > 0 && <div className={menuStyles.groupLabel}>{orAnother ? 'Or another filter' : 'Add another'}</div>}
      {fields.map((item, i) => (
        <button
          key={item.field}
          ref={i === 0 ? firstRef : undefined}
          type="button"
          className={menuStyles.item}
          onClick={() => onAdd(item.field)}
        >
          <span className={menuStyles.icon}>{FIELD_ITEMS.get(item.field)?.icon}</span>
          <span className={menuStyles.label}>{item.label}</span>
          {item.submenu && <span className={menuStyles.chevron}><ChevronRightIcon /></span>}
        </button>
      ))}
      {!orAnother && (
        <>
          {fields.length > 0 && <div className={menuStyles.separator} role="separator" />}
          <button
            ref={fields.length === 0 ? firstRef : undefined}
            type="button"
            className={`${menuStyles.item} ${menuStyles.danger}`}
            onClick={onRemoveGroup}
          >
            <span className={menuStyles.label}>Remove group</span>
            <span className={menuStyles.note}>with its {count} {count === 1 ? 'filter' : 'filters'}</span>
          </button>
        </>
      )}
    </div>
  )
}

/** How many chips or group `index` shows on the line. */
function groupChipCount(items: readonly LineItem[], index: number): number {
  for (const item of items) if (item.kind === 'orGroup' && item.index === index) return item.chips.length
  return 0
}

/** A popover at `at` for the list's filter line: a field's picker, or a group's panel. */
function FilterPopover({ at, consumeEscape, onClose, className, label, testId, children }: {
  at: PopoverPoint
  consumeEscape: boolean
  onClose: () => void
  className: string | undefined
  label: string
  testId: string
  children: ReactNode
}) {
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: at.x, y: at.y },
    open: true,
    placement: at.align === 'start' ? 'bottom-start' : 'bottom-end',
    closeOnScroll: false,
    consumeEscape,
    onClose,
  })
  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  )
}

/** A field's picker as a popover, with whatever ends it (the picker's own shell). */
function FieldPopover({ field, ...rest }: { field: ListFilterField; at: PopoverPoint; consumeEscape: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <FilterPopover
      {...rest}
      className={field === 'dates' ? DATE_FILTER_POPOVER_CLASS : `${picker.dropdownPanel} ${styles.pickerPanel}`}
      label={pickerLabel(field)}
      testId="list-filter-picker"
    />
  )
}

/** An or group's panel as a popover. */
function GroupPopover(props: { at: PopoverPoint; consumeEscape: boolean; onClose: () => void; children: ReactNode }) {
  return <FilterPopover {...props} className={`${picker.dropdownPanel} ${styles.groupPopover}`} label="Group" testId="or-group-panel" />
}

/**
 * One list filter chip: click (or Enter / Space) edits it, Delete /
 * Backspace or its × removes it. In the editors it is a disclosure: a
 * chevron at its end, and the click expands its picker under it. A chip
 * with several values or an "is not" spells itself out in a tooltip.
 */
function ListChip({ chip, open, disclosure, rowKey, onEdit, onRemove }: {
  chip: FilterChip
  open: boolean
  disclosure: boolean
  rowKey: string
  onEdit: (el: Element) => void
  onRemove: () => void
}) {
  const { triggerProps, tooltip } = useTooltip(open ? null : chip.tooltip, { labelLines: 1 })
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className={`${styles.listChip} ${open ? styles.listChipOpen : ''}`}
        data-testid="list-filter-chip"
        data-filter-row={rowKey}
        data-date-field={chip.dateField}
        data-negated={chip.negated ? '' : undefined}
        {...triggerProps}
        onClick={(e) => {
          e.stopPropagation()
          onEdit(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onEdit(e.currentTarget)
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            onRemove()
          }
        }}
      >
        <span className={styles.chipLabel}>{chip.label}</span>
        {chip.value}
        <button
          type="button"
          className={styles.chipRemove}
          aria-label="Remove filter"
          title="Remove filter"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <CloseIcon size={9} />
        </button>
        {disclosure && (
          <span className={`${styles.chipChevron} ${open ? styles.chipChevronOpen : ''}`} aria-hidden="true">
            <ChevronDownIcon />
          </span>
        )}
      </span>
      {tooltip}
    </>
  )
}
