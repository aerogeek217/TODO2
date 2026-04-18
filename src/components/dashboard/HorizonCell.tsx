import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../models'
import type { WeekStart } from '../../utils/effective-date'
import {
  HORIZON_GRAIN,
  type HorizonKey,
  type BinStats,
  horizonBins,
  horizonSomedayCount,
} from '../../services/horizons'
import styles from './HorizonCell.module.css'

interface Props {
  horizonKey: HorizonKey
  label: string
  /** Total task count shown below bars. */
  count: number
  /** All tasks matching the slot's list-def predicate. */
  tasks: PersistedTodoItem[]
  selected: boolean
  today: Date
  weekStartsOn: WeekStart
  onSelect: () => void
}

/** Cap a load value to the tallest bar-visual; anything above = full height. */
const BAR_SATURATION = 6

function barHeight(load: number): number {
  if (load <= 0) return 2
  return Math.min(100, Math.round((load / BAR_SATURATION) * 100))
}

function BinBar({ bin, selected }: { bin: BinStats; selected: boolean }) {
  // Coloring: overdue > hasDeadline > (selected accent) > muted.
  let className = selected ? styles.barSelected : styles.bar
  if (bin.hasDeadline > 0) className = styles.barDeadline
  if (bin.overdue > 0) className = styles.barOverdue
  return (
    <div
      className={`${styles.barCell} ${bin.isToday ? styles.barCellToday : ''}`}
      title={`${bin.label} — ${bin.load} task${bin.load === 1 ? '' : 's'}${bin.overdue ? ` (${bin.overdue} overdue)` : ''}`}
    >
      <div
        className={className}
        style={{ height: `${barHeight(bin.load)}%` }}
      />
      <div className={styles.barLabel}>{bin.label}</div>
    </div>
  )
}

function DotCluster({ count, selected }: { count: number; selected: boolean }) {
  const visible = Math.min(count, 12)
  const dots = Array.from({ length: visible }, (_, i) => i)
  return (
    <div className={styles.dotCluster}>
      {dots.map((i) => (
        <span key={i} className={selected ? styles.dotSelected : styles.dot} />
      ))}
      {count > visible && <span className={styles.dotMore}>+{count - visible}</span>}
    </div>
  )
}

export function HorizonCell({
  horizonKey,
  label,
  count,
  tasks,
  selected,
  today,
  weekStartsOn,
  onSelect,
}: Props) {
  const grain = HORIZON_GRAIN[horizonKey]

  const bins = useMemo(
    () => (grain === null ? [] : horizonBins(horizonKey, tasks, today, weekStartsOn)),
    [horizonKey, grain, tasks, today, weekStartsOn],
  )
  const somedayCount = useMemo(
    () => (grain === null ? horizonSomedayCount(tasks) : 0),
    [grain, tasks],
  )

  const overdueCount = bins.reduce((s, b) => s + b.overdue, 0)
  const deadlineCount = bins.reduce((s, b) => s + b.hasDeadline, 0)

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`${styles.cell} ${selected ? styles.cellSelected : ''}`}
      data-horizon={horizonKey}
      onClick={onSelect}
    >
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{count}</span>
      </div>
      <div className={styles.body}>
        {grain === null ? (
          <DotCluster count={somedayCount} selected={selected} />
        ) : (
          <div className={styles.bars}>
            {bins.map((bin, i) => (
              <BinBar key={i} bin={bin} selected={selected} />
            ))}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        {deadlineCount > 0 && (
          <span className={styles.flag} title={`${deadlineCount} deadline${deadlineCount === 1 ? '' : 's'}`}>
            <span className={styles.flagGlyph}>⚑</span>
            {deadlineCount}
          </span>
        )}
        {overdueCount > 0 && (
          <span className={styles.overdue} title={`${overdueCount} overdue`}>
            <span className={styles.overdueGlyph}>●</span>
            {overdueCount}
          </span>
        )}
      </div>
    </button>
  )
}
