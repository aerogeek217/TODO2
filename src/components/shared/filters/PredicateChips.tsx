import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { chipKey, clearChipField, filterChips, type FilterChip } from '../../../utils/filter-chips'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { CloseIcon, PlusIcon } from '../icons'
import { ADD_FILTER_ITEMS, useChipNames } from './filter-menu'
import { PredicateFieldPicker } from './PredicateFieldPicker'
import { pointBelow } from './popover-point'
import { useTooltip } from '../use-tooltip'
import styles from './ListFilterChips.module.css'

/** A field picker to show: which field, where, and whether it adds the filter. */
interface OpenPicker {
  field: ListFilterField
  at: PopoverPoint
  adding?: boolean
  /** The date chip it was opened from: the date panel opens on its type. */
  dateField?: DateField
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
}

/**
 * A list's own filter as chips — field name muted, then the value; one chip
 * per date type that filters; click edits it with the field's picker (a
 * date chip opens the date panel on its type), × removes it (a date chip
 * only its type) — and a "+ Filter" menu that adds one (priority, tags,
 * people, dates, status, text).
 */
export function PredicateChips({
  predicate, onChange, before, addLabel = 'Add a filter to this list', inDialog = false, omitFields,
}: PredicateChipsProps) {
  const names = useChipNames()
  const chips = useMemo(() => filterChips(predicate, names), [predicate, names])
  const [picker, setPicker] = useState<OpenPicker | null>(null)
  const [menuAt, setMenuAt] = useState<PopoverPoint | null>(null)
  // A trigger clicked while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const menuWasOpen = useRef(false)

  const remove = (chip: FilterChip) => onChange(clearChipField(predicate, chip.field, chip.dateField))
  const edit = (chip: FilterChip, el: Element) => setPicker({ field: chip.field as ListFilterField, at: pointBelow(el), dateField: chip.dateField })
  const isOpen = (chip: FilterChip) => picker != null && !picker.adding && picker.field === chip.field && picker.dateField === chip.dateField

  const menuEntries: MenuEntry[] = [
    { kind: 'label', text: addLabel },
    ...ADD_FILTER_ITEMS.filter((item) => !omitFields?.includes(item.field)).map((item): MenuEntry => ({
      kind: 'item',
      label: item.label,
      icon: item.icon,
      submenu: item.submenu,
      onSelect: () => {
        if (menuAt) setPicker({ field: item.field, at: menuAt, adding: true })
      },
    })),
  ]

  return (
    <>
      {before}
      {chips.map((chip) => (
        <ListChip
          key={chipKey(chip)}
          chip={chip}
          open={isOpen(chip)}
          onEdit={(el) => edit(chip, el)}
          onRemove={() => remove(chip)}
        />
      ))}
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
      {picker && (
        <PredicateFieldPicker
          key={`${picker.field}-${picker.dateField ?? ''}-${picker.at.x}-${picker.at.y}`}
          field={picker.field}
          predicate={predicate}
          onChange={onChange}
          at={picker.at}
          adding={picker.adding}
          dateField={picker.dateField}
          consumeEscape={inDialog}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  )
}

/**
 * One list filter chip: click (or Enter / Space) edits it, Delete /
 * Backspace or its × removes it. An "is not" chip spells out what it hides
 * in a tooltip.
 */
function ListChip({ chip, open, onEdit, onRemove }: {
  chip: FilterChip
  open: boolean
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
        data-date-field={chip.dateField}
        data-negated={chip.negated ? '' : undefined}
        {...triggerProps}
        onClick={(e) => onEdit(e.currentTarget)}
        onKeyDown={(e) => {
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
      </span>
      {tooltip}
    </>
  )
}
