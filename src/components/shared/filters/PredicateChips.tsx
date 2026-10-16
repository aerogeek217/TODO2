import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { TodoPredicate } from '../../../models'
import type { DateField } from '../../../models/app-view'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { clearChipField, filterChips, type FilterChip } from '../../../utils/filter-chips'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { CloseIcon, PlusIcon } from '../icons'
import { ADD_FILTER_ITEMS, useChipNames } from './filter-menu'
import { PredicateFieldPicker } from './PredicateFieldPicker'
import { pointBelow } from './popover-point'
import styles from './ListFilterChips.module.css'

/** A field picker to show: which field, where, and whether it adds the filter. */
interface OpenPicker {
  field: ListFilterField
  at: PopoverPoint
  adding?: boolean
  dateField?: DateField
}

interface PredicateChipsProps {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  /** Rendered before the list chips (e.g. the screen filter chips). */
  before?: ReactNode
}

/**
 * A list's own filter as chips — field name muted, then the value; click
 * edits it with the field's picker, × removes it — and a "+ Filter" menu
 * that adds one (people, tags, due / follow-up date, status, text).
 */
export function PredicateChips({ predicate, onChange, before }: PredicateChipsProps) {
  const names = useChipNames()
  const chips = useMemo(() => filterChips(predicate, names), [predicate, names])
  const [picker, setPicker] = useState<OpenPicker | null>(null)
  const [menuAt, setMenuAt] = useState<PopoverPoint | null>(null)
  // A trigger clicked while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const menuWasOpen = useRef(false)

  const remove = (field: FilterChip['field']) => onChange(clearChipField(predicate, field))
  const edit = (chip: FilterChip, el: Element) => setPicker({ field: chip.field as ListFilterField, at: pointBelow(el) })

  const menuEntries: MenuEntry[] = [
    { kind: 'label', text: 'Add a filter to this list' },
    ...ADD_FILTER_ITEMS.map((item): MenuEntry => ({
      kind: 'item',
      label: item.label,
      icon: item.icon,
      submenu: item.submenu,
      onSelect: () => {
        if (menuAt) setPicker({ field: item.field, at: menuAt, adding: true, dateField: item.dateField })
      },
    })),
  ]

  return (
    <>
      {before}
      {chips.map((chip) => (
        <span
          key={chip.field}
          role="button"
          tabIndex={0}
          className={styles.listChip}
          data-testid="list-filter-chip"
          onClick={(e) => edit(chip, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              edit(chip, e.currentTarget)
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault()
              remove(chip.field)
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
            onClick={(e) => { e.stopPropagation(); remove(chip.field) }}
          >
            <CloseIcon size={9} />
          </button>
        </span>
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
          onClose={() => setPicker(null)}
        />
      )}
    </>
  )
}
