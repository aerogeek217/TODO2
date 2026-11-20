import { formatDateWith } from '../../../utils/date'
import { plannerRangeLabel, plannerTileLabel, type PlannerTile, type PlannerWindow } from '../../../utils/planner'
import { ChevronLeftIcon, ChevronRightIcon } from '../../shared/icons'
import styles from './PlannerWidget.module.css'

interface PlannerStripProps {
  window: PlannerWindow
  tiles: readonly PlannerTile[]
  /** The picked day (local midnight, ms), or null. */
  picked: number | null
  /** The window's offset from today, days: at 0 there is no earlier week. */
  offset: number
  /** `false`: no room for seven tiles — the arrows stay, around the window's range. */
  showTiles: boolean
  /** A tile's click: its day (today's tile: null — the days ahead from tomorrow). */
  onPick: (day: Date | null) => void
  /** An arrow's click: a week earlier (-1) or later (1). */
  onShift: (weeks: -1 | 1) => void
}

/**
 * The Planner's strip: `‹`, the window's seven day tiles — equal widths,
 * weekends too — and `›`. A tile shows its weekday, date, count and a tick
 * per task by why it is on that day (`data-reason`); today's is in the
 * accent, the picked one ringed. A click picks the day the days-ahead list
 * starts at; the arrows move the window a week. Too narrow for tiles
 * (`showTiles` false), the arrows sit around the range in words.
 */
export function PlannerStrip({ window, tiles, picked, offset, showTiles, onPick, onShift }: PlannerStripProps) {
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
        ? tiles.map((tile) => <Tile key={tile.key} tile={tile} picked={picked === tile.day.getTime()} onPick={onPick} />)
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

function Tile({ tile, picked, onPick }: { tile: PlannerTile; picked: boolean; onPick: (day: Date | null) => void }) {
  const weekday = tile.day.getDay()
  return (
    <button
      type="button"
      className={styles.tile}
      aria-label={plannerTileLabel(tile)}
      aria-pressed={picked}
      data-planner-tile={tile.key}
      data-today={tile.isToday ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
      data-weekend={weekday === 0 || weekday === 6 ? 'true' : undefined}
      onClick={() => onPick(tile.isToday ? null : tile.day)}
    >
      <span className={styles.tileHead}>
        <span className={styles.weekday}>{formatDateWith(tile.day, { weekday: 'short' })}</span>
        <span className={styles.dateNumber}>{tile.day.getDate()}</span>
        <span className={styles.tileCount} data-testid="planner-tile-count">{tile.count > 0 ? tile.count : ''}</span>
      </span>
      <span className={styles.ticks} aria-hidden="true">
        <span className={styles.tickMarks}>
          {tile.ticks.map((reason, i) => <span key={i} className={styles.tick} data-reason={reason} />)}
        </span>
        {tile.more > 0 && <span className={styles.ticksMore}>+{tile.more}</span>}
      </span>
    </button>
  )
}
