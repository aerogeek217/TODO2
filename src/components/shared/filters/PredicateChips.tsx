import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EXPRESSION_TEXT_MAX, type TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { createPendingNotMemory, DatePendingNotContext } from './date-pending-not'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import {
  chipKey, expressionText, isGraphicalItem, predicateLineItems, removeChip,
  type FilterChip, type GraphicalLineItem,
} from '../../../utils/filter-chips'
import { freeDateField, offeredDateFields } from '../../../utils/date-filters'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { rowOrderOf, sortedRows, withoutChipRow, withoutPriorityRow, withRowsAdded, type ChipRef, type RowOrder } from '../../../utils/filter-row-order'
import { asExpression, asGraphical, withExpression } from '../../../utils/predicate-expression'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { InfoIcon, PlusIcon } from '../icons'
import { useTooltip } from '../use-tooltip'
import { ExpressionField } from './ExpressionField'
import { ExpressionWords } from './ExpressionWords'
import { ADD_FILTER_ITEMS, useChipNames } from './filter-menu'
import { PredicateFieldPicker, PredicateFieldPickerBody } from './PredicateFieldPicker'
import type { DateFilterHost } from './DateFilterPanel'
import { pointBelow } from './popover-point'
import { ListFilterChip } from './ListFilterChip'
import styles from './ListFilterChips.module.css'
import { FieldPopover } from './PredicateChipsPopovers'

/** What is open: a chip's picker, as a popover at `at` under its chip. `adding`: opened by + Filter on a chip not there yet. */
interface Open {
  field: ListFilterField
  dateField?: DateField
  markerIndex?: number
  adding: boolean
  at: PopoverPoint
}

/**
 * A + Filter pick: that field's picker as a popover (Dates: on the first
 * date type not filtering yet, so it adds a chip; every type filtering, the
 * panel's default. Priority: a new condition, so another chip — Priority
 * repeats, its chips ANDed).
 */
interface AddPicker {
  field: ListFilterField
  dateField?: DateField
  markerIndex?: number
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
   * The date panel's host options: date types left out (the check-in's
   * Completed).
   */
  dateHost?: DateFilterHost
  /**
   * `line` (default): one row — the list's filter line. `stack`: the
   * editors' Filters block — a column, one chip per row, under the
   * Graphical | Expression switch. In both a chip's picker opens as a
   * popover under its row.
   */
  layout?: 'line' | 'stack'
  /**
   * The line layout, for a filter written as an expression (read back in
   * words, `ExpressionWords`): opens where it is edited (Edit list). Absent:
   * the line only shows it.
   */
  onOpenExpression?: () => void
  /**
   * `false`: an expression's `done` is refused (an error line), for the
   * filters that never show completed tasks by it — a lens, the
   * check-in — which would drop it silently (cr33 F9).
   */
  allowDone?: boolean
}

/**
 * A filter, Graphical or an expression. Graphical (`GraphicalChips`): a
 * chip per field — field name muted, then the value; one chip per date type
 * that filters, one per Priority condition; × removes it — every chip
 * ANDed, and a "+ Filter" menu that adds one. In the editors' stacked layout a Graphical | Expression switch
 * sits above it: Expression turns the chips into the expression that
 * filters the same (`ExpressionField` edits it); Graphical turns an
 * expression back into chips when every top-level term is one, else offers
 * Edit expression or Clear and use Graphical. On the list's filter line an
 * expression is read back in words (`ExpressionWords`; its exact text in the
 * tooltip).
 */
export function PredicateChips(props: PredicateChipsProps) {
  const { predicate, onChange, before, layout = 'line', omitFields, onOpenExpression } = props
  const isExpression = predicate.expression != null
  const [mode, setMode] = useState<FilterMode>(isExpression ? 'expression' : 'graphical')
  // A filter that became an expression elsewhere (undo, a reload) shows as
  // one; one that became chips elsewhere (Revert, undo) shows them. Emptied,
  // it stays where it is: clearing the field leaves Expression open.
  const [seenExpression, setSeenExpression] = useState(isExpression)
  if (isExpression !== seenExpression) {
    setSeenExpression(isExpression)
    if (isExpression) setMode('expression')
    else if (hasFilterClause(predicate)) setMode('graphical')
  }
  const names = useChipNames()
  const text = useMemo(() => expressionText(predicate, names), [predicate, names])
  // Edit expression / Clear and use Graphical replace the block their button is
  // in: the focus goes to the field / + Filter, never <body>, where Esc would
  // close the editor (cr33 U6).
  const [focusNext, setFocusNext] = useState<'field' | 'add' | null>(null)
  /** Why the switch to Expression was refused (until the filter or the mode changes). */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [refusedFor, setRefusedFor] = useState(predicate)
  if (refusedFor !== predicate) {
    setRefusedFor(predicate)
    setRefusal(null)
  }

  if (layout !== 'stack') {
    if (!predicate.expression) return <GraphicalChips {...props} />
    return (
      <>
        {before}
        <ExpressionWords expression={predicate.expression} text={text} onOpen={onOpenExpression} />
      </>
    )
  }

  const toGraphical = () => {
    setRefusal(null)
    setFocusNext(null)
    setMode('graphical')
    const graphical = asGraphical(predicate)
    if (graphical && graphical !== predicate) onChange(graphical)
  }
  /** `byArrow`: the switch's arrow keys, which keep the focus on the switch. */
  const toExpression = (byArrow = false) => {
    if (!isExpression) {
      const next = asExpression(predicate)
      // Past the caps no expression reads back: stay Graphical, saying why.
      if (!next || expressionText(next, names).length > EXPRESSION_TEXT_MAX) {
        setRefusal(SWITCH_REFUSED)
        return
      }
      if (next.expression) onChange(next)
    }
    setRefusal(null)
    // A click on Expression goes on into the field.
    setFocusNext(byArrow ? null : 'field')
    setMode('expression')
  }
  const allowPeople = !(omitFields ?? []).includes('people')
  // A host without the Completed date (the check-in) refuses it in an expression too.
  const allowCompleted = !(props.dateHost?.omit ?? []).includes('completed')
  let body: ReactNode
  if (mode === 'expression') {
    body = (
      <ExpressionField
        predicate={predicate}
        onChange={onChange}
        allowPeople={allowPeople}
        allowCompleted={allowCompleted}
        allowDone={props.allowDone ?? true}
        autoFocus={focusNext === 'field'}
      />
    )
  } else if (isExpression) {
    // Graphical over an expression no chips say.
    body = (
      <div className={styles.expressionLocked} data-testid="expression-locked">
        <span className={styles.expressionLockedTitle}>This filter is an expression</span>
        <span className={styles.expressionLockedText} title={text}>{text}</span>
        <div className={styles.expressionLockedButtons}>
          <button
            type="button"
            className={styles.expressionPrimary}
            onClick={() => {
              setFocusNext('field')
              setMode('expression')
            }}
          >
            Edit expression
          </button>
          <button
            type="button"
            className={styles.expressionSecondary}
            onClick={() => {
              setFocusNext('add')
              onChange(withExpression(predicate, null))
            }}
          >
            Clear and use Graphical
          </button>
        </div>
      </div>
    )
  } else {
    body = <GraphicalChips {...props} autoFocusAdd={focusNext === 'add'} />
  }
  return (
    <div className={styles.modeBlock}>
      <FilterModeSwitch mode={mode} onGraphical={toGraphical} onExpression={toExpression} refusal={refusal} />
      {body}
    </div>
  )
}

type FilterMode = 'graphical' | 'expression'

/** The switch to Expression refused: the filter is past what an expression holds (`EXPRESSION_NODES_MAX` / `EXPRESSION_TEXT_MAX`). */
export const SWITCH_REFUSED = 'Too many values to write as an expression — it stays Graphical'

const MODE_HELP = 'Graphical: a chip per field; every chip must match\nSeveral values in a chip: any of them\nExpression: or / not across fields, nested groups'

/** Graphical | Expression, with what each is in a tooltip. */
function FilterModeSwitch({ mode, onGraphical, onExpression, refusal }: {
  mode: FilterMode
  onGraphical: () => void
  onExpression: (byArrow?: boolean) => void
  /** Why the switch to Expression was refused; announced (the region is always there). */
  refusal: string | null
}) {
  const help = useTooltip(MODE_HELP)
  // A radio group: one tab stop (the checked radio), the arrows move the
  // choice and the focus with it (cr33 U9).
  const graphicalRef = useRef<HTMLButtonElement>(null)
  const expressionRef = useRef<HTMLButtonElement>(null)
  const focusChecked = useRef(false)
  useLayoutEffect(() => {
    if (!focusChecked.current) return
    focusChecked.current = false
    ;(mode === 'graphical' ? graphicalRef : expressionRef).current?.focus()
  })
  const onKeyDown = (e: React.KeyboardEvent) => {
    const to: FilterMode | null = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home' ? 'graphical'
      : e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'End' ? 'expression' : null
    if (!to) return
    e.preventDefault()
    // Two radios: an arrow past the end comes round to the other.
    const next = e.key === 'Home' || e.key === 'End' ? to : mode === 'graphical' ? 'expression' : 'graphical'
    focusChecked.current = true
    if (next === mode) (mode === 'graphical' ? graphicalRef : expressionRef).current?.focus()
    else if (next === 'graphical') onGraphical()
    else onExpression(true)
  }
  return (
    <div className={styles.modeRow}>
      <div className={styles.modeSwitch} role="radiogroup" aria-label="Filter mode" onKeyDown={onKeyDown}>
        <button
          ref={graphicalRef}
          type="button"
          role="radio"
          aria-checked={mode === 'graphical'}
          tabIndex={mode === 'graphical' ? 0 : -1}
          className={mode === 'graphical' ? styles.modeOn : styles.mode}
          onClick={onGraphical}
        >
          Graphical
        </button>
        <button
          ref={expressionRef}
          type="button"
          role="radio"
          aria-checked={mode === 'expression'}
          tabIndex={mode === 'expression' ? 0 : -1}
          className={mode === 'expression' ? styles.modeOn : styles.mode}
          onClick={() => onExpression()}
        >
          Expression
        </button>
      </div>
      <button type="button" className={styles.modeHelp} aria-label="About filter modes" {...help.triggerProps}>
        <InfoIcon size={14} />
      </button>
      {help.tooltip}
      <span className={styles.modeRefusal} role="alert">{refusal}</span>
    </div>
  )
}

/**
 * The Graphical filter (`PredicateChips` in Graphical mode, and the line
 * layout): its chips in the order they were added (a new one goes last), +
 * Filter, and the open chip's picker.
 */
function GraphicalChips({
  predicate, onChange, before, addLabel = 'Add a filter to this list', inDialog = false, omitFields, dateHost, layout = 'line', autoFocusAdd = false,
}: PredicateChipsProps & { autoFocusAdd?: boolean }) {
  const stack = layout === 'stack'
  // Outlives the date panel: an Is not chosen before a range has an end stays chosen.
  const [pendingNot] = useState(createPendingNotMemory)
  const names = useChipNames()
  const [open, setOpen] = useState<Open | null>(null)
  const [addPicker, setAddPicker] = useState<AddPicker | null>(null)
  const [menuAt, setMenuAt] = useState<PopoverPoint | null>(null)
  // A trigger clicked while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const menuWasOpen = useRef(false)
  // A chip pressed while its popover is open: the press closed it (the
  // popover's outside-click handler), so the click folds instead of reopening.
  const pressedOpen = useRef(false)

  const items = useMemo(() => predicateLineItems(predicate, names).filter(isGraphicalItem), [predicate, names])
  // The chips in the order they were added (`utils/filter-row-order`; the stored order at mount).
  const [order, setOrder] = useState<RowOrder>(() => rowOrderOf(items))
  const rows = useMemo(() => sortedRows(items, order), [items, order])
  // A chip that goes (× / Delete) takes the focus with it: the chip now at
  // its place gets it, else the last chip, else + Filter — never <body>,
  // where Esc would close Edit list.
  const owner = useId()
  const addFilterRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (autoFocusAdd) addFilterRef.current?.focus()
  }, [autoFocusAdd])
  const refocus = useRef<{ index: number; el: HTMLElement } | null>(null)
  const [keepFocusOnChip] = useState(() => (from?: Element) => {
    const chips = Array.from(document.querySelectorAll<HTMLElement>(`[data-chips-owner="${owner}"][data-testid="list-filter-chip"]`))
    const active = document.activeElement
    const index = chips.findIndex((c) => (from ? c === from : c.contains(active)))
    const el = chips[index]
    if (el && el.contains(active)) refocus.current = { index, el }
  })
  useLayoutEffect(() => {
    const pending = refocus.current
    if (!pending) return
    const active = document.activeElement
    // Not gone yet (the filter hasn't changed): wait.
    if (pending.el.isConnected && pending.el.contains(active)) return
    refocus.current = null
    if (active && active !== document.body && active.isConnected) return
    const chips = Array.from(document.querySelectorAll<HTMLElement>(`[data-chips-owner="${owner}"][data-testid="list-filter-chip"]`))
    const next = chips[Math.min(pending.index, chips.length - 1)]
    // The chip's own button (`ListFilterChip`), else + Filter.
    ;(next?.querySelector<HTMLElement>('[data-chip-edit]') ?? addFilterRef.current)?.focus()
  })

  /** Every write: the chips `next` adds join the order last. */
  const write = (next: TodoPredicate) => {
    const added = predicateLineItems(next, names).filter(isGraphicalItem)
    setOrder((o) => withRowsAdded(o, added))
    onChange(next)
  }
  /** A chip is going: its row goes, so the chip added again goes last. */
  const dropChipKey = (chip: ChipRef) => setOrder((o) => withoutChipRow(o, chip))

  const offered = (field: ListFilterField) => !omitFields?.includes(field)
  /** The date types this host's date panel offers, in its tabs' order. */
  const dateTypes = offeredDateFields(dateHost?.omit)
  /** Where adding `field` opens: Dates on the first type not filtering yet, Priority on a new condition (a new chip). */
  const addingAt = (field: ListFilterField): { dateField?: DateField; markerIndex?: number } => {
    if (field === 'markers') return { markerIndex: predicate.markers?.length ?? 0 }
    const dateField = field === 'dates' ? freeDateField(predicate.dates, dateTypes) : undefined
    return dateField ? { dateField } : {}
  }

  /** Writes a picker's edit; the chip a picker was adding is there now, and its picker reads as any other's. */
  const commit = (next: TodoPredicate) => {
    // A Priority chip emptied in its picker with later ones behind it: it goes
    // and they move up (the picker closes), so its row goes too, or each later
    // chip would take the place of the one before it.
    const markerIndex = open?.field === 'markers' ? open.markerIndex : undefined
    const markersLeft = next.markers?.length ?? 0
    if (markerIndex !== undefined && markersLeft < (predicate.markers?.length ?? 0) && markerIndex < markersLeft) {
      setOrder((o) => withoutPriorityRow(o, markerIndex))
    }
    write(next)
    if (open?.adding) setOpen({ ...open, adding: false })
  }
  const close = () => setOpen(null)

  function isChipOpen(chip: ChipRef): boolean {
    if (open?.field !== chip.field) return false
    if (chip.field === 'markers') return open.markerIndex === chip.markerIndex
    return chip.field !== 'dates' || open.dateField == null || open.dateField === chip.dateField
  }

  const remove = (chip: FilterChip) => {
    if (isChipOpen(chip)) setOpen(null)
    dropChipKey(chip)
    write(removeChip(predicate, chip))
  }

  /** Whether a press is on what is open (a mousedown: the popover closes on it, the click then folds). */
  const press = (isOpen: boolean) => { pressedOpen.current = isOpen }
  /** Whether this click came from a press that already closed what it is on. */
  const pressedClosed = () => {
    const was = pressedOpen.current
    pressedOpen.current = false
    return was
  }

  const toggleChip = (chip: FilterChip, el: Element) => {
    setAddPicker(null)
    // A second click folds it.
    if (pressedClosed()) return
    if (isChipOpen(chip)) {
      close()
      return
    }
    setOpen({ field: chip.field as ListFilterField, dateField: chip.dateField, markerIndex: chip.markerIndex, adding: false, at: pointBelow(el) })
  }

  const chipRow = (chip: FilterChip) => (
    <ListFilterChip
      key={chipKey(chip)}
      chip={chip}
      open={isChipOpen(chip)}
      disclosure={stack}
      rowKey={chipKey(chip)}
      owner={owner}
      onPress={() => press(isChipOpen(chip))}
      onEdit={(el) => toggleChip(chip, el)}
      onRemove={(el) => {
        keepFocusOnChip(el)
        remove(chip)
      }}
    />
  )

  const renderItem = (item: GraphicalLineItem): ReactNode => (stack ? <div className={styles.stackRow}>{chipRow(item.chip)}</div> : chipRow(item.chip))

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
        setAddPicker({ field: item.field, ...addingAt(item.field), at: menuAt })
      },
    })),
  ]

  const addFilter = (
    <button
      ref={addFilterRef}
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

  const lineItems = rows.map((item) => <Fragment key={chipKey(item.chip)}>{renderItem(item)}</Fragment>)

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
        <DatePendingNotContext.Provider value={pendingNot}>
          <PredicateFieldPicker
            key={`add-${addPicker.field}-${addPicker.dateField ?? ''}-${addPicker.markerIndex ?? ''}-${addPicker.at.x}-${addPicker.at.y}`}
            field={addPicker.field}
            dateField={addPicker.dateField}
            markerIndex={addPicker.markerIndex}
            predicate={predicate}
            onChange={write}
            at={addPicker.at}
            adding
            dateHost={dateHost}
            consumeEscape={inDialog}
            onClose={() => setAddPicker(null)}
          />
        </DatePendingNotContext.Provider>
      )}
      {open && (
        <FieldPopover
          key={`${open.field}-${open.dateField ?? ''}-${open.markerIndex ?? ''}-${open.at.x}-${open.at.y}`}
          field={open.field}
          at={open.at}
          consumeEscape={inDialog}
          onClose={close}
        >
          <DatePendingNotContext.Provider value={pendingNot}>
            <PredicateFieldPickerBody
              field={open.field}
              predicate={predicate}
              onChange={commit}
              adding={open.adding}
              dateField={open.dateField}
              markerIndex={open.markerIndex}
              dateHost={dateHost}
              onClose={close}
            />
          </DatePendingNotContext.Provider>
        </FieldPopover>
      )}
    </>
  )
}
