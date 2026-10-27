import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import {
  chipClauses, chipKey, heldFields, predicateLineItems, removeChip, wrapChipInOrGroup,
  type FilterChip, type LineItem,
} from '../../../utils/filter-chips'
import { hasFilterClause, withOrGroupClauses, withoutOrGroup } from '../../../utils/or-groups'
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
import { PopoverRoot } from '../PopoverRoot'

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
 * What is open, as a popover at `at` (under its chip or group): a field's
 * picker (of the predicate's own clauses or of an or group's), or an or
 * group's panel (Another filter (OR) · Remove group; with `orAnother`, only
 * the fields to add — a chip's "Another filter (OR)"). `held`: the clauses
 * of or group `scope` as an edit in this picker left them — with no clause,
 * so the write left the group out — shown at `scope` (not written) so the
 * picker stays on it: the next edit that gives it a clause writes it back
 * there; closing leaves it out.
 */
type Open =
  | { kind: 'field'; scope: Scope; field: ListFilterField; dateField?: DateField; adding: boolean; wrap?: Wrap; held?: FilterClauses; at: PopoverPoint }
  | { kind: 'group'; index: number; orAnother: boolean; wrap?: Wrap; at: PopoverPoint }

/** A row's key in the rows' order: a chip's `chipKey`, a group's `group:<index>`. */
const groupKey = (index: number) => `group:${index}`
const itemKey = (item: LineItem) => (item.kind === 'chip' ? chipKey(item.chip) : groupKey(item.index))
const refKey = (chip: ChipRef) => chipKey(chip as FilterChip)
/** The order without or group `index`'s key, the later groups' keys moved down. */
function withoutGroupKey(order: readonly string[], index: number): string[] {
  return order.flatMap((k) => {
    if (!k.startsWith('group:')) return [k]
    const n = Number(k.slice('group:'.length))
    if (n === index) return []
    return [n > index ? groupKey(n - 1) : k]
  })
}

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
   * `line` (default): one row — the list's filter line. `stack`: the
   * editors' Filters block — a column, one chip or group per row, "and" on
   * its own row. In both a chip's picker and a group's panel open as
   * popovers under their row.
   */
  layout?: 'line' | 'stack'
}

const FIELD_ITEMS = new Map(ADD_FILTER_ITEMS.map((item) => [item.field, item]))

/**
 * A list's own filter as chips — field name muted, then the value; one chip
 * per date type that filters; × removes it (a date chip only its type) —
 * and a "+ Filter" menu that adds one (priority, tags, people, dates,
 * status, text). Its or groups follow as plates, their chips joined with
 * "or" and every item with "and". A chip's picker ends with "Another filter
 * (OR)", which makes the chip a group's first alternative and adds a
 * second; a group's panel adds another or removes the group. The rows keep
 * the order they were added in: a new chip goes last, a group takes the
 * place of the chip it was made from.
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
  // A chip or group pressed while its popover is open: the press closed it
  // (the popover's outside-click handler), so the click folds instead of reopening.
  const pressedOpen = useRef(false)

  const wrap = open?.wrap
  const held = open?.kind === 'field' && open.scope != null && open.held ? { index: open.scope, clauses: open.held } : null
  const heldIndex = held?.index
  const heldClauses = held?.clauses
  const shown = useMemo(() => {
    const p = wrap ? wrapChipInOrGroup(predicate, wrap.chip) ?? predicate : predicate
    if (heldIndex == null || heldClauses == null) return p
    const orGroups = [...(p.orGroups ?? [])]
    orGroups.splice(heldIndex, 0, heldClauses)
    return { ...p, orGroups }
  }, [predicate, wrap, heldIndex, heldClauses])
  const items = useMemo(() => predicateLineItems(shown, names), [shown, names])
  const groups = shown.orGroups ?? []
  const hasGroups = items.some((item) => item.kind === 'orGroup')
  // The rows in the order they were added (the stored order at mount): a
  // row keeps its place, a new one goes last (its key joins the order once
  // it shows). A chip shown wrapped in a new group (not written yet) keeps
  // its place as the group's (`alias`); once written, the group takes it. A
  // removed chip's key goes, so the chip added again goes last; a removed
  // group's key goes and the later groups' keys move down.
  const [order, setOrder] = useState<string[]>(() => items.map(itemKey))
  // (The keys spelled here, not through `refKey`: the compiler reads a call
  // on `wrap` as a possible mutation and stops memoizing `shown`.)
  const wrapFrom = wrap ? (wrap.chip.dateField ? `${wrap.chip.field}:${wrap.chip.dateField}` : wrap.chip.field) : null
  const wrapTo = wrap ? `group:${wrap.index}` : null
  const rows = useMemo((): LineItem[] => {
    const position = (k: string) => {
      const i = order.indexOf(k === wrapTo && wrapFrom != null ? wrapFrom : k)
      // A row not in the order (the predicate replaced from outside): after the others, in the stored order.
      return i < 0 ? order.length : i
    }
    return [...items].sort((a, b) => position(itemKey(a)) - position(itemKey(b)))
  }, [items, order, wrapFrom, wrapTo])
  /** Every write: the rows `next` adds join the order last. */
  const write = (next: TodoPredicate) => {
    const added = predicateLineItems(next, names).map(itemKey)
    setOrder((o) => [...o, ...added.filter((k) => !o.includes(k))])
    onChange(next)
  }
  /** Or group `index` is going: its key goes from the order, the later groups' keys move down. */
  const dropGroupKey = (index: number) => setOrder((o) => withoutGroupKey(o, index))
  /** A chip of the predicate's own is going: its key goes, so the chip added again goes last. */
  const dropChipKey = (chip: ChipRef) => setOrder((o) => o.filter((k) => k !== refKey(chip)))
  /** The wrap is written: its group takes the chip's place. */
  const wrapWritten = (from: string, to: string) => setOrder((o) => o.map((k) => (k === from ? to : k)))

  const offered = (field: ListFilterField) => !omitFields?.includes(field)
  /** The fields a group (or a new one starting with `clauses`) can still take. */
  const addable = (clauses: FilterClauses) => {
    const held = heldFields(clauses)
    return ADD_FILTER_ITEMS.filter((item) => offered(item.field) && !held.has(item.field))
  }
  const clausesOf = (scope: Scope): FilterClauses => (scope == null ? shown : groups[scope] ?? emptyFilterClauses())

  /**
   * Writes `next` (made from `shown`); an unwritten wrap is written with
   * it. `edited`: the or group the edit went to, and — from that group's
   * own picker — its clauses as edited. When that group went (no clause
   * left), its picker stays on it (`held`), a panel open on it closes, and
   * what is open on a later group follows that group down.
   */
  const commit = (next: TodoPredicate, edited?: { index: number; clauses?: FilterClauses }) => {
    if (open?.wrap && wrapFrom != null && wrapTo != null) wrapWritten(wrapFrom, wrapTo)
    write(next)
    const index = open == null ? null : open.kind === 'group' ? open.index : open.scope
    const dropped = edited != null && (next.orGroups?.length ?? 0) < groups.length
    // The group is kept (held) in its place only by its own picker.
    const holds = dropped && open?.kind === 'field' && index === edited.index && edited.clauses != null
    if (dropped && !holds) dropGroupKey(edited.index)
    if (!open) return
    if (dropped && index != null && index > edited.index) {
      setOpen(open.kind === 'group' ? { ...open, index: index - 1 } : { ...open, scope: index - 1 })
    } else if (dropped && index === edited.index) {
      setOpen(open.kind === 'field' && edited.clauses ? { ...open, adding: false, wrap: undefined, held: edited.clauses } : null)
    } else if (index != null && index >= (next.orGroups?.length ?? 0)) {
      setOpen(null)
    } else if (open.kind === 'field' && (open.adding || open.held)) {
      // The chip a picker was adding (or a held group) is there now: it reads as any other chip's picker.
      setOpen({ ...open, adding: false, wrap: undefined, held: undefined })
    } else if (open.wrap) setOpen({ ...open, wrap: undefined })
  }

  const rowKey = (scope: Scope, chip: ChipRef) => `${scope ?? 'root'}:${refKey(chip)}`
  /** Closes what is open; a held group is then left out, the later groups moving down. */
  const close = () => {
    if (heldIndex != null) dropGroupKey(heldIndex)
    setOpen(null)
  }

  const remove = (chip: FilterChip, scope: Scope) => {
    if (wrap) {
      // The wrap isn't written: the chip is still the predicate's own.
      setOpen(null)
      const own = scope === wrap.index || scope == null
      if (own) dropChipKey(chip)
      write(removeChip(predicate, chip, own ? undefined : scope))
      return
    }
    if (held) {
      // `scope` counts the held group, which isn't written (the write leaves it out).
      close()
      if (scope == null) dropChipKey(chip)
      write(removeChip(shown, chip, scope ?? undefined))
      return
    }
    if (isChipOpen(chip, scope)) setOpen(null)
    if (scope == null) dropChipKey(chip)
    commit(removeChip(predicate, chip, scope ?? undefined), scope == null ? undefined : { index: scope })
  }

  function isChipOpen(chip: ChipRef, scope: Scope): boolean {
    if (open?.kind !== 'field' || open.scope !== scope || open.field !== chip.field) return false
    return chip.field !== 'dates' || open.dateField == null || open.dateField === chip.dateField
  }
  const isGroupOpen = (index: number) => open?.kind === 'group' && open.index === index

  /** Whether a press is on what is open (a mousedown: the popover closes on it, the click then folds). */
  const press = (isOpen: boolean) => { pressedOpen.current = isOpen }
  /** Whether this click came from a press that already closed what it is on. */
  const pressedClosed = () => {
    const was = pressedOpen.current
    pressedOpen.current = false
    return was
  }
  /** The group plate a control sits in, for the popover's point. */
  const plateOf = (el: Element) => el.closest('[data-testid="or-group"]') ?? el

  const toggleChip = (chip: FilterChip, scope: Scope, el: Element) => {
    setAddPicker(null)
    // A second click folds it (a wrap not written yet: the chip back on its own).
    if (pressedClosed()) return
    if (isChipOpen(chip, scope)) {
      close()
      return
    }
    // The wrapped chip in its new group (not written yet): its picker edits that group, the first edit writes the wrap.
    const keepWrap = wrap && scope === wrap.index ? { wrap } : {}
    setOpen({ kind: 'field', scope, field: chip.field as ListFilterField, dateField: chip.dateField, adding: false, ...keepWrap, at: pointBelow(el) })
  }
  const toggleGroup = (index: number, el: Element) => {
    setAddPicker(null)
    if (pressedClosed()) return
    if (isGroupOpen(index)) {
      close()
      return
    }
    setOpen({ kind: 'group', index, orAnother: false, at: pointBelow(plateOf(el)) })
  }

  /** A chip's "Another filter (OR)": the chip becomes a group's first alternative (or is one); its fields to add. */
  const orAnother = (o: Extract<Open, { kind: 'field' }>) => {
    if (o.scope != null) {
      setOpen({ kind: 'group', index: o.scope, orAnother: true, at: o.at })
      return
    }
    const chip = { field: o.field, dateField: o.dateField }
    setOpen({ kind: 'group', index: groups.length, orAnother: true, wrap: { chip, index: groups.length }, at: o.at })
  }
  /**
   * Whether a field picker offers "Another filter (OR)": not while adding, not
   * while what it edits filters nothing (a held group, a chip of the
   * predicate's own emptied in its picker — there is no chip to be an
   * alternative to), a new group only below the cap.
   */
  const offersOrAnother = (o: Extract<Open, { kind: 'field' }>) => {
    if (o.adding || o.held) return false
    if (o.scope != null) return addable(clausesOf(o.scope)).length > 0
    const chip = { field: o.field, dateField: o.dateField }
    const own = chipClauses(shown, chip)
    return hasFilterClause(own) && wrapChipInOrGroup(shown, chip) != null && addable(own).length > 0
  }

  const addToGroup = (o: Extract<Open, { kind: 'group' }>, field: ListFilterField) => {
    setOpen({ kind: 'field', scope: o.index, field, adding: true, ...(o.wrap ? { wrap: o.wrap } : {}), at: o.at })
  }

  const orAnotherRow = (o: Extract<Open, { kind: 'field' }>) => (offersOrAnother(o) ? (
    // The date panel has no padding of its own.
    <div className={`${styles.orAnotherRow} ${o.field === 'dates' ? styles.orAnotherRowInset : ''}`}>
      <button type="button" className={styles.orAnother} onClick={() => orAnother(o)}>
        <PlusIcon size={12} />
        <span className={styles.orAnotherLabel}>Another filter (OR)</span>
        <ChevronRightIcon />
      </button>
    </div>
  ) : undefined)

  /** The body of what is open: a field's picker (+ Another filter (OR)), or a group's panel. */
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
            dropGroupKey(o.index)
            write(withoutOrGroup(predicate, o.index))
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
        onClose={close}
      />
    ) : (
      <PredicateFieldPickerBody
        field={o.field}
        predicate={clausesOf(scope)}
        onChange={(c) => commit(withOrGroupClauses(shown, scope, () => c), { index: scope, clauses: c })}
        adding={o.adding}
        dateField={o.dateField}
        onClose={close}
      />
    )
  }

  const chipRow = (chip: FilterChip, scope: Scope) => (
    <ListChip
      key={chipKey(chip)}
      chip={chip}
      open={isChipOpen(chip, scope)}
      disclosure={stack}
      rowKey={rowKey(scope, chip)}
      onPress={() => press(isChipOpen(chip, scope))}
      onEdit={(el) => toggleChip(chip, scope, el)}
      onRemove={() => remove(chip, scope)}
    />
  )

  const renderItem = (item: LineItem): ReactNode => {
    if (item.kind === 'chip') {
      return stack ? <div className={styles.stackRow}>{chipRow(item.chip, null)}</div> : chipRow(item.chip, null)
    }
    const index = item.index
    if (item.chips.length === 0) return null
    const groupOpen = isGroupOpen(index)
    const plate = (
      <div
        className={styles.orGroup}
        role="group"
        aria-label="Group"
        data-testid="or-group"
        data-open={groupOpen ? '' : undefined}
        onMouseDown={(e) => { if (e.target === e.currentTarget) press(groupOpen) }}
        onClick={(e) => { if (e.target === e.currentTarget) toggleGroup(index, e.currentTarget) }}
      >
        {item.chips.map((chip, i) => {
          const or = i > 0 && (stack ? (
            <span className={styles.orWord} aria-hidden="true" onMouseDown={() => press(groupOpen)} onClick={(e) => toggleGroup(index, e.currentTarget)}>or</span>
          ) : (
            <button
              type="button"
              className={styles.orWord}
              aria-label="Group"
              aria-haspopup="dialog"
              aria-expanded={groupOpen}
              onMouseDown={() => press(groupOpen)}
              onClick={(e) => toggleGroup(index, e.currentTarget)}
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
                onMouseDown={() => press(groupOpen)}
                onClick={(e) => toggleGroup(index, e.currentTarget)}
              >
                <ChevronDownIcon />
              </button>
            </span>
          )
        })}
      </div>
    )
    return stack ? <div className={styles.stackRow}>{plate}</div> : plate
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
      <PlusIcon size={12} /> {stack && items.length > 0 ? 'Another filter (AND)' : 'Filter'}
    </button>
  )

  const lineItems = rows.map((item, i) => (
    <Fragment key={item.kind === 'chip' ? chipKey(item.chip) : `group-${item.index}`}>
      {i > 0 && hasGroups && (item.kind === 'chip' || item.chips.length > 0) && <span className={styles.andWord}>and</span>}
      {renderItem(item)}
    </Fragment>
  ))

  return (
    <>
      {stack ? (
        <div className={styles.stack} data-testid="filter-stack">
          {before}
          {lineItems}
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
          onChange={write}
          at={addPicker.at}
          adding
          consumeEscape={inDialog}
          onClose={() => setAddPicker(null)}
        />
      )}
      {open && (open.kind === 'field' ? (
        <FieldPopover
          key={`${open.scope ?? 'root'}-${open.field}-${open.dateField ?? ''}-${open.at.x}-${open.at.y}`}
          field={open.field}
          at={open.at}
          consumeEscape={inDialog}
          onClose={close}
        >
          {openBody(open)}
        </FieldPopover>
      ) : (
        <GroupPopover key={`group-${open.index}-${open.at.x}-${open.at.y}`} at={open.at} consumeEscape={inDialog} onClose={close}>
          {openBody(open)}
        </GroupPopover>
      ))}
    </>
  )
}

/**
 * An or group's panel: the fields it can still take (each opens its
 * picker, adding to the group) and Remove group — or, for a chip's "Another
 * filter (OR)", the fields alone.
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
      {fields.length > 0 && <div className={menuStyles.groupLabel}>Another filter (OR)</div>}
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
    <PopoverRoot
      ref={panelRef}
      className={className}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </PopoverRoot>,
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
 * One list filter chip: click (or Enter / Space) opens its picker under it
 * (a second click closes it), Delete / Backspace or its × removes it. In
 * the editors it is a disclosure: a chevron at its end. A chip with several
 * values or an "is not" spells itself out in a tooltip.
 */
function ListChip({ chip, open, disclosure, rowKey, onPress, onEdit, onRemove }: {
  chip: FilterChip
  open: boolean
  disclosure: boolean
  rowKey: string
  onPress: () => void
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
        onMouseDown={(e) => { if (!(e.target instanceof Element && e.target.closest('button'))) onPress() }}
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
