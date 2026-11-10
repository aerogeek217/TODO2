import { useEffect, useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import { EISENHOWER_QUADRANTS, type EisenhowerQuadrant } from '../../../models/workspace-layout'
import { useEisenhowerStats, useStatsBase } from '../../../hooks/use-glance-data'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { EisenhowerSummary } from '../../../services/stats/eisenhower-summary'
import { useUIStore } from '../../../stores/ui-store'
import { paneSubtitle, QUADRANT_COLOR } from '../../../utils/eisenhower-panes'
import type { WidgetFace } from '../../../utils/widget-face'
import { useChipNames } from '../../shared/filters/filter-menu'
import { countOf } from '../glance/glance-copy'
import { eisenhowerPaneDrill } from '../glance/glance-drills'
import { glanceDrill } from '../glance/glance-hooks'
import styles from './EisenhowerFace.module.css'

/** How many of a pane's tasks the medium face lists by title. */
export const EISENHOWER_FACE_TITLES = 2

/** The open tasks the panes hold, of `summary`. */
function paneTotal(summary: EisenhowerSummary): number {
  return EISENHOWER_QUADRANTS.reduce((n, q) => n + summary[q].ids.length, 0)
}

/**
 * The Eisenhower's small and medium faces (D26 P4; the old Eisenhower
 * summary's look): the app-wide panes over the Eisenhower's own list and
 * the screen filter, counted as `computeEisenhowerSummary` counts them.
 *
 * - **Small** — the 2×2 of counts: each pane's name and its open tasks, in
 *   its quadrant's tint. Not interactive: the cell opens the whole widget
 *   on a click.
 * - **Medium** — the counts, and under each the first
 *   `EISENHOWER_FACE_TITLES` titles in the widget's order (due date,
 *   undated last, `sortOrder`). A count opens its pane's tasks in the task
 *   dialog; a title opens the task.
 *
 * Reports the panes' open count for the tab (`n of N`, only while the
 * screen filter hides some), as the whole widget reports its own.
 */
export function EisenhowerFace({ face, tabId, onCount }: {
  face: Exclude<WidgetFace, 'large'>
  tabId: string
  onCount?: (countLabel: string | undefined) => void
}) {
  const base = useStatsBase()
  const { eisenhower, eisenhowerSetup } = useEisenhowerStats(base)
  const { panes, listName } = eisenhowerSetup
  const names = useChipNames()
  const subtitles = useMemo(() => panes.map((p) => paneSubtitle(p, names)), [panes, names])
  const { shown, total } = eisenhower

  const open = paneTotal(shown)
  const openTotal = paneTotal(total)
  // One number (UX cleanup 2A): a tab count only while the screen filter or the lens hides some.
  const countLabel = open < openTotal ? `${open} of ${openTotal}` : undefined
  const onCountRef = useLatestRef(onCount)
  useEffect(() => { onCountRef.current?.(countLabel) }, [countLabel, onCountRef])

  const words = panes.map((p) => `${p.name} ${countOf(shown[p.id].ids.length, total[p.id].ids.length)}`).join(', ')
  if (face === 'small') {
    return (
      <div className={`${styles.face} ${styles.small}`} role="group" aria-label={`Eisenhower: ${words}`} data-eis-face="small" data-eis-face-tab={tabId}>
        {panes.map((pane) => {
          const n = shown[pane.id].ids.length
          return (
            <div key={pane.id} className={styles.pane} data-eis-cell={pane.id}>
              <span className={styles.name} style={{ color: QUADRANT_COLOR[pane.id] }}>{pane.name}</span>
              <span className={styles.count} data-zero={n === 0 ? 'true' : undefined} data-testid="eis-face-count">{n}</span>
            </div>
          )
        })}
      </div>
    )
  }

  const source = { urgentRange: base.ctx.urgentRange, listName }
  const drill = glanceDrill((d) => useUIStore.getState().showTaskDialog(d), base.filtered)
  return (
    <div className={`${styles.face} ${styles.medium}`} aria-label={`Eisenhower: ${words}`} role="group" data-eis-face="medium" data-eis-face-tab={tabId}>
      {panes.map((pane, i) => (
        <MediumPane
          key={pane.id}
          q={pane.id}
          name={pane.name}
          ids={shown[pane.id].ids}
          total={total[pane.id].ids.length}
          todoById={base.todoById}
          onCount={drill ? () => drill(eisenhowerPaneDrill(pane, subtitles[i] ?? '', shown[pane.id].ids, source)) : undefined}
        />
      ))}
    </div>
  )
}

/** A medium face's pane: its name and count (a button while it has tasks), then its first titles. */
function MediumPane({ q, name, ids, total, todoById, onCount }: {
  q: EisenhowerQuadrant
  name: string
  ids: readonly number[]
  total: number
  todoById: ReadonlyMap<number, PersistedTodoItem>
  onCount?: () => void
}) {
  const n = ids.length
  const titles = ids.slice(0, EISENHOWER_FACE_TITLES).flatMap((id) => {
    const t = todoById.get(id)
    return t ? [t] : []
  })
  const head = (
    <>
      <span className={styles.name} style={{ color: QUADRANT_COLOR[q] }}>{name}</span>
      <span className={styles.count} data-zero={n === 0 ? 'true' : undefined} data-testid="eis-face-count">
        {n}
        {n !== total && <span className={styles.of}>of {total}</span>}
      </span>
    </>
  )
  return (
    <div className={styles.pane} data-eis-cell={q}>
      {onCount && n > 0
        ? <button type="button" className={styles.head} aria-label={`${name}: ${countOf(n, total)}. Show tasks`} onClick={onCount}>{head}</button>
        : <span className={styles.head}>{head}</span>}
      {titles.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.title}
          data-todo-id={t.id}
          onClick={() => useUIStore.getState().openEditPopup(t.id)}
        >
          {t.title}
        </button>
      ))}
    </div>
  )
}
