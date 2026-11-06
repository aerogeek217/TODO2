import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import { createScopedPendingNot, DatePendingNotContext } from './date-pending-not'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import {
  chipClauses, chipKey, filterChips, heldFields, isGraphicalItem, predicateLineItems, removeChip, wrapChipInOrGroup,
  type FilterChip, type GraphicalLineItem,
} from '../../../utils/filter-chips'
import { freeDateField, offeredDateFields } from '../../../utils/date-filters'
import {
  rowOrderOf, sortedRows, withGroupsDissolved, withoutChipRow, withoutGroupRow, withoutPriorityRow, withRowRenamed, withRowsAdded,
  type ChipRef, type RowOrder,
} from '../../../utils/filter-row-order'
import { dissolveSingleOrGroups, hasFilterClause, withOrGroupClauses, withoutOrGroup } from '../../../utils/or-groups'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { ChevronDownIcon, ChevronRightIcon, FunnelIcon, InfoIcon, PlusIcon } from '../icons'
import { useTooltip } from '../use-tooltip'
import { expressionText } from '../../../utils/filter-chips'
import { asExpression, asGraphical, withExpression } from '../../../utils/predicate-expression'
import { ExpressionField } from './ExpressionField'
import { ADD_FILTER_ITEMS, useChipNames } from './filter-menu'
import { PredicateFieldPicker, PredicateFieldPickerBody } from './PredicateFieldPicker'
import type { DateFilterHost } from './DateFilterPanel'
import { pointBelow } from './popover-point'
import { ListFilterChip } from './ListFilterChip'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { predicatesEqual } from '../../../utils/list-def-equal'
import { useAnyFilterPickerOpen, useFilterPickerOpen } from './open-pickers'
import styles from './ListFilterChips.module.css'
import { FieldPopover, GroupPanel, GroupPopover } from './PredicateChipsPopovers'

/** Which clauses an edit goes to: the predicate's own (`null`) or or group `n`'s. */
type Scope = number | null


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
  | { kind: 'field'; scope: Scope; field: ListFilterField; dateField?: DateField; markerIndex?: number; adding: boolean; wrap?: Wrap; held?: FilterClauses; at: PopoverPoint }
  | { kind: 'group'; index: number; orAnother: boolean; wrap?: Wrap; at: PopoverPoint }

/**
 * A + Filter pick: that field's picker as a popover, adding to the
 * predicate's own clauses (Dates: on the first date type they don't filter
 * yet, so it adds a chip; every type filtering, the panel's default.
 * Priority: a new condition, so another chip).
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
   * Completed) and the Completed range's note (an Eisenhower pane's `narrow`).
   */
  dateHost?: DateFilterHost
  /**
   * `line` (default): one row — the list's filter line. `stack`: the
   * editors' Filters block — a column, one chip or group per row, "and" on
   * its own row. In both a chip's picker and a group's panel open as
   * popovers under their row.
   */
  layout?: 'line' | 'stack'
  /**
   * The line layout, for a filter written as an expression (shown as one
   * chip holding its text): opens where it is edited (Edit list). Absent:
   * the chip only shows it.
   */
  onOpenExpression?: () => void
}

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
export function PredicateChips(props: PredicateChipsProps) {
  const { predicate, onChange, before, layout = 'line', omitFields, onOpenExpression } = props
  const isExpression = predicate.expression != null
  const [mode, setMode] = useState<FilterMode>(isExpression ? 'expression' : 'graphical')
  // A filter that became an expression elsewhere (undo, a reload) shows as one.
  const [seenExpression, setSeenExpression] = useState(isExpression)
  if (isExpression !== seenExpression) {
    setSeenExpression(isExpression)
    if (isExpression) setMode('expression')
  }
  const names = useChipNames()
  const text = useMemo(() => expressionText(predicate, names), [predicate, names])

  if (layout !== 'stack') {
    if (!isExpression) return <GraphicalChips {...props} />
    return (
      <>
        {before}
        <ExpressionChip text={text} onOpen={onOpenExpression} />
      </>
    )
  }

  const toGraphical = () => {
    setMode('graphical')
    const graphical = asGraphical(predicate)
    if (graphical && graphical !== predicate) onChange(graphical)
  }
  const toExpression = () => {
    setMode('expression')
    if (!isExpression) {
      const next = asExpression(predicate)
      if (next.expression) onChange(next)
    }
  }
  const allowPeople = !(omitFields ?? []).includes('people')
  let body: ReactNode
  if (mode === 'expression') {
    body = <ExpressionField predicate={predicate} onChange={onChange} allowPeople={allowPeople} autoFocus={!isExpression} />
  } else if (isExpression) {
    // Graphical over an expression no chips say.
    body = (
      <div className={styles.expressionLocked} data-testid="expression-locked">
        <span className={styles.expressionLockedTitle}>This filter is an expression</span>
        <span className={styles.expressionLockedText} title={text}>{text}</span>
        <div className={styles.expressionLockedButtons}>
          <button type="button" className={styles.expressionPrimary} onClick={() => setMode('expression')}>Edit expression</button>
          <button
            type="button"
            className={styles.expressionSecondary}
            onClick={() => onChange(withExpression(predicate, null))}
          >
            Clear and use Graphical
          </button>
        </div>
      </div>
    )
  } else {
    body = <GraphicalChips {...props} />
  }
  return (
    <div className={styles.modeBlock}>
      <FilterModeSwitch mode={mode} onGraphical={toGraphical} onExpression={toExpression} />
      {body}
    </div>
  )
}

type FilterMode = 'graphical' | 'expression'

const MODE_HELP = 'Graphical: a chip per field; every chip must match\nSeveral values in a chip: any of them\nExpression: or / not across fields, nested groups'

/** Graphical | Expression, with what each is in a tooltip. */
function FilterModeSwitch({ mode, onGraphical, onExpression }: { mode: FilterMode; onGraphical: () => void; onExpression: () => void }) {
  const help = useTooltip(MODE_HELP)
  return (
    <div className={styles.modeRow}>
      <div className={styles.modeSwitch} role="radiogroup" aria-label="Filter mode">
        <button type="button" role="radio" aria-checked={mode === 'graphical'} className={mode === 'graphical' ? styles.modeOn : styles.mode} onClick={onGraphical}>
          Graphical
        </button>
        <button type="button" role="radio" aria-checked={mode === 'expression'} className={mode === 'expression' ? styles.modeOn : styles.mode} onClick={onExpression}>
          Expression
        </button>
      </div>
      <button type="button" className={styles.modeHelp} aria-label="About filter modes" {...help.triggerProps}>
        <InfoIcon size={14} />
      </button>
      {help.tooltip}
    </div>
  )
}

/** A filter written as an expression on the list's filter line: one chip, its text cut to fit, the whole in its tooltip. */
function ExpressionChip({ text, onOpen }: { text: string; onOpen?: () => void }) {
  const tip = useTooltip(onOpen ? `${text}\nClick to edit` : text, { labelLines: 1 })
  const content = (
    <>
      <FunnelIcon />
      <span className={styles.expressionChipText}>{text}</span>
    </>
  )
  return onOpen ? (
    <button type="button" className={styles.expressionChip} data-testid="list-filter-expression" onClick={onOpen} {...tip.triggerProps}>
      {content}
      {tip.tooltip}
    </button>
  ) : (
    <span className={styles.expressionChip} data-testid="list-filter-expression" tabIndex={0} {...tip.triggerProps}>
      {content}
      {tip.tooltip}
    </span>
  )
}

/**
 * The Graphical filter (`PredicateChips` in Graphical mode, and the line layout).
 */
function GraphicalChips({
  predicate, onChange, before, addLabel = 'Add a filter to this list', inDialog = false, omitFields, dateHost, layout = 'line',
}: PredicateChipsProps) {
  const stack = layout === 'stack'
  // Outlives the date panel: an Is not chosen before a range has an end stays
  // chosen — per scope (the predicate's own clauses, each or group).
  const [pendingNot] = useState(createScopedPendingNot)
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
  const items = useMemo(() => predicateLineItems(shown, names).filter(isGraphicalItem), [shown, names])
  const groups = shown.orGroups ?? []
  const hasGroups = items.some((item) => item.kind === 'orGroup')
  // The rows in the order they were added (`utils/filter-row-order`; the
  // stored order at mount). A chip shown wrapped in a new group (not written
  // yet) keeps its place as the group's (the alias); once written, the group
  // takes it.
  const [order, setOrder] = useState<RowOrder>(() => rowOrderOf(items))
  // The wrap's rows from its parts (a call on `wrap` itself would read to the
  // compiler as a possible mutation and stop it memoizing `shown`).
  const wrapField = wrap?.chip.field
  const wrapDate = wrap?.chip.dateField
  const wrapMarker = wrap?.chip.markerIndex
  const wrapIndex = wrap?.index
  const wrapRows = useMemo(
    () => (wrapField != null && wrapIndex != null
      ? { row: { kind: 'group', index: wrapIndex } as const, as: { kind: 'chip', chip: { field: wrapField, dateField: wrapDate, markerIndex: wrapMarker } } as const }
      : undefined),
    [wrapField, wrapDate, wrapMarker, wrapIndex],
  )
  const rows = useMemo(() => sortedRows(items, order, wrapRows), [items, order, wrapRows])
  // A chip that goes (× / Delete, or drawn anew when its group dissolves)
  // takes the focus with it: the chip now at its place gets it, else the
  // last chip, else + Filter — never <body>, where Esc would close Edit list.
  const owner = useId()
  const addFilterRef = useRef<HTMLButtonElement>(null)
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

  // The filter as it was before this row's last edit (null: no edit here
  // since the last dissolve). Only the row an edit was made in dissolves.
  const editedFrom = useRef<TodoPredicate | null>(null)
  /** Every write: the rows `next` adds join the order last. */
  const write = (next: TodoPredicate) => {
    const added = predicateLineItems(next, names).filter(isGraphicalItem)
    setOrder((o) => withRowsAdded(o, added))
    if (!predicatesEqual(next, predicate)) editedFrom.current = predicate
    onChange(next)
  }
  /** Or group `index` is going: its key goes from the order, the later groups' keys move down. */
  const dropGroupKey = (index: number) => {
    pendingNot.clearGroups()
    setOrder((o) => withoutGroupRow(o, index))
  }
  /** A chip of the predicate's own is going: its row goes, so the chip added again goes last. */
  const dropChipKey = (chip: ChipRef) => setOrder((o) => withoutChipRow(o, chip))

  const offered = (field: ListFilterField) => !omitFields?.includes(field)
  /** The date types this host's date panel offers, in its tabs' order. */
  const dateTypes = offeredDateFields(dateHost?.omit)
  /**
   * The fields a group (or a new one starting with `clauses`) can still
   * take — Dates while one of the offered date types is free there.
   */
  const addable = (clauses: FilterClauses) => {
    const held = heldFields(clauses, dateTypes)
    return ADD_FILTER_ITEMS.filter((item) => offered(item.field) && !held.has(item.field))
  }
  /** Where adding `field` to `clauses` opens: Dates on the first type they don't filter yet, Priority on a new condition (a new chip). */
  const addingAt = (field: ListFilterField, clauses: FilterClauses): { dateField?: DateField; markerIndex?: number } => {
    if (field === 'markers') return { markerIndex: clauses.markers?.length ?? 0 }
    const dateField = field === 'dates' ? freeDateField(clauses.dates, dateTypes) : undefined
    return dateField ? { dateField } : {}
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
    // The wrap is written: its group takes the chip's place.
    if (open?.wrap && wrapRows) setOrder((o) => withRowRenamed(o, wrapRows.as, wrapRows.row))
    // A Priority chip of the predicate's own emptied in its picker with later
    // ones behind it: it goes and they move up (the picker closes), so its key
    // goes too, or each later chip would take the place of the one before it.
    const markerIndex = open?.kind === 'field' && open.scope == null && open.field === 'markers' ? open.markerIndex : undefined
    const markersLeft = next.markers?.length ?? 0
    if (markerIndex !== undefined && markersLeft < (shown.markers?.length ?? 0) && markerIndex < markersLeft) {
      setOrder((o) => withoutPriorityRow(o, markerIndex))
    }
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

  // A group left with one item goes, its item taking its place — only in the
  // row the edit was made in (another row on the same filter, Edit list
  // beside the list's line, may have a picker open on that group), and once
  // no row has a picker open: one that just emptied a chip may fill it again,
  // and one open elsewhere edits the groups by their places.
  const onChangeRef = useLatestRef(onChange)
  const namesRef = useLatestRef(names)
  const openHere = open != null || addPicker != null
  useFilterPickerOpen(openHere)
  const anyOpen = useAnyFilterPickerOpen()
  const settled = !openHere && !anyOpen
  useEffect(() => {
    if (!settled) return
    const from = editedFrom.current
    // No edit here, or it hasn't reached the filter yet.
    if (from == null || from === predicate) return
    editedFrom.current = null
    const { predicate: next, dissolved } = dissolveSingleOrGroups(predicate)
    if (dissolved.length === 0) return
    const chipOf = (index: number) => {
      const group = predicate.orGroups?.[index]
      const [chip] = group ? filterChips(group, namesRef.current) : []
      return chip ?? null
    }
    pendingNot.clearGroups()
    // The dissolved group's chip is drawn anew in its place: the focus follows it.
    keepFocusOnChip()
    // A Priority chip joins the predicate's own, after those it holds.
    setOrder((o) => withGroupsDissolved(o, dissolved, chipOf, predicate.markers?.length ?? 0))
    onChangeRef.current(next)
  }, [settled, predicate, namesRef, onChangeRef, pendingNot, keepFocusOnChip])

  const rowKey = (scope: Scope, chip: ChipRef) => `${scope ?? 'root'}:${chipKey(chip)}`
  // What a close already handled: Esc can reach `close` twice (the popover's
  // own handler and the field's), which would drop a second group's key.
  const closedRef = useRef<Open | null>(null)
  /** Closes what is open; a held group is then left out, the later groups moving down. */
  const close = () => {
    if (open != null && closedRef.current === open) return
    closedRef.current = open
    if (heldIndex != null) dropGroupKey(heldIndex)
    setOpen(null)
  }

  const remove = (chip: FilterChip, scope: Scope) => {
    if (wrap) {
      // The wrap isn't written: the chip is still the predicate's own.
      setOpen(null)
      const own = scope === wrap.index || scope == null
      // In the wrap's group the chip is the first of it; it is still the predicate's own one.
      const target = scope === wrap.index ? wrap.chip : chip
      if (own) dropChipKey(target)
      write(removeChip(predicate, target, own ? undefined : scope))
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
    if (chip.field === 'markers') return open.markerIndex === chip.markerIndex
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
    setOpen({ kind: 'field', scope, field: chip.field as ListFilterField, dateField: chip.dateField, markerIndex: chip.markerIndex, adding: false, ...keepWrap, at: pointBelow(el) })
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
    const chip = { field: o.field, dateField: o.dateField, markerIndex: o.markerIndex }
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
    const chip = { field: o.field, dateField: o.dateField, markerIndex: o.markerIndex }
    const own = chipClauses(shown, chip)
    return hasFilterClause(own) && wrapChipInOrGroup(shown, chip) != null && addable(own).length > 0
  }

  const addToGroup = (o: Extract<Open, { kind: 'group' }>, field: ListFilterField) => {
    // A wrap not written yet is in `shown`: the group's clauses hold the wrapped chip, so Dates opens on another type and Priority on another condition.
    setOpen({ kind: 'field', scope: o.index, field, ...addingAt(field, clausesOf(o.index)), adding: true, ...(o.wrap ? { wrap: o.wrap } : {}), at: o.at })
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
    return (
      <DatePendingNotContext.Provider value={pendingNot.of(scope)}>
        {scopedFieldPicker(o)}
      </DatePendingNotContext.Provider>
    )
  }
  const scopedFieldPicker = (o: Extract<Open, { kind: 'field' }>) => {
    const scope = o.scope
    return scope == null ? (
      <PredicateFieldPickerBody
        field={o.field}
        predicate={shown}
        onChange={commit}
        adding={o.adding}
        dateField={o.dateField}
        markerIndex={o.markerIndex}
        dateHost={dateHost}
        onClose={close}
      />
    ) : (
      <PredicateFieldPickerBody
        field={o.field}
        predicate={clausesOf(scope)}
        onChange={(c) => commit(withOrGroupClauses(shown, scope, () => c), { index: scope, clauses: c })}
        adding={o.adding}
        dateField={o.dateField}
        markerIndex={o.markerIndex}
        dateHost={dateHost}
        onClose={close}
      />
    )
  }

  const chipRow = (chip: FilterChip, scope: Scope) => (
    <ListFilterChip
      key={chipKey(chip)}
      chip={chip}
      open={isChipOpen(chip, scope)}
      disclosure={stack}
      rowKey={rowKey(scope, chip)}
      owner={owner}
      onPress={() => press(isChipOpen(chip, scope))}
      onEdit={(el) => toggleChip(chip, scope, el)}
      onRemove={(el) => {
        keepFocusOnChip(el)
        remove(chip, scope)
      }}
    />
  )

  const renderItem = (item: GraphicalLineItem): ReactNode => {
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
        setAddPicker({ field: item.field, ...addingAt(item.field, predicate), at: menuAt })
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
        <DatePendingNotContext.Provider value={pendingNot.of(null)}>
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
      {open && (open.kind === 'field' ? (
        <FieldPopover
          key={`${open.scope ?? 'root'}-${open.field}-${open.dateField ?? ''}-${open.markerIndex ?? ''}-${open.at.x}-${open.at.y}`}
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

/** How many chips or group `index` shows on the line. */
function groupChipCount(items: readonly GraphicalLineItem[], index: number): number {
  for (const item of items) if (item.kind === 'orGroup' && item.index === index) return item.chips.length
  return 0
}
