import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { anchorAtPoint, usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { ChevronRightIcon } from '../icons'
import { PopoverRoot } from '../PopoverRoot'
import { DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { ADD_FILTER_ITEMS } from './filter-menu'
import { pickerLabel } from './picker-label'
import menuStyles from '../MenuPopover.module.css'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

/** `PredicateChips`' popovers: a field's picker shell, an or group's panel and its shell. */

const FIELD_ITEMS = new Map(ADD_FILTER_ITEMS.map((item) => [item.field, item]))

/**
 * An or group's panel: the fields it can still take (each opens its
 * picker, adding to the group) and Remove group — or, for a chip's "Another
 * filter (OR)", the fields alone.
 */
export function GroupPanel({ fields, count, orAnother, onAdd, onRemoveGroup }: {
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
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: anchorAtPoint(at),
    open: true,
    placement: at.align === 'start' ? 'bottom-start' : 'bottom-end',
    closeOnScroll: false,
    consumeEscape,
    onClose,
    caret: true,
  })
  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
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
export function FieldPopover({ field, ...rest }: { field: ListFilterField; at: PopoverPoint; consumeEscape: boolean; onClose: () => void; children: ReactNode }) {
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
export function GroupPopover(props: { at: PopoverPoint; consumeEscape: boolean; onClose: () => void; children: ReactNode }) {
  return <FilterPopover {...props} className={`${picker.dropdownPanel} ${styles.groupPopover}`} label="Group" testId="or-group-panel" />
}
