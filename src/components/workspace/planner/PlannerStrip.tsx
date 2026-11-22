import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { formatDateWith } from '../../../utils/date'
import type { WeekStart } from '../../../utils/effective-date'
import { dayTicks } from '../../../utils/day-ticks'
import { plannerRangeLabel, plannerTileLabel, type PlannerTile, type PlannerWindow } from '../../../utils/planner'
import { plannerDropId, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { DayTicks } from '../../shared/DayTicks'
import { ChevronLeftIcon, ChevronRightIcon } from '../../shared/icons'
import styles from './PlannerWidget.module.css'

/** The target a dragged task's drop would change its plan on (its tile and its group are marked). */
export interface PlannerDropMark {
  /** The target's key (`utils/planner.plannerTargetKey`). */
  key: string
}

interface PlannerStripProps {
  /** The Planner's tab id: its tiles' drop scope. */
  tabId: string
  window: PlannerWindow
  tiles: readonly PlannerTile[]
  /** The window's offset from today, days: at 0 there is no earlier week. */
  offset: number
  /** `false`: no room for seven tiles — the arrows stay, around the window's range. */
  showTiles: boolean
  /** The first day of the week (Settings › Tasks › Rules, the calendar's): a divider stands before its tile. */
  weekStartsOn: WeekStart
  /** A tile's click: the day list scrolls to its day (the day's `dayKey`). */
  onGo: (key: string) => void
  /** An arrow's click: a week earlier (-1) or later (1). */
  onShift: (weeks: -1 | 1) => void
  /** The drop a task drag over this Planner would make, when it writes; null with none. */
  mark: PlannerDropMark | null
  /** `false`: the arrows are elsewhere (the portrait layout's top line), the tiles take the whole strip. Default true. */
  arrows?: boolean
  /** The portrait layout (board R1): a narrow tile keeps its ticks — weekday; date and count; ticks. */
  portrait?: boolean
  /** The days whose groups show in the day list (`dayKey`s): a line under their tiles. Absent: no line. */
  inView?: ReadonlySet<string>
}

/** A week arrow: `‹` (a week earlier) or `›` (later) — the strip's, or the portrait layout's top line's. */
export function WeekArrow({ direction, disabled, onShift, compact = false }: {
  direction: -1 | 1
  disabled: boolean
  onShift: (weeks: -1 | 1) => void
  /** The top line's: narrower, so the name keeps its room. */
  compact?: boolean
}) {
  const label = direction < 0 ? 'Previous week' : 'Next week'
  return (
    <button type="button" className={`${styles.arrow} ${compact ? styles.arrowCompact : ''}`} aria-label={label} data-tooltip={label} disabled={disabled} onClick={() => onShift(direction)}>
      {direction < 0 ? <ChevronLeftIcon size={12} /> : <ChevronRightIcon size={12} />}
    </button>
  )
}

/**
 * The Planner's strip: `‹`, the window's seven day tiles — equal widths,
 * weekends too — and `›`. A tile shows its weekday, date, the count of rows
 * sitting on the day, and its ticks (`shared/DayTicks`, the Calendar's
 * small cells' too): a **solid tick** per real date falling on the day — due
 * dates in the deadline color, then follow-ups in the follow-up color,
 * wherever those tasks are planned —, then a **hollow tick** per plan on
 * it, then `+N`. Today's tile is in the
 * accent. A thin rule, in a slightly wider gap, stands before the tile
 * that starts a week (`weekStartsOn`; never before the first tile). A
 * click scrolls the day list to the tile's day (`onGo`); the arrows move
 * the window a week. Each tile takes a dragged task (a droppable,
 * `TASK_DROP_KIND.plannerDay`): the day a drop would plan it for is dashed,
 * in one neutral color — no real date changes — (`mark`:
 * `data-planner-drop`). Too narrow for tiles (`showTiles` false), the
 * arrows sit around the range in words. In the portrait layout (board R1)
 * the arrows move to the top line when it shows (`arrows` false), a narrow
 * tile keeps its ticks (`portrait`), and a line under each tile marks the
 * days whose groups show in the day list (`inView`, `data-in-view`).
 */
export function PlannerStrip({ tabId, window, tiles, offset, showTiles, weekStartsOn, onGo, onShift, mark, arrows = true, portrait = false, inView }: PlannerStripProps) {
  // Without tiles the range sits between the arrows, so they stay.
  const withArrows = arrows || !showTiles
  return (
    <div
      className={[styles.strip, showTiles ? '' : styles.stripSlim, portrait ? styles.stripPortrait : '', inView ? styles.stripInView : ''].join(' ')}
      role="group"
      aria-label="Days"
      data-planner-strip={showTiles ? 'tiles' : 'range'}
      data-planner-strip-arrows={withArrows ? undefined : 'top-line'}
    >
      {withArrows && <WeekArrow direction={-1} disabled={offset <= 0} onShift={onShift} />}
      {showTiles
        ? tiles.map((tile, i) => (
          <Fragment key={tile.key}>
            {i > 0 && tile.day.getDay() === weekStartsOn && <span className={styles.weekRule} aria-hidden="true" data-planner-week-rule={tile.key} />}
            <Tile tabId={tabId} window={window} tile={tile} marked={mark?.key === tile.key} inView={inView?.has(tile.key) === true} onGo={onGo} />
          </Fragment>
        ))
        : <span className={styles.stripRange}>{plannerRangeLabel(window)}</span>}
      {withArrows && <WeekArrow direction={1} disabled={false} onShift={onShift} />}
    </div>
  )
}

function Tile({ tabId, window, tile, marked, inView, onGo }: {
  tabId: string
  window: PlannerWindow
  tile: PlannerTile
  marked: boolean
  /** Its day's group shows in the day list: the line under the tile. */
  inView: boolean
  onGo: (key: string) => void
}) {
  const weekday = tile.day.getDay()
  const data: PlannerDropData = {
    type: TASK_DROP_KIND.plannerDay,
    scope: tabId,
    target: { kind: 'day', day: tile.day },
    window: { today: window.today, last: window.last },
  }
  const { setNodeRef } = useDroppable({ id: plannerDropId(tabId, 'tile', tile.key), data: { ...data } })
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={styles.tile}
      data-planner-drop={marked ? '' : undefined}
      aria-label={plannerTileLabel(tile)}
      data-planner-tile={tile.key}
      data-today={tile.isToday ? 'true' : undefined}
      data-weekend={weekday === 0 || weekday === 6 ? 'true' : undefined}
      data-in-view={inView ? '' : undefined}
      data-count-wide={tile.count >= 10 ? '' : undefined}
      onClick={() => onGo(tile.key)}
    >
      <span className={styles.tileHead}>
        <span className={styles.weekday}>{formatDateWith(tile.day, { weekday: 'short' })}</span>
        <span className={styles.dateNumber}>{tile.day.getDate()}</span>
        <span className={styles.tileCount} data-testid="planner-tile-count">{tile.count > 0 ? tile.count : ''}</span>
      </span>
      <DayTicks ticks={dayTicks(tile)} className={styles.ticks} />
    </button>
  )
}
