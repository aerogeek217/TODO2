import type { FilterChip } from '../../../utils/filter-chips'
import { ChevronDownIcon, CloseIcon } from '../icons'
import { useTooltip } from '../use-tooltip'
import styles from './ListFilterChips.module.css'

/** The chip `el` is in (`data-testid="list-filter-chip"`). */
function chipOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-testid="list-filter-chip"]')
}

/**
 * One list filter chip (`PredicateChips`): two sibling controls in one
 * plate (cr31 F9) — the chip's button (its field name muted, then the
 * value; `aria-haspopup="dialog"`) opens its picker under the chip (a
 * second click closes it), Delete / Backspace on it removes the chip; its ×
 * button removes it too. A press on the plate around them (its padding, the
 * editors' chevron) is the button's. In the editors it is a disclosure: a
 * chevron at its end. A chip with several values or an "is not" spells
 * itself out in a tooltip.
 */
export function ListFilterChip({ chip, open, disclosure, rowKey, owner, onPress, onEdit, onRemove }: {
  chip: FilterChip
  open: boolean
  disclosure: boolean
  rowKey: string
  /** The chip row it belongs to (`data-chips-owner`): where the focus goes when a chip does. */
  owner: string
  /** A press on the chip's button or plate (a mousedown: what it opens may close on it). */
  onPress: () => void
  /** `el`: the chip (its popover opens under it). */
  onEdit: (el: Element) => void
  /** `el`: the chip. */
  onRemove: (el: HTMLElement) => void
}) {
  const { triggerProps, tooltip } = useTooltip(open ? null : chip.tooltip, { labelLines: 1 })
  // Hover shows the tooltip over the whole chip; keyboard focus, on its button.
  const { onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, 'aria-describedby': describedBy } = triggerProps
  const inButton = (target: EventTarget) => target instanceof Element && target.closest('button') != null
  return (
    <>
      <span
        className={`${styles.listChip} ${open ? styles.listChipOpen : ''}`}
        data-testid="list-filter-chip"
        data-filter-row={rowKey}
        data-chips-owner={owner}
        data-date-field={chip.dateField}
        data-negated={chip.negated ? '' : undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => { if (!inButton(e.target)) onPress() }}
        onClick={(e) => {
          if (inButton(e.target)) return
          e.stopPropagation()
          onEdit(e.currentTarget)
        }}
      >
        <button
          type="button"
          className={styles.chipEdit}
          data-chip-edit=""
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={describedBy}
          onFocus={onFocus}
          onBlur={onBlur}
          onMouseDown={onPress}
          onClick={(e) => {
            e.stopPropagation()
            const el = chipOf(e.currentTarget)
            if (el) onEdit(el)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            e.preventDefault()
            const el = chipOf(e.currentTarget)
            if (el) onRemove(el)
          }}
        >
          <span className={styles.chipLabel}>{chip.label}</span>
          {chip.value}
        </button>
        <button
          type="button"
          className={styles.chipRemove}
          aria-label="Remove filter"
          title="Remove filter"
          onClick={(e) => {
            e.stopPropagation()
            const el = chipOf(e.currentTarget)
            if (el) onRemove(el)
          }}
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

