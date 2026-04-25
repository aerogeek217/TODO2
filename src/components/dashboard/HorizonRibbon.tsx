import { useCallback, useMemo } from 'react'
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
  /** DOM id of the tabpanel these cells control (hero card). */
  heroPanelId?: string
  /** HorizonKey → stable DOM id for the tab button (used by aria-labelledby on hero). */
  tabIdFor?: (key: HorizonKey) => string
  /** Open the horizon-config modal (Phase 5 Edit horizons…). */
  onEditHorizons?: () => void
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
  heroPanelId,
  tabIdFor,
  onEditHorizons,
}: Props) {
  const cells = useMemo(() => HORIZON_KEYS, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent, key: HorizonKey) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const idx = cells.indexOf(key)
    if (idx === -1) return
    let nextIdx = idx
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % cells.length
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + cells.length) % cells.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = cells.length - 1
    const nextKey = cells[nextIdx]
    if (!nextKey) return
    onSelect(nextKey)
    // Focus the newly-selected tab so keyboard roving follows selection.
    const el = document.querySelector<HTMLElement>(`[data-horizon="${nextKey}"]`)
    el?.focus()
  }, [cells, onSelect])

  return (
    <div className={styles.container}>
      <div role="tablist" aria-label="Horizons" className={styles.ribbon}>
      {cells.map((key) => {
        const tasks = tasksByHorizon[key] ?? []
        const label = labelsByHorizon[key] ?? DEFAULT_LABELS[key]
        const isUnmapped = unmappedSlots.has(key)
        const tabId = tabIdFor?.(key)
        const tabIndex = selectedHorizon === key ? 0 : -1
        if (isUnmapped) {
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={false}
              aria-controls={heroPanelId}
              tabIndex={tabIndex}
              className={`${styles.cellSlot} ${styles.placeholder}`}
              onClick={() => onConfigureSlot?.(key)}
              onKeyDown={(e) => handleKeyDown(e, key)}
              data-horizon={key}
            >
              <div className={styles.placeholderLabel}>{DEFAULT_LABELS[key]}</div>
              <div className={styles.placeholderHint}>Configure…</div>
            </button>
          )
        }
        return (
          <div key={key} className={styles.cellSlot}>
            <HorizonCell
              horizonKey={key}
              label={label}
              count={tasks.length}
              tasks={tasks}
              selected={selectedHorizon === key}
              today={today}
              weekStartsOn={weekStartsOn}
              onSelect={() => onSelect(key)}
              ariaControls={heroPanelId}
              id={tabId}
              tabIndex={tabIndex}
              onKeyDown={(e) => handleKeyDown(e, key)}
            />
          </div>
        )
      })}
      </div>
      {onEditHorizons && (
        <div className={styles.ribbonFooter}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={onEditHorizons}
          >
            Edit horizons…
          </button>
        </div>
      )}
    </div>
  )
}
