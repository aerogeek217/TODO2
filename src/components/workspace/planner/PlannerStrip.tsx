import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { formatDateWith } from '../../../utils/date'
import type { WeekStart } from '../../../utils/effective-date'
import { plannerRangeLabel, plannerTileLabel, plannerTileMarks, type PlannerTile, type PlannerWindow } from '../../../utils/planner'
import { plannerDropId, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
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
}

/**
 * The Planner's strip: `‹`, the window's seven day tiles — equal widths,
 * weekends too — and `›`. A tile shows its weekday, date, the count of rows
 * sitting on the day, and its marks (`plannerTileMarks`): a **solid tick**
 * per real date falling on the day — due dates in the deadline color, then
 * follow-ups in the follow-up color, wherever those tasks are planned —,
 * then a **hollow tick** per plan on it, then `+N`. Today's tile is in the
 * accent. A thin rule, in a slightly wider gap, stands before the tile
 * that starts a week (`weekStartsOn`; never before the first tile). A
 * click scrolls the day list to the tile's day (`onGo`); the arrows move
 * the window a week. Each tile takes a dragged task (a droppable,
 * `TASK_DROP_KIND.plannerDay`): the day a drop would plan it for is dashed,
 * in one neutral color — no real date changes — (`mark`:
 * `data-planner-drop`). Too narrow for tiles (`showTiles` false), the
 * arrows sit around the range in words.
 */
export function PlannerStrip({ tabId, window, tiles, offset, showTiles, weekStartsOn, onGo, onShift, mark }: PlannerStripProps) {
  return (
    <div className={`${styles.strip} ${showTiles ? '' : styles.stripSlim}`} role="group" aria-label="Days" data-planner-strip={showTiles ? 'tiles' : 'range'}>
      <button
        type="button"
        className={styles.arrow}
        aria-label="Previous week"
        data-tooltip="Previous week"
        disabled={offset <= 0}
        onClick={() => onShift(-1)}
      >
        <ChevronLeftIcon size={12} />
      </button>
      {showTiles
        ? tiles.map((tile, i) => (
          <Fragment key={tile.key}>
            {i > 0 && tile.day.getDay() === weekStartsOn && <span className={styles.weekRule} aria-hidden="true" data-planner-week-rule={tile.key} />}
            <Tile tabId={tabId} window={window} tile={tile} marked={mark?.key === tile.key} onGo={onGo} />
          </Fragment>
        ))
        : <span className={styles.stripRange}>{plannerRangeLabel(window)}</span>}
      <button
        type="button"
        className={styles.arrow}
        aria-label="Next week"
        data-tooltip="Next week"
        onClick={() => onShift(1)}
      >
        <ChevronRightIcon size={12} />
      </button>
    </div>
  )
}

function Tile({ tabId, window, tile, marked, onGo }: {
  tabId: string
  window: PlannerWindow
  tile: PlannerTile
  marked: boolean
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
  const marks = plannerTileMarks(tile)
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
      onClick={() => onGo(tile.key)}
    >
      <span className={styles.tileHead}>
        <span className={styles.weekday}>{formatDateWith(tile.day, { weekday: 'short' })}</span>
        <span className={styles.dateNumber}>{tile.day.getDate()}</span>
        <span className={styles.tileCount} data-testid="planner-tile-count">{tile.count > 0 ? tile.count : ''}</span>
      </span>
      <span className={styles.ticks} aria-hidden="true">
        <span className={styles.tickMarks}>
          {marks.dates.map((kind, i) => <span key={i} className={styles.tick} data-mark={kind} />)}
          {Array.from({ length: marks.plans }, (_, i) => <span key={`plan-${i}`} className={`${styles.tick} ${styles.tickPlan}`} data-mark="plan" />)}
        </span>
        {marks.more > 0 && <span className={styles.ticksMore}>+{marks.more}</span>}
      </span>
    </button>
  )
}
