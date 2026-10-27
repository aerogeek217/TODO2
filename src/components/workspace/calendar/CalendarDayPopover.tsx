import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDndMonitor } from '@dnd-kit/core'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel } from '../../../utils/calendar-grid'
import { CloseIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { PopoverRoot } from '../../shared/PopoverRoot'

interface CalendarDayPopoverProps {
  day: Date
  /** Top-left corner (viewport): over the day cell. */
  at: { x: number; y: number }
  entries: readonly CalendarEntry[]
  renderEntry: (entry: CalendarEntry) => ReactNode
  onClose: () => void
}

/**
 * Every entry of one day (a month cell's or week row's "+N more"). Entries click to edit and drag
 * like any entry: the popover hides when a drag starts (its entry stays
 * mounted as the drag source) and closes when the drag ends. Esc, × or a
 * click outside closes it.
 */
export function CalendarDayPopover({ day, at, entries, renderEntry, onClose }: CalendarDayPopoverProps) {
  const [dragging, setDragging] = useState(false)
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: at.x, y: at.y },
    open: true,
    placement: 'bottom-start',
    offset: 0,
    closeOnScroll: false,
    onClose,
  })
  useDndMonitor({
    onDragStart() { setDragging(true) },
    onDragEnd() { if (dragging) onClose() },
    onDragCancel() { if (dragging) onClose() },
  })

  const count = `${entries.length} ${entries.length === 1 ? 'task' : 'tasks'}`
  return createPortal(
    <PopoverRoot
      ref={panelRef}
      className={styles.dayPopover}
      style={{ position: style.position, left: style.left, top: style.top, visibility: dragging ? 'hidden' : undefined }}
      role="dialog"
      aria-label={`${dayLabel(day)}, ${count}`}
      data-testid="calendar-day-popover"
    >
      <div className={styles.dayPopoverHeader}>
        <span className={styles.dayPopoverTitle}>{dayLabel(day)}</span>
        <span className={styles.dayPopoverCount}>{count}</span>
        <button type="button" className={styles.dayPopoverClose} aria-label="Close" onClick={onClose}>
          <CloseIcon size={10} />
        </button>
      </div>
      <div ref={trackScrollEdges} className={styles.dayPopoverEntries}>
        {entries.map((e) => renderEntry(e))}
      </div>
    </PopoverRoot>,
    document.body,
  )
}
