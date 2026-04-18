import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../models'
import type { WeekStart } from '../../utils/effective-date'
import { HORIZON_KEYS, type HorizonKey } from '../../services/horizons'
import { HorizonCell } from './HorizonCell'
import styles from './HorizonRibbon.module.css'

interface Props {
  /** HorizonKey → matching task array (pre-filtered through the slot's list-def predicate). */
  tasksByHorizon: Record<HorizonKey, PersistedTodoItem[]>
  /** HorizonKey → display label (from the mapped `ListDefinition.name`). */
  labelsByHorizon: Record<HorizonKey, string>
  selectedHorizon: HorizonKey
  today: Date
  weekStartsOn: WeekStart
  onSelect: (key: HorizonKey) => void
  /** Called when the user clicks a cell whose slot is not mapped to any list-def. */
  onConfigureSlot?: (key: HorizonKey) => void
  /** HorizonKey → whether its slot is currently unmapped. */
  unmappedSlots: Set<HorizonKey>
}

const DEFAULT_LABELS: Record<HorizonKey, string> = {
  thisweek: 'This week',
  nextweek: 'Next week',
  thismonth: 'Rest of month',
  later: 'Later',
  someday: 'Someday',
}

export function HorizonRibbon({
  tasksByHorizon,
  labelsByHorizon,
  selectedHorizon,
  today,
  weekStartsOn,
  onSelect,
  onConfigureSlot,
  unmappedSlots,
}: Props) {
  const cells = useMemo(() => HORIZON_KEYS, [])

  return (
    <div role="tablist" aria-label="Horizons" className={styles.ribbon}>
      {cells.map((key) => {
        const tasks = tasksByHorizon[key] ?? []
        const label = labelsByHorizon[key] ?? DEFAULT_LABELS[key]
        const isUnmapped = unmappedSlots.has(key)
        if (isUnmapped) {
          return (
            <button
              key={key}
              type="button"
              className={`${styles.cellSlot} ${styles.placeholder}`}
              onClick={() => onConfigureSlot?.(key)}
              data-horizon={key}
            >
              <div className={styles.placeholderLabel}>{DEFAULT_LABELS[key]}</div>
              <div className={styles.placeholderHint}>Configure…</div>
            </button>
          )
        }
        return (
          <div key={key} className={styles.cellSlot} data-horizon={key}>
            <HorizonCell
              horizonKey={key}
              label={label}
              count={tasks.length}
              tasks={tasks}
              selected={selectedHorizon === key}
              today={today}
              weekStartsOn={weekStartsOn}
              onSelect={() => onSelect(key)}
            />
          </div>
        )
      })}
    </div>
  )
}
