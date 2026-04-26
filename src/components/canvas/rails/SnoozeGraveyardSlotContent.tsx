import { useEffect, useMemo } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { useTodoEventStore } from '../../../stores/todo-event-store'
import { useUIStore } from '../../../stores/ui-store'
import { selectMostDeferred, type SnoozedTask } from '../../../services/stats/snooze'
import { formatDateShort } from '../../../utils/date'
import styles from './SnoozeGraveyardSlotContent.module.css'

const LIMIT = 5

/**
 * Rail/float widget body for the `snoozeGraveyard` widget kind. Renders the
 * top-N most-rescheduled open todos, ranked by future-shift `scheduled` event
 * count. Each row shows title · count · "since {date}" · proportional bar.
 * Clicking a row opens its edit popup.
 *
 * Subscribes to `useTodoStore.todos` (any mutation produces a new array
 * reference via `bulkUpdateField` — see store-helpers) and pulls events via
 * `useTodoEventStore.loadAll` on mount + on every todos change. The shared
 * event-store cache races against `ScoreboardSlotContent`'s `loadInRange`
 * window — last caller wins. Acceptable for v1; both widgets re-pull on
 * todos change so steady-state convergence happens within one mutation.
 */
export function SnoozeGraveyardSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const events = useTodoEventStore((s) => s.events)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  useEffect(() => {
    void useTodoEventStore.getState().loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, todosVersion])

  const rows = useMemo<SnoozedTask[]>(
    () => selectMostDeferred({ events, todos, limit: LIMIT }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, todos, todosVersion],
  )

  if (rows.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>No deferred tasks</div>
      </div>
    )
  }

  const maxCount = rows.reduce((m, r) => (r.count > m ? r.count : m), 0)

  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        {rows.map((row) => {
          const widthPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0
          return (
            <button
              key={row.todo.id}
              type="button"
              className={styles.row}
              onClick={() => openEditPopup(row.todo.id)}
              title={row.todo.title}
            >
              <div className={styles.headerRow}>
                <span className={styles.title}>{row.todo.title}</span>
                <span className={styles.count}>{row.count}×</span>
                {row.oldestScheduled && (
                  <span className={styles.since}>since {formatDateShort(row.oldestScheduled)}</span>
                )}
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <div className={styles.barFill} style={{ width: `${widthPct}%` }} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
