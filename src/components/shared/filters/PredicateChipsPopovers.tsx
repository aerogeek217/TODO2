import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { anchorAtPoint, usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { PopoverRoot } from '../PopoverRoot'
import { DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { pickerLabel } from './picker-label'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

/** `PredicateChips`' popover: a field's picker shell. */

/** A popover at `at` for the list's filter line: a field's picker. */
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

